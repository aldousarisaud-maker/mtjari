import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { InventoryReason, Prisma, TxClient } from '@mtjari/db';
import type { InventoryAdjustInput } from '@mtjari/shared';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';
import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../tenancy/tenancy';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private tx<T>(t: TenantContext, fn: (tx: TxClient) => Promise<T>) {
    return this.prisma.tx({ storeId: t.storeId, userId: t.userId }, fn);
  }

  async list(t: TenantContext, q: { q?: string; lowStock: boolean; page: number; limit: number }) {
    return this.tx(t, async (tx) => {
      const contains = { contains: q.q ?? '', mode: 'insensitive' as const };
      const where: Prisma.ProductVariantWhereInput = {
        storeId: t.storeId, trackInventory: true, product: { deletedAt: null },
        ...(q.lowStock ? { lowStockThreshold: { not: null }, stockQuantity: { lte: tx.productVariant.fields.lowStockThreshold } } : {}),
        ...(q.q ? { OR: [{ sku: contains }, { product: { OR: [{ nameAr: contains }, { nameEn: contains }] } }] } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.productVariant.count({ where }),
        tx.productVariant.findMany({
          where, skip: (q.page - 1) * q.limit, take: q.limit,
          orderBy: [{ stockQuantity: 'asc' }, { id: 'asc' }],
          select: {
            id: true, sku: true, optionValues: true, stockQuantity: true, lowStockThreshold: true,
            product: { select: { id: true, nameAr: true, nameEn: true } },
          },
        }),
      ]);
      return {
        total, page: q.page, limit: q.limit,
        items: rows.map((v) => ({ ...v, low: v.lowStockThreshold != null && v.stockQuantity <= v.lowStockThreshold })),
      };
    });
  }

  /**
   * Changes stock inside an existing transaction. The variant row is locked
   * (SELECT ... FOR UPDATE) so concurrent changes are applied one after
   * another; the balance and its ledger entry are written together.
   */
  async applyInTx(
    tx: TxClient, t: { storeId: string; userId: string | null }, variantId: string,
    change: { delta?: number; setTo?: number }, reason: InventoryReason, note: string | null,
  ): Promise<{ quantity: number; delta: number } | null> {
    const rows = await tx.$queryRaw<{ stock_quantity: number; track_inventory: boolean }[]>`
      SELECT v.stock_quantity, v.track_inventory FROM product_variants v
      JOIN products p ON p.id = v.product_id AND p.deleted_at IS NULL
      WHERE v.id = ${variantId}::uuid FOR UPDATE OF v`;
    const row = rows[0];
    if (!row) throw new NotFoundException('variant_not_found');
    if (!row.track_inventory) throw new BadRequestException('inventory_not_tracked');
    const delta = change.delta ?? change.setTo! - row.stock_quantity;
    if (delta === 0) return null;
    const quantity = row.stock_quantity + delta;
    if (quantity < 0) throw new ConflictException('insufficient_stock');
    await tx.productVariant.update({ where: { id: variantId }, data: { stockQuantity: quantity } });
    await tx.inventoryMovement.create({
      data: { storeId: t.storeId, variantId, delta, quantityAfter: quantity, reason, note, actorUserId: t.userId },
    });
    return { quantity, delta };
  }

  async adjust(t: TenantContext, input: InventoryAdjustInput, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const result = await this.applyInTx(tx, t, input.variantId, { delta: input.delta, setTo: input.setTo }, input.reason, input.note ?? null);
      if (!result) return { variantId: input.variantId, changed: false };
      await this.audit.record(tx, {
        storeId: t.storeId, actorUserId: t.userId, action: 'inventory.adjusted', entityType: 'variant', entityId: input.variantId,
        metadata: { delta: result.delta, quantityAfter: result.quantity, reason: input.reason }, meta,
      });
      return { variantId: input.variantId, changed: true, stockQuantity: result.quantity, delta: result.delta };
    });
  }

  async movements(t: TenantContext, q: { variantId?: string; page: number; limit: number }) {
    return this.tx(t, async (tx) => {
      const where = { storeId: t.storeId, ...(q.variantId ? { variantId: q.variantId } : {}) };
      const [total, items] = await Promise.all([
        tx.inventoryMovement.count({ where }),
        tx.inventoryMovement.findMany({
          where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.limit, take: q.limit,
          include: { variant: { select: { sku: true, optionValues: true, product: { select: { id: true, nameAr: true, nameEn: true } } } } },
        }),
      ]);
      return { total, page: q.page, limit: q.limit, items };
    });
  }
}
