import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createStore, createTestApp, ownerQuery, resetDb, signUp, type Session, type TestApp } from './helpers';

/**
 * Tap adapter against the local stand-in (apps/e2e/fake-tap.mjs), which copies
 * the request and response shapes of Tap's API. These tests prove our side of
 * the contract; the real sandbox is exercised by scripts/tap-sandbox-check.ts.
 */
const PORT = 2597;
const TAP = `http://127.0.0.1:${PORT}`;
const KEY_A = 'sk_test_FakeTapKey00000001';
const KEY_B = 'sk_test_FakeTapKey00000002';

let fake: ChildProcess;
let t: TestApp;
let alice: Session;
let bob: Session;
let A: string;
let B: string;
let oudV: string;
let zone: string;
const hostA = 'tap-a.mtjari.cc';
const hostB = 'tap-b.mtjari.cc';

type Charge = { id: string; status: string; amount: number; currency: string; request: Record<string, any>; headers: Record<string, string | null> };
const control = async <T>(path: string, body?: unknown): Promise<T> =>
  (await fetch(`${TAP}/__control${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json() as Promise<T>;
const charges = () => control<Charge[]>('/charges');
const setCharge = (id: string, body: Record<string, unknown>) => control<Charge>(`/charges/${id}`, body);

const put = (provider: string, body: unknown, s = alice, store = A) => t.http().put(`/v1/stores/${store}/payment-methods/${provider}`).set(s.auth).send(body as object);
const sf = (method: 'get' | 'post', path: string, host = hostA) => t.http()[method](`/v1/storefront${path}`).set('x-store-host', host);
const stock = async () => (await ownerQuery<{ stock_quantity: number }>('SELECT stock_quantity FROM product_variants WHERE id = $1', [oudV]))[0]!.stock_quantity;
const orderRow = async (number: number, store = A) =>
  (await ownerQuery<{ id: string; status: string; payment_status: string }>('SELECT id, status, payment_status FROM orders WHERE store_id = $1 AND number = $2', [store, number]))[0]!;
const paymentsOf = (orderId: string) => ownerQuery<{ status: string; provider_ref: string }>('SELECT status, provider_ref FROM payments WHERE order_id = $1 ORDER BY created_at', [orderId]);

async function cart(quantity = 1) {
  const res = await sf('post', '/cart/items').send({ variantId: oudV, quantity }).expect(200);
  return res.body.cartToken as string;
}
async function placeTap(extra: Record<string, unknown> = {}) {
  const token = await cart();
  return await sf('post', '/checkout').set('x-cart-token', token).send({
    fulfillment: 'DELIVERY', zoneId: zone, address: { area: 'السالمية', block: '10', street: 'شارع سالم المبارك', building: '15' },
    customer: { name: 'سارة أحمد', phone: '5000 1234', email: 'sara@example.com' }, paymentProvider: 'tap', locale: 'ar',
    idempotencyKey: randomBytes(16).toString('hex'), ...extra,
  }).expect(201);
}
const webhook = (charge: Record<string, unknown>, store = A, hash = 'f'.repeat(64)) =>
  t.http().post(`/v1/webhooks/payments/tap/${store}`).set('content-type', 'application/json').set('hashstring', hash).send(JSON.stringify(charge));

beforeAll(async () => {
  fake = fork(resolve(__dirname, '../../e2e/fake-tap.mjs'), { env: { ...process.env, FAKE_TAP_PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${TAP}/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await resetDb();
  // The public API address is one nothing listens on: the stand-in's own notifications are lost, as if Tap could not reach us.
  t = await createTestApp({ TAP_API_URL: TAP, API_PUBLIC_URL: 'http://127.0.0.1:9/', WEB_URL: 'https://mtjari.cc' });
  alice = await signUp(t, 'alice@example.com');
  bob = await signUp(t, 'bob@example.com');
  A = (await createStore(t, alice, 'tap-a', 'متجر تاب')).id;
  B = (await createStore(t, bob, 'tap-b', 'Bob Tap')).id;
  const oud = await t.http().post(`/v1/stores/${A}/products`).set(alice.auth)
    .send({ nameAr: 'دهن العود', nameEn: 'Oud Oil', status: 'ACTIVE', variants: [{ sku: 'OUD', price: 8000, initialStock: 40 }] }).expect(201);
  oudV = oud.body.variants[0].id;
  await t.http().post(`/v1/stores/${B}/products`).set(bob.auth).send({ nameEn: 'Bob Mug', status: 'ACTIVE', variants: [{ sku: 'MUG', price: 500, initialStock: 9 }] }).expect(201);
  for (const [storeId, s] of [[A, alice], [B, bob]] as const) {
    await t.http().post(`/v1/stores/${storeId}/theme/publish`).set(s.auth).send({ themeId: 'gulf-premium' }).expect(200);
    await t.http().post(`/v1/stores/${storeId}/launch`).set(s.auth).expect(200);
  }
  zone = (await t.http().post(`/v1/stores/${A}/delivery-zones`).set(alice.auth).send({ nameAr: 'حولي', nameEn: 'Hawalli', fee: 1500 }).expect(201)).body.id;
});
afterAll(async () => {
  await t.close();
  fake.kill();
});

describe('the merchant enters their own Tap secret key', () => {
  it('Tap is listed, off and not configured, for a new store', async () => {
    const list = (await t.http().get(`/v1/stores/${A}/payment-methods`).set(alice.auth).expect(200)).body as Record<string, unknown>[];
    expect(list.find((m) => m.provider === 'tap')).toMatchObject({ kind: 'online', configured: false, enabled: false, mode: null, credentialFields: [{ key: 'secretKey' }] });
    expect((await put('tap', { enabled: true }).expect(400)).body.message).toBe('payment_credentials_required');
  });

  it('refuses a key that is not a Tap secret key, and one Tap does not know', async () => {
    for (const secretKey of ['pk_test_FakeTapKey00000001', 'sk_test_', 'hello world', 'sk_prod_FakeTapKey00000001']) {
      expect((await put('tap', { enabled: true, credentials: { secretKey } }).expect(400)).body.message).toBe('invalid_payment_credentials');
    }
    expect((await put('tap', { enabled: true, credentials: { secretKey: 'sk_test_WrongKey000000000' } }).expect(400)).body.message).toBe('invalid_payment_credentials');
    expect(await ownerQuery("SELECT 1 FROM payment_methods WHERE store_id = $1 AND provider = 'tap'", [A])).toHaveLength(0);
  });

  it('does not store a key it could not check because Tap is unreachable', async () => {
    await control('/down', { down: true });
    expect((await put('tap', { enabled: true, credentials: { secretKey: KEY_A } }).expect(502)).body.message).toBe('payment_provider_unreachable');
    await control('/down', { down: false });
    expect(await ownerQuery("SELECT 1 FROM payment_methods WHERE store_id = $1 AND provider = 'tap'", [A])).toHaveLength(0);
  });

  it('accepts a key Tap recognises, reports test mode, encrypts it and never returns it', async () => {
    expect((await put('tap', { enabled: true, credentials: { secretKey: KEY_A } }).expect(200)).body).toEqual({ provider: 'tap', enabled: true, configured: true, mode: 'test' });
    const list = await t.http().get(`/v1/stores/${A}/payment-methods`).set(alice.auth).expect(200);
    expect(list.body.find((m: { provider: string }) => m.provider === 'tap')).toMatchObject({ configured: true, enabled: true, mode: 'test' });
    expect(JSON.stringify(list.body)).not.toContain('FakeTapKey');
    const row = (await ownerQuery<{ credentials_enc: string }>("SELECT credentials_enc FROM payment_methods WHERE store_id = $1 AND provider = 'tap'", [A]))[0]!;
    expect(row.credentials_enc).not.toContain('FakeTapKey');
    const audit = await ownerQuery<{ metadata: unknown }>("SELECT metadata FROM audit_logs WHERE store_id = $1 AND entity_id = 'tap'", [A]);
    expect(JSON.stringify(audit)).not.toContain('FakeTapKey');
    // Switching it off and on again keeps the stored key.
    await put('tap', { enabled: false }).expect(200);
    expect((await put('tap', { enabled: true }).expect(200)).body).toMatchObject({ configured: true, mode: 'test' });
  });
});

describe('paying an order through Tap', () => {
  let token: string;
  let number: number;
  let chargeId: string;

  it('checkout creates a Tap charge for the server-computed total and sends the shopper to Tap', async () => {
    const before = await stock();
    const res = await placeTap();
    ({ token, orderNumber: number } = res.body);
    const all = await charges();
    const charge = all[all.length - 1]!;
    chargeId = charge.id;
    expect(res.body.redirectUrl).toBe(`${TAP}/pay/${chargeId}`);
    expect(charge.request).toMatchObject({
      amount: 9.5, currency: 'KWD', source: { id: 'src_all' }, reference: { order: String(number) },
      customer: { first_name: 'سارة أحمد', email: 'sara@example.com', phone: { country_code: '965', number: '50001234' } },
      redirect: { url: `https://${hostA}/ar/orders/${token}` },
      post: { url: `http://127.0.0.1:9/v1/webhooks/payments/tap/${A}` },
    });
    expect(charge.headers.lang_code).toBe('ar');
    expect(JSON.stringify(charge.request)).not.toContain('sk_test');
    expect(await orderRow(number)).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
    expect(await paymentsOf((await orderRow(number)).id)).toEqual([{ status: 'PENDING', provider_ref: chargeId }]);
    expect(await stock()).toBe(before - 1);
  });

  it('the order page offers to pay while the order is unpaid', async () => {
    expect((await sf('get', `/orders/${token}`).expect(200)).body).toMatchObject({ paymentStatus: 'UNPAID', canPay: true, paymentFailed: false });
  });

  it('coming back from Tap without paying changes nothing, whatever the browser claims', async () => {
    expect((await sf('post', `/orders/${token}/sync-payment?ref=${chargeId}`).expect(200)).body).toEqual({ checked: true });
    expect(await orderRow(number)).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
  });

  it('a forged "captured" notification does not pay the order: the status is read from Tap', async () => {
    await webhook({ id: chargeId, status: 'CAPTURED', amount: 9.5, currency: 'KWD' }).expect(200);
    expect(await orderRow(number)).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
    await webhook({ id: 'chg_madeUpCharge0001', status: 'CAPTURED', amount: 9.5, currency: 'KWD' }).expect(502);
    await webhook({ id: '../../v2/charges/list', status: 'CAPTURED' }).expect(401);
    await t.http().post(`/v1/webhooks/payments/tap/${A}`).set('content-type', 'application/json').send('not json').expect(400);
  });

  it('after the shopper pays at Tap, returning to the shop marks the order paid and confirmed, once', async () => {
    await setCharge(chargeId, { status: 'CAPTURED' });
    await sf('post', `/orders/${token}/sync-payment?ref=${chargeId}`).expect(200);
    const row = await orderRow(number);
    expect(row).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
    expect(await paymentsOf(row.id)).toEqual([{ status: 'PAID', provider_ref: chargeId }]);
    expect((await sf('get', `/orders/${token}`).expect(200)).body).toMatchObject({ paymentStatus: 'PAID', canPay: false });
    // The notification arriving afterwards, and another return, are harmless repeats.
    expect((await webhook({ id: chargeId, status: 'CAPTURED' }).expect(200)).body).toMatchObject({ duplicate: true });
    expect((await sf('post', `/orders/${token}/sync-payment`).expect(200)).body).toEqual({ checked: false });
    const events = await ownerQuery<{ type: string }>('SELECT type FROM order_events WHERE order_id = $1 ORDER BY created_at', [row.id]);
    expect(events.map((e) => e.type)).toEqual(['placed', 'payment_received']);
    expect((await sf('post', `/orders/${token}/pay`).expect(409)).body.message).toBe('order_not_payable');
  });

  it('a notification alone (the shopper never came back) also pays the order', async () => {
    const res = await placeTap();
    const id = (await charges()).pop()!.id;
    await setCharge(id, { status: 'CAPTURED' });
    expect((await webhook({ id }).expect(200)).body).toMatchObject({ status: 'PROCESSED' });
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
  });

  it('a captured charge for a different amount or currency does not pay the order', async () => {
    for (const change of [{ amount: 1 }, { currency: 'USD' }]) {
      const res = await placeTap();
      const id = (await charges()).pop()!.id;
      await setCharge(id, { ...change, status: 'CAPTURED' });
      await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
      expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
      const ev = await ownerQuery<{ status: string; error: string }>("SELECT status, error FROM webhook_events WHERE store_id = $1 AND event_id = $2", [A, `${id}:CAPTURED`]);
      expect(ev).toEqual([{ status: 'FAILED', error: 'amount_mismatch' }]);
    }
  });

  it('a declined payment is shown as failed and the shopper can try again', async () => {
    const res = await placeTap();
    const first = (await charges()).pop()!.id;
    await setCharge(first, { status: 'DECLINED' });
    await sf('post', `/orders/${res.body.token}/sync-payment?ref=${first}`).expect(200);
    expect((await sf('get', `/orders/${res.body.token}`).expect(200)).body).toMatchObject({ paymentStatus: 'UNPAID', paymentFailed: true, canPay: true });

    const again = await sf('post', `/orders/${res.body.token}/pay`).expect(200);
    const second = (await charges()).pop()!;
    expect(second.id).not.toBe(first);
    expect(again.body.redirectUrl).toBe(`${TAP}/pay/${second.id}`);
    expect(second.request.amount).toBe(9.5);
    await setCharge(second.id, { status: 'CAPTURED' });
    await sf('post', `/orders/${res.body.token}/sync-payment?ref=${second.id}`).expect(200);
    const row = await orderRow(res.body.orderNumber);
    expect(row).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
    expect((await paymentsOf(row.id)).map((p) => p.status)).toEqual(['FAILED', 'PAID']);
  });

  it('paying an earlier page after a second attempt is recorded as a duplicate payment, not lost', async () => {
    const res = await placeTap();
    const first = (await charges()).pop()!.id;
    await sf('post', `/orders/${res.body.token}/pay`).expect(200);
    const second = (await charges()).pop()!.id;
    await setCharge(second, { status: 'CAPTURED' });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    await setCharge(first, { status: 'CAPTURED' });
    await webhook({ id: first }).expect(200);
    const row = await orderRow(res.body.orderNumber);
    expect(row.payment_status).toBe('PAID');
    expect((await paymentsOf(row.id)).map((p) => p.status)).toEqual(['PAID', 'PAID']);
    const events = await ownerQuery<{ type: string }>('SELECT type FROM order_events WHERE order_id = $1 ORDER BY created_at', [row.id]);
    expect(events.map((e) => e.type)).toEqual(['placed', 'payment_retry', 'payment_received', 'duplicate_payment']);
  });

  it('a reference from another order is never looked up for this one', async () => {
    const res = await placeTap();
    const own = (await charges()).pop()!.id;
    // `ref` names the paid charge of the first order; only this order's own charge is checked.
    await sf('post', `/orders/${res.body.token}/sync-payment?ref=${chargeId}`).expect(200);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ payment_status: 'UNPAID' });
    expect((await paymentsOf((await orderRow(res.body.orderNumber)).id))[0]!.provider_ref).toBe(own);
  });

  it('a cancelled order cannot be paid, and attempts are limited', async () => {
    const res = await placeTap();
    for (let i = 0; i < 4; i++) await sf('post', `/orders/${res.body.token}/pay`).expect(200);
    expect((await sf('post', `/orders/${res.body.token}/pay`).expect(409)).body.message).toBe('too_many_payment_attempts');
    const row = await orderRow(res.body.orderNumber);
    await t.http().post(`/v1/stores/${A}/orders/${row.id}/transition`).set(alice.auth).send({ to: 'CANCELLED' }).expect(200);
    expect((await sf('post', `/orders/${res.body.token}/pay`).expect(409)).body.message).toBe('order_not_payable');
    expect((await sf('get', `/orders/${res.body.token}`).expect(200)).body.canPay).toBe(false);
  });

  it('when Tap is down, checkout fails cleanly: no order, no stock taken, cart kept', async () => {
    const before = await stock();
    const orders = (await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length;
    const cartToken = await cart();
    await control('/down', { down: true });
    const res = await sf('post', '/checkout').set('x-cart-token', cartToken).send({
      fulfillment: 'DELIVERY', zoneId: zone, address: { area: 'السالمية', block: '10', street: 'شارع', building: '1' },
      customer: { name: 'سارة', phone: '50001234' }, paymentProvider: 'tap', locale: 'ar', idempotencyKey: randomBytes(16).toString('hex'),
    }).expect(502);
    await control('/down', { down: false });
    expect(res.body.message).toBe('payment_provider_error');
    expect(await stock()).toBe(before);
    expect((await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length).toBe(orders);
    expect((await sf('get', '/cart').set('x-cart-token', cartToken).expect(200)).body.items).toHaveLength(1);
  });
});

describe('stores are separate Tap accounts', () => {
  it("another store's key cannot see or settle this store's charges", async () => {
    await put('tap', { enabled: true, credentials: { secretKey: KEY_B } }, bob, B).expect(200);
    const res = await placeTap();
    const id = (await charges()).pop()!.id;
    await setCharge(id, { status: 'CAPTURED' });
    // Sent to store B's endpoint: B's key cannot read A's charge at Tap, and B has no such payment.
    await webhook({ id }, B).expect(502);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ payment_status: 'UNPAID' });
    // The order link does not work on the other shop.
    await sf('post', `/orders/${res.body.token}/sync-payment`, hostB).expect(404);
    await sf('post', `/orders/${res.body.token}/pay`, hostB).expect(404);
    await webhook({ id }).expect(200);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ payment_status: 'PAID' });
  });

  it('only members with the payments permission can set the key', async () => {
    await put('tap', { enabled: true, credentials: { secretKey: KEY_B } }, bob, A).expect(404);
  });
});
