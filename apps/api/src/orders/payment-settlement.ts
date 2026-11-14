import { Injectable, Logger } from '@nestjs/common';
import type { TxClient } from '@mtjari/db';
import { AuditService } from '../audit/audit.service';
import type { PaymentAdapter, VerifiedWebhook } from './payment-adapters';

export type SettlementResult = { received: true; duplicate?: true; status?: 'PROCESSED' | 'IGNORED' | 'FAILED' };

/**
 * Applies what a provider told us (already authenticated by its adapter) to our
 * records. Used by webhooks and by the status check when a shopper returns from
 * the payment page, so both paths follow exactly the same rules:
 *  - each provider event is recorded once (a redelivery stops there),
 *  - the amount and currency must equal our payment record,
 *  - only then are the payment and its order marked paid.
 */
@Injectable()
export class PaymentSettlement {
  private readonly logger = new Logger('PaymentSettlement');

  constructor(private readonly audit: AuditService) {}

  /**
   * For providers that only authorize at first (Tabby): once the payment was verified and just recorded as
   * paid, tell the provider to capture it. A failure is logged and does not undo the order, which is paid
   * and confirmed; the merchant can capture from the provider's dashboard and the provider captures on its own after a while.
   * Never runs for an event that was ignored, a duplicate, or refused (for example an amount mismatch).
   */
  async confirmWithProvider(adapter: PaymentAdapter, credentials: Record<string, string>, event: VerifiedWebhook, result: SettlementResult): Promise<void> {
    if (!event.capture || !event.currency || event.outcome !== 'paid' || result.status !== 'PROCESSED' || !adapter.capture) return;
    try {
      await adapter.capture({ providerRef: event.providerRef, amount: event.capture.amount, currency: event.currency, credentials });
    } catch (e) {
      this.logger.error(`${adapter.id} payment ${event.providerRef} is paid but the capture failed: ${(e as Error).message}`);
    }
  }

  async apply(tx: TxClient, storeId: string, provider: string, event: VerifiedWebhook, payloadHash: string): Promise<SettlementResult> {
    const { count } = await tx.webhookEvent.createMany({
      data: [{ storeId, provider, eventId: event.eventId, type: event.type, payloadHash }],
      skipDuplicates: true,
    });
    if (!count) return { received: true, duplicate: true };

    const finish = async (status: 'PROCESSED' | 'IGNORED' | 'FAILED', error?: string): Promise<SettlementResult> => {
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
    if (payment.amount !== order.total) return finish('FAILED', 'order_state_mismatch');

    const now = new Date();
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'PAID', paidAt: now } });
    if (order.paymentStatus !== 'UNPAID') {
      // The shopper paid twice (an earlier payment page was completed after a new attempt). The money is real, so it is
      // recorded and shown to the merchant, who refunds the extra payment from the provider's dashboard.
      await tx.orderEvent.create({ data: { storeId, orderId: order.id, type: 'duplicate_payment' } });
      await this.audit.record(tx, {
        storeId, actorType: 'SYSTEM', action: 'order.duplicate_payment', entityType: 'order', entityId: order.id,
        metadata: { number: order.number, provider, amount: payment.amount, eventId: event.eventId },
      });
      return finish('PROCESSED', 'duplicate_payment');
    }
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
  }
}
