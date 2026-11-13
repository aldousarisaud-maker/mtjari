import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { OrderStatus, Prisma, TxClient } from '@mtjari/db';
import { ORDER_TRANSITIONS, canTransition, type OrdersQuery } from '@mtjari/shared';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../catalog/inventory.service';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';
import type { TenantContext } from '../tenancy/tenancy';
import { PaymentRegistry } from './payment-adapters';

type Actor = { storeId: string; userId: string | null };

/** Merchant side of orders: list, detail, status changes, recording cash, notes. */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly inventory: InventoryService, private readonly registry: PaymentRegistry,
  ) {}

  private tx<T>(t: TenantContext, fn: (tx: TxClient) => Promise<T>) {
    return this.prisma.tx({ storeId: t.storeId, userId: t.userId }, fn);
  }

  async list(t: TenantContext, q: OrdersQuery) {
    return this.tx(t, async (tx) => {
      const term = q.q?.replace(/^#/, '');
      const contains = { contains: term ?? '', mode: 'insensitive' as const };
      const where: Prisma.OrderWhereInput = {
        storeId: t.storeId,
        ...(q.status ? { status: q.status } : {}),
        ...(term
          ? { OR: [...(/^\d{1,9}$/.test(term) ? [{ number: Number(term) }] : []), { customerPhone: { contains: term.replace(/[\s-]/g, '') } }, { customerName: contains }] }
          : {}),
      };
      const [total, items, byStatus] = await Promise.all([
        tx.order.count({ where }),
        tx.order.findMany({
          where, orderBy: [{ placedAt: 'desc' }, { number: 'desc' }], skip: (q.page - 1) * q.limit, take: q.limit,
          select: {
            id: true, number: true, status: true, paymentStatus: true, paymentProvider: true, fulfillment: true, currency: true, total: true,
            customerName: true, customerPhone: true, placedAt: true, _count: { select: { items: true } },
          },
        }),
        tx.order.groupBy({ by: ['status'], where: { storeId: t.storeId }, _count: { _all: true } }),
      ]);
      return {
        total, page: q.page, limit: q.limit,
        items: items.map(({ _count, ...o }) => ({ ...o, itemCount: _count.items })),
        counts: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      };
    });
  }

  async get(t: TenantContext, id: string) {
    return this.tx(t, async (tx) => {
      const order = await tx.order.findFirst({
        where: { storeId: t.storeId, id },
        include: {
          items: { orderBy: { id: 'asc' } },
          events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          payments: { orderBy: { createdAt: 'asc' }, select: { id: true, provider: true, status: true, amount: true, currency: true, paidAt: true, createdAt: true } },
        },
      });
      if (!order) throw new NotFoundException('order_not_found');
      const actorIds = [...new Set(order.events.map((e) => e.actorUserId).filter((x): x is string => !!x))];
      const actors = actorIds.length
        ? await tx.membership.findMany({ where: { storeId: t.storeId, userId: { in: actorIds } }, select: { userId: true, user: { select: { name: true } } } })
        : [];
      const names = new Map(actors.map((a) => [a.userId, a.user.name]));
      const { accessTokenHash: _hash, idempotencyKey: _key, ...safe } = order;
      const adapter = this.registry.get(order.paymentProvider);
      return {
        ...safe,
        paymentName: adapter?.name ?? { ar: order.paymentProvider, en: order.paymentProvider },
        events: order.events.map((e) => ({ ...e, actorName: e.actorUserId ? names.get(e.actorUserId) ?? null : null })),
        allowedTransitions: ORDER_TRANSITIONS[order.status],
        // Cash can be recorded by staff; online payments are only ever confirmed by the provider.
        canRecordPayment: adapter?.kind === 'offline' && order.paymentStatus === 'UNPAID' && order.status !== 'CANCELLED',
      };
    });
  }

  /** Locks the order row so two staff members (or a webhook) cannot change it at the same moment. */
  private async lock(tx: TxClient, storeId: string, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE store_id = ${storeId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw new NotFoundException('order_not_found');
    return tx.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
  }

  /** Puts stock back for a cancelled order. Lines whose product no longer exists or no longer tracks stock are skipped. */
  async returnStock(tx: TxClient, actor: Actor, order: { number: number; items: { id: string; variantId: string; quantity: number; stockTaken: boolean }[] }) {
    for (const item of [...order.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      if (!item.stockTaken) continue;
      try {
        await this.inventory.applyInTx(tx, actor, item.variantId, { delta: item.quantity }, 'RETURN', `order #${order.number} cancelled`);
      } catch (e) {
        if (!(e instanceof NotFoundException || e instanceof BadRequestException)) throw e;
      }
      await tx.orderItem.update({ where: { id: item.id }, data: { stockTaken: false } });
    }
  }

  async transition(t: TenantContext, id: string, to: OrderStatus, note: string, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const order = await this.lock(tx, t.storeId, id);
      if (!canTransition(order.status, to)) throw new ConflictException('invalid_order_transition');
      if (to === 'CANCELLED') {
        await this.returnStock(tx, t, order);
        await tx.payment.updateMany({ where: { storeId: t.storeId, orderId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      }
      await tx.order.update({ where: { id }, data: { status: to, ...(to === 'CANCELLED' ? { cancelledAt: new Date() } : {}) } });
      await tx.orderEvent.create({ data: { storeId: t.storeId, orderId: id, type: 'status', fromStatus: order.status, toStatus: to, note: note || null, actorUserId: t.userId } });
      await this.audit.record(tx, {
        storeId: t.storeId, actorUserId: t.userId, action: 'order.status_changed', entityType: 'order', entityId: id,
        metadata: { number: order.number, from: order.status, to }, meta,
      });
      return { id, status: to };
    });
  }

  /**
   * Records that cash was collected. Only for offline methods: an order paid
   * through an online provider is marked paid by its verified webhook and
   * can never be marked paid by hand.
   */
  async recordPayment(t: TenantContext, id: string, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const order = await this.lock(tx, t.storeId, id);
      if (this.registry.get(order.paymentProvider)?.kind !== 'offline') throw new BadRequestException('manual_payment_not_allowed');
      if (order.paymentStatus !== 'UNPAID') throw new ConflictException('order_already_paid');
      if (order.status === 'CANCELLED') throw new ConflictException('order_cancelled');
      const now = new Date();
      const pending = await tx.payment.findFirst({ where: { storeId: t.storeId, orderId: id, provider: order.paymentProvider, status: 'PENDING', amount: order.total } });
      if (pending) await tx.payment.update({ where: { id: pending.id }, data: { status: 'PAID', paidAt: now } });
      else await tx.payment.create({ data: { storeId: t.storeId, orderId: id, provider: order.paymentProvider, amount: order.total, currency: order.currency, status: 'PAID', paidAt: now } });
      await tx.order.update({ where: { id }, data: { paymentStatus: 'PAID', paidAt: now } });
      await tx.orderEvent.create({ data: { storeId: t.storeId, orderId: id, type: 'payment_recorded', actorUserId: t.userId } });
      await this.audit.record(tx, {
        storeId: t.storeId, actorUserId: t.userId, action: 'order.payment_recorded', entityType: 'order', entityId: id,
        metadata: { number: order.number, amount: order.total, provider: order.paymentProvider }, meta,
      });
      return { id, paymentStatus: 'PAID' as const };
    });
  }

  async addNote(t: TenantContext, id: string, note: string) {
    return this.tx(t, async (tx) => {
      const found = await tx.order.findFirst({ where: { storeId: t.storeId, id }, select: { id: true } });
      if (!found) throw new NotFoundException('order_not_found');
      await tx.orderEvent.create({ data: { storeId: t.storeId, orderId: id, type: 'note', note, actorUserId: t.userId } });
      return { id };
    });
  }
}
