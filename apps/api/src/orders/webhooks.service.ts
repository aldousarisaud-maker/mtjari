import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sha256 } from '../common/crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../common/prisma.service';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentRegistry } from './payment-adapters';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Provider notifications. Order of checks:
 *  1. the provider and store exist and the store has credentials for it,
 *  2. the adapter verifies the signature with the store's own secret,
 *  3. the event is recorded once (a redelivery stops here),
 *  4. the payment is found, and the amount and currency must match ours
 *     before the payment and its order are marked paid.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('PaymentWebhooks');

  constructor(
    private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly registry: PaymentRegistry, private readonly methods: PaymentMethodsService,
  ) {}

  async handle(provider: string, storeId: string, rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>) {
    const adapter = this.registry.get(provider);
    if (!adapter?.verifyWebhook || !UUID_RE.test(storeId) || !rawBody?.length) throw new NotFoundException('not_found');

    return this.prisma.tx({ storeId }, async (tx) => {
      const credentials = await this.methods.credentials(tx, storeId, provider);
      if (!credentials) throw new NotFoundException('not_found');
      const event = adapter.verifyWebhook!({ rawBody, headers, credentials });

      const { count } = await tx.webhookEvent.createMany({
        data: [{ storeId, provider, eventId: event.eventId, type: event.type, payloadHash: sha256(rawBody.toString('utf8')) }],
        skipDuplicates: true,
      });
      if (!count) return { received: true, duplicate: true };

      const finish = async (status: 'PROCESSED' | 'IGNORED' | 'FAILED', error?: string) => {
        await tx.webhookEvent.update({
          where: { storeId_provider_eventId: { storeId, provider, eventId: event.eventId } },
          data: { status, error: error ?? null, processedAt: new Date() },
        });
        if (error) this.logger.warn(`${provider} event ${event.eventId} for store ${storeId}: ${error}`);
        return { received: true, status };
      };

      if (event.outcome === 'ignored') return finish('IGNORED');
      const found = await tx.payment.findFirst({ where: { storeId, provider, providerRef: event.providerRef }, select: { id: true, orderId: true } });
      if (!found) return finish('FAILED', 'payment_not_found');
      // Lock the order, then read the payment again inside the lock.
      await tx.$queryRaw`SELECT id FROM orders WHERE store_id = ${storeId}::uuid AND id = ${found.orderId}::uuid FOR UPDATE`;
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.id } });
      const order = await tx.order.findUniqueOrThrow({ where: { id: found.orderId } });

      if (event.outcome === 'failed') {
        if (payment.status !== 'PENDING') return finish('IGNORED');
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
        await tx.orderEvent.create({ data: { storeId, orderId: order.id, type: 'payment_failed' } });
        return finish('PROCESSED');
      }

      if (payment.status === 'PAID') return finish('IGNORED');
      if (event.amount !== payment.amount || event.currency !== payment.currency) return finish('FAILED', 'amount_mismatch');
      if (payment.amount !== order.total || order.paymentStatus !== 'UNPAID') return finish('FAILED', 'order_state_mismatch');

      const now = new Date();
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'PAID', paidAt: now } });
      // A paid order that is still waiting is confirmed automatically. A cancelled order stays cancelled; staff see it needs a refund.
      const confirm = order.status === 'PENDING';
      await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID', paidAt: now, ...(confirm ? { status: 'CONFIRMED' } : {}) } });
      await tx.orderEvent.create({
        data: { storeId, orderId: order.id, type: order.status === 'CANCELLED' ? 'payment_after_cancel' : 'payment_received', ...(confirm ? { fromStatus: 'PENDING', toStatus: 'CONFIRMED' } : {}) },
      });
      await this.audit.record(tx, {
        storeId, actorType: 'SYSTEM', action: 'order.paid', entityType: 'order', entityId: order.id,
        metadata: { number: order.number, provider, amount: payment.amount, eventId: event.eventId },
      });
      return finish('PROCESSED');
    });
  }
}
