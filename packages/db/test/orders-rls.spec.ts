/** Isolation and integrity tests for the Phase 4 tables: delivery, orders, payments, webhooks. */
import { randomUUID } from 'node:crypto';
import { PrismaClient, withTenant } from '../src';
import { appClient, truncateAll } from './helpers';

let prisma: PrismaClient;
const A = randomUUID();
const B = randomUUID();
const ids = { orderA: randomUUID(), orderB: randomUUID(), zoneA: randomUUID(), zoneB: randomUUID(), payA: randomUUID(), payB: randomUUID() };

const orderData = (storeId: string, id: string, number: number, extra: Record<string, unknown> = {}) => ({
  id, storeId, number, paymentProvider: 'cod', fulfillment: 'PICKUP' as const, currency: 'KWD', subtotal: 3000, deliveryFee: 0, total: 3000,
  customerName: 'Shopper', customerPhone: '+96550000000', accessTokenHash: `tok-${id}`, idempotencyKey: `key-${id}`, ...extra,
});

async function seed(storeId: string, slug: string, orderId: string, zoneId: string, payId: string) {
  await withTenant(prisma, { storeId }, async (tx) => {
    await tx.store.create({ data: { id: storeId, name: slug, slug } });
    await tx.deliveryZone.create({ data: { id: zoneId, storeId, nameAr: 'العاصمة', nameEn: 'Capital', fee: 1500 } });
    await tx.checkoutSettings.create({ data: { storeId } });
    await tx.paymentMethod.create({ data: { storeId, provider: 'cod', enabled: true } });
    await tx.order.create({ data: orderData(storeId, orderId, 1001) });
    await tx.orderItem.create({ data: { storeId, orderId, productId: randomUUID(), variantId: randomUUID(), nameEn: 'Item', unitPrice: 1500, quantity: 2, lineTotal: 3000 } });
    await tx.orderEvent.create({ data: { storeId, orderId, type: 'placed', toStatus: 'PENDING' } });
    await tx.payment.create({ data: { id: payId, storeId, orderId, provider: 'cod', amount: 3000, currency: 'KWD' } });
    await tx.webhookEvent.create({ data: { storeId, provider: 'test', eventId: 'evt-1', type: 'payment.paid', payloadHash: 'h' } });
  });
}

beforeAll(async () => {
  await truncateAll();
  prisma = appClient();
  await seed(A, 'orders-a', ids.orderA, ids.zoneA, ids.payA);
  await seed(B, 'orders-b', ids.orderB, ids.zoneB, ids.payB);
});
afterAll(() => prisma.$disconnect());

describe('order tables isolation', () => {
  it('each store sees only its own zones, settings, payment methods, orders, payments and webhook events', async () => {
    for (const [storeId, orderId] of [[A, ids.orderA], [B, ids.orderB]] as const) {
      await withTenant(prisma, { storeId }, async (tx) => {
        expect((await tx.order.findMany()).map((o) => o.id)).toEqual([orderId]);
        for (const count of [
          await tx.deliveryZone.count(), await tx.checkoutSettings.count(), await tx.paymentMethod.count(), await tx.orderItem.count(),
          await tx.orderEvent.count(), await tx.payment.count(), await tx.webhookEvent.count(),
        ]) expect(count).toBe(1);
      });
    }
  });

  it('nothing is visible without a tenant context', async () => {
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.orderItem.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.paymentMethod.count()).toBe(0);
    expect(await prisma.webhookEvent.count()).toBe(0);
    expect(await prisma.deliveryZone.count()).toBe(0);
  });

  it("another store's order cannot be read by id or by its access token, nor changed", async () => {
    await withTenant(prisma, { storeId: A }, async (tx) => {
      expect(await tx.order.findFirst({ where: { id: ids.orderB } })).toBeNull();
      expect(await tx.order.findFirst({ where: { accessTokenHash: `tok-${ids.orderB}` } })).toBeNull();
      expect((await tx.order.updateMany({ where: { id: ids.orderB }, data: { status: 'CANCELLED' } })).count).toBe(0);
      expect((await tx.payment.updateMany({ where: { id: ids.payB }, data: { status: 'PAID', paidAt: new Date() } })).count).toBe(0);
    });
  });

  it('cannot write orders, items, events or payments into another store', async () => {
    await expect(withTenant(prisma, { storeId: A }, (tx) => tx.order.create({ data: orderData(B, randomUUID(), 2000) }))).rejects.toThrow();
    // Composite foreign keys: a row in store A cannot hang off store B's order.
    await expect(
      withTenant(prisma, { storeId: A }, (tx) => tx.orderItem.create({ data: { storeId: A, orderId: ids.orderB, productId: randomUUID(), variantId: randomUUID(), unitPrice: 1, quantity: 1, lineTotal: 1 } })),
    ).rejects.toThrow();
    await expect(withTenant(prisma, { storeId: A }, (tx) => tx.orderEvent.create({ data: { storeId: A, orderId: ids.orderB, type: 'note' } }))).rejects.toThrow();
    await expect(withTenant(prisma, { storeId: A }, (tx) => tx.payment.create({ data: { storeId: A, orderId: ids.orderB, provider: 'cod', amount: 1, currency: 'KWD' } }))).rejects.toThrow();
  });

  it('order numbers and idempotency keys are unique per store, not globally', async () => {
    // Store B already has order 1001 too (seeded) — same number, different store.
    await expect(withTenant(prisma, { storeId: A }, (tx) => tx.order.create({ data: orderData(A, randomUUID(), 1001) }))).rejects.toThrow();
    await expect(
      withTenant(prisma, { storeId: A }, (tx) => tx.order.create({ data: orderData(A, randomUUID(), 1002, { idempotencyKey: `key-${ids.orderA}` }) })),
    ).rejects.toThrow();
  });

  it('a redelivered webhook event is rejected by the unique key', async () => {
    await expect(
      withTenant(prisma, { storeId: A }, (tx) => tx.webhookEvent.create({ data: { storeId: A, provider: 'test', eventId: 'evt-1', type: 'payment.paid', payloadHash: 'h' } })),
    ).rejects.toThrow();
  });
});

describe('order integrity rules', () => {
  it('totals must add up and line totals must match price × quantity', async () => {
    await expect(withTenant(prisma, { storeId: A }, (tx) => tx.order.create({ data: orderData(A, randomUUID(), 3001, { total: 1 }) }))).rejects.toThrow();
    await expect(
      withTenant(prisma, { storeId: A }, (tx) => tx.orderItem.create({ data: { storeId: A, orderId: ids.orderA, productId: randomUUID(), variantId: randomUUID(), unitPrice: 1000, quantity: 2, lineTotal: 1000 } })),
    ).rejects.toThrow();
  });

  it('a delivery order needs an address', async () => {
    await expect(withTenant(prisma, { storeId: A }, (tx) => tx.order.create({ data: orderData(A, randomUUID(), 3002, { fulfillment: 'DELIVERY' }) }))).rejects.toThrow();
  });

  it('an order cannot be marked paid without a paid payment for the full amount', async () => {
    const markPaid = () => withTenant(prisma, { storeId: A }, (tx) => tx.order.update({ where: { id: ids.orderA }, data: { paymentStatus: 'PAID', paidAt: new Date() } }));
    await expect(markPaid()).rejects.toThrow(/without a matching paid payment/);
    // A paid payment for a smaller amount is not enough.
    await withTenant(prisma, { storeId: A }, (tx) => tx.payment.create({ data: { storeId: A, orderId: ids.orderA, provider: 'cod', amount: 100, currency: 'KWD', status: 'PAID', paidAt: new Date() } }));
    await expect(markPaid()).rejects.toThrow(/without a matching paid payment/);
    await withTenant(prisma, { storeId: A }, (tx) => tx.payment.update({ where: { id: ids.payA }, data: { status: 'PAID', paidAt: new Date() } }));
    expect((await markPaid()).paymentStatus).toBe('PAID');
  });

  it('orders cannot be deleted and the order timeline is append-only', async () => {
    await expect(withTenant(prisma, { storeId: A }, (tx) => tx.order.deleteMany())).rejects.toThrow(/permission denied/i);
    await expect(withTenant(prisma, { storeId: A }, (tx) => tx.orderEvent.updateMany({ data: { note: 'x' } }))).rejects.toThrow(/permission denied/i);
    await expect(withTenant(prisma, { storeId: A }, (tx) => tx.orderEvent.deleteMany())).rejects.toThrow(/permission denied/i);
  });
});
