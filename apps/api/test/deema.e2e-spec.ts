import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createStore, createTestApp, ownerQuery, resetDb, signUp, type Session, type TestApp } from './helpers';

/**
 * Deema adapter against the local stand-in (apps/e2e/fake-deema.mjs), which copies the paths, key
 * handling and payload shapes of Deema's merchant API. These tests prove our side of the contract, not Deema's behaviour.
 */
const PORT = 2601;
const DM = `http://127.0.0.1:${PORT}`;
const KEY_A = 'FakeDeemaApiKeyForTestsAAAA0001';
const KEY_B = 'FakeDeemaApiKeyForTestsBBBB0002';

let fake: ChildProcess;
let t: TestApp;
let alice: Session;
let bob: Session;
let A: string;
let B: string;
let oudV: string;
let zone: string;
const hostA = 'dm-a.mtjari.cc';
const hostB = 'dm-b.mtjari.cc';

type Ord = { order_reference: string; status: string; amount: number; request: Record<string, any> };
const control = async <T>(path: string, body?: unknown): Promise<T> =>
  (await fetch(`${DM}/__control${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json() as Promise<T>;
const lastOrd = async () => (await control<Ord[]>('/orders')).pop()!;
const setOrd = (ref: string, body: Record<string, unknown>) => control<Ord>(`/orders/${ref}`, body);

const put = (body: unknown, s = alice, store = A) => t.http().put(`/v1/stores/${store}/payment-methods/deema`).set(s.auth).send(body as object);
const sf = (method: 'get' | 'post', path: string, host = hostA) => t.http()[method](`/v1/storefront${path}`).set('x-store-host', host);
const stock = async () => (await ownerQuery<{ stock_quantity: number }>('SELECT stock_quantity FROM product_variants WHERE id = $1', [oudV]))[0]!.stock_quantity;
const orderRow = async (number: number) =>
  (await ownerQuery<{ id: string; status: string; payment_status: string }>('SELECT id, status, payment_status FROM orders WHERE store_id = $1 AND number = $2', [A, number]))[0]!;
const paymentsOf = (orderId: string) => ownerQuery<{ status: string; provider_ref: string }>('SELECT status, provider_ref FROM payments WHERE order_id = $1 ORDER BY created_at', [orderId]);

async function placeDm() {
  const cart = (await sf('post', '/cart/items').send({ variantId: oudV, quantity: 1 }).expect(200)).body.cartToken as string;
  return sf('post', '/checkout').set('x-cart-token', cart).send({
    fulfillment: 'DELIVERY', zoneId: zone, address: { area: 'السالمية', block: '10', street: 'شارع سالم المبارك', building: '15' },
    customer: { name: 'سارة أحمد', phone: '5000 1234' }, paymentProvider: 'deema', locale: 'ar', idempotencyKey: randomBytes(16).toString('hex'),
  });
}
const webhook = (body: Record<string, unknown>, store = A) =>
  t.http().post(`/v1/webhooks/payments/deema/${store}`).set('content-type', 'application/json').send(JSON.stringify(body));

beforeAll(async () => {
  fake = fork(resolve(__dirname, '../../e2e/fake-deema.mjs'), { env: { ...process.env, FAKE_DEEMA_PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${DM}/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await resetDb();
  t = await createTestApp({ DEEMA_API_URL: DM, API_PUBLIC_URL: 'https://api.mtjari.cc', WEB_URL: 'https://mtjari.cc' });
  alice = await signUp(t, 'alice@example.com');
  bob = await signUp(t, 'bob@example.com');
  A = (await createStore(t, alice, 'dm-a', 'متجر ديما')).id;
  B = (await createStore(t, bob, 'dm-b', 'Bob DM')).id;
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

describe('the merchant enters their own Deema API key', () => {
  const method = async () => ((await t.http().get(`/v1/stores/${A}/payment-methods`).set(alice.auth).expect(200)).body as Record<string, any>[]).find((m) => m.provider === 'deema')!;
  const stored = () => ownerQuery("SELECT 1 FROM payment_methods WHERE store_id = $1 AND provider = 'deema'", [A]);

  it('is listed, off and not configured, with a key field, an environment choice and the notification address to enter in Deema', async () => {
    const m = await method();
    expect(m).toMatchObject({ kind: 'online', configured: false, enabled: false, mode: null, webhookUrl: `https://api.mtjari.cc/v1/webhooks/payments/deema/${A}` });
    expect(m.credentialFields.map((f: { key: string; type: string }) => [f.key, f.type])).toEqual([['apiKey', 'secret'], ['environment', 'select']]);
    expect(m.credentialFields[1].options.map((o: { value: string }) => o.value)).toEqual(['sandbox', 'production']);
    expect((await put({ enabled: true }).expect(400)).body.message).toBe('payment_credentials_required');
  });

  it('refuses a malformed key, an unknown environment, a key Deema does not accept and a store that is not in KWD; stores nothing', async () => {
    const bad = (c: Record<string, string>) => put({ enabled: true, credentials: { apiKey: KEY_A, environment: 'sandbox', ...c } }).expect(400);
    for (const c of <Record<string, string>[]>[{ apiKey: 'short' }, { apiKey: 'has a space in the key 000000' }, { environment: 'moon' }, { apiKey: 'WrongDeemaApiKeyForTestsAAAA01' }]) {
      expect((await bad(c)).body.message).toBe('invalid_payment_credentials');
    }
    await ownerQuery("UPDATE stores SET currency = 'SAR' WHERE id = $1", [A]);
    try {
      expect((await bad({})).body.message).toBe('payment_currency_mismatch');
    } finally {
      await ownerQuery("UPDATE stores SET currency = 'KWD' WHERE id = $1", [A]);
    }
    expect(await stored()).toHaveLength(0);
  });

  it('does not store a key it could not check because Deema is unreachable', async () => {
    await control('/down', { down: true });
    expect((await put({ enabled: true, credentials: { apiKey: KEY_A, environment: 'sandbox' } }).expect(502)).body.message).toBe('payment_provider_unreachable');
    await control('/down', { down: false });
    expect(await stored()).toHaveLength(0);
  });

  it('accepts a good key without creating anything at Deema: test mode for sandbox, key encrypted and never returned', async () => {
    const before = (await control<Ord[]>('/orders')).length;
    expect((await put({ enabled: true, credentials: { apiKey: KEY_A, environment: 'sandbox' } }).expect(200)).body).toEqual({ provider: 'deema', enabled: true, configured: true, mode: 'test' });
    expect((await control<Ord[]>('/orders')).length).toBe(before);
    const m = await method();
    expect(m).toMatchObject({ configured: true, enabled: true, mode: 'test' });
    expect(m.credentialFields.map((f: { value: string | null }) => f.value)).toEqual([null, 'sandbox']);
    const row = (await ownerQuery<{ credentials_enc: string }>("SELECT credentials_enc FROM payment_methods WHERE store_id = $1 AND provider = 'deema'", [A]))[0]!;
    expect(JSON.stringify(m)).not.toContain(KEY_A);
    expect(row.credentials_enc).not.toContain(KEY_A);
    expect((await put({ enabled: true, credentials: { environment: 'production' } }).expect(200)).body).toMatchObject({ mode: 'live' });
    expect((await put({ enabled: true, credentials: { environment: 'sandbox' } }).expect(200)).body).toMatchObject({ mode: 'test' });
  });
});

describe('paying an order through Deema', () => {
  let token: string;
  let number: number;
  let ref: string;

  it('checkout creates a Deema order for the server-computed total and sends the shopper to Deema', async () => {
    const before = await stock();
    const res = await placeDm();
    expect(res.status).toBe(201);
    ({ token, orderNumber: number } = res.body);
    const o = await lastOrd();
    ref = o.order_reference;
    expect(res.body.redirectUrl).toBe(`${DM}/pay?order_reference=${ref}`);
    const row = await orderRow(number);
    expect(o.request).toEqual({
      amount: 9.5, currency_code: 'KWD', merchant_order_id: row.id,
      merchant_urls: { success: `https://${hostA}/ar/orders/${token}?pay_return=1`, failure: `https://${hostA}/ar/orders/${token}?pay_return=1` },
    });
    expect(row).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
    expect(await paymentsOf(row.id)).toEqual([{ status: 'PENDING', provider_ref: ref }]);
    expect(await stock()).toBe(before - 1);
  });

  it('coming back without paying, an "authorized" order, or a forged "captured" notification changes nothing', async () => {
    expect((await sf('post', `/orders/${token}/sync-payment`).expect(200)).body).toEqual({ checked: true });
    await webhook({ order_ref: ref, status: 'captured', purchase_id: 1 }).expect(200);
    await setOrd(ref, { attempt: 'authorize' });
    await webhook({ order_ref: ref, status: 'captured' }).expect(200);
    await webhook({ order_ref: '11111111-2222-4333-8444-555555555555' }).expect(502);
    await webhook({ order_ref: 'not-a-uuid' }).expect(401);
    await webhook({}).expect(401);
    expect(await orderRow(number)).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
    expect((await sf('get', `/orders/${token}`).expect(200)).body).toMatchObject({ canPay: true, paymentFailed: false });
  });

  it('after the shopper pays, returning to the shop marks the order paid and confirmed, once', async () => {
    await setOrd(ref, { attempt: 'pay' });
    await sf('post', `/orders/${token}/sync-payment`).expect(200);
    const row = await orderRow(number);
    expect(row).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
    expect(await paymentsOf(row.id)).toEqual([{ status: 'PAID', provider_ref: ref }]);
    expect((await webhook({ order_ref: ref, status: 'captured' }).expect(200)).body).toMatchObject({ duplicate: true });
    const events = await ownerQuery<{ type: string }>('SELECT type FROM order_events WHERE order_id = $1 ORDER BY created_at', [row.id]);
    expect(events.map((e) => e.type)).toEqual(['placed', 'payment_received']);
  });

  it('a notification alone also pays the order, and "fully_captured" counts too', async () => {
    for (const status of ['captured', 'fully_captured']) {
      const res = await placeDm();
      const o = await lastOrd();
      await setOrd(o.order_reference, { status });
      expect((await webhook({ order_ref: o.order_reference, status }).expect(200)).body).toMatchObject({ status: 'PROCESSED' });
      expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
    }
  });

  it('a captured order for a different amount does not pay the order', async () => {
    const res = await placeDm();
    const o = await lastOrd();
    await setOrd(o.order_reference, { amount: 1, attempt: 'pay' });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
    expect(await ownerQuery<{ error: string }>('SELECT error FROM webhook_events WHERE store_id = $1 AND event_id = $2', [A, `${o.order_reference}:captured`])).toEqual([{ error: 'amount_mismatch' }]);
  });

  it('a partly captured or refunded order is not treated as a fresh payment', async () => {
    const res = await placeDm();
    const o = await lastOrd();
    for (const status of ['partially_captured', 'fully_refunded', 'pending']) {
      await setOrd(o.order_reference, { status });
      await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    }
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
  });

  it('a declined, cancelled or expired order is shown as failed, and the shopper can pay again with a new order', async () => {
    for (const status of ['declined', 'payment_cancelled', 'expired']) {
      const res = await placeDm();
      const first = await lastOrd();
      await setOrd(first.order_reference, { status });
      await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
      expect((await sf('get', `/orders/${res.body.token}`).expect(200)).body).toMatchObject({ paymentStatus: 'UNPAID', paymentFailed: true, canPay: true });
      const again = await sf('post', `/orders/${res.body.token}/pay`).expect(200);
      const second = await lastOrd();
      expect(second.order_reference).not.toBe(first.order_reference);
      expect(again.body.redirectUrl).toBe(`${DM}/pay?order_reference=${second.order_reference}`);
      await setOrd(second.order_reference, { attempt: 'pay' });
      await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
      const row = await orderRow(res.body.orderNumber);
      expect(row.payment_status).toBe('PAID');
      expect((await paymentsOf(row.id)).map((p) => p.status)).toEqual(['FAILED', 'PAID']);
    }
  });

  it('an earlier order paid after a new attempt is found when the shopper returns', async () => {
    const res = await placeDm();
    const first = (await lastOrd()).order_reference;
    await sf('post', `/orders/${res.body.token}/pay`).expect(200);
    await setOrd(first, { attempt: 'pay' });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    const row = await orderRow(res.body.orderNumber);
    expect(row.payment_status).toBe('PAID');
    expect((await paymentsOf(row.id)).map((p) => p.status)).toEqual(['PAID', 'PENDING']);
  });

  it('a customer Deema refuses gets a clear answer and nothing is created; when Deema is down checkout fails cleanly', async () => {
    const before = await stock();
    const orders = (await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length;
    await control('/refuse', { refuse: true });
    expect((await placeDm()).body.message).toBe('payment_not_approved');
    await control('/refuse', { refuse: false });
    await control('/down', { down: true });
    const down = await placeDm();
    await control('/down', { down: false });
    expect(down.status).toBe(502);
    expect(down.body.message).toBe('payment_provider_unreachable');
    expect(await stock()).toBe(before);
    expect((await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length).toBe(orders);
  });
});

describe('stores are separate Deema accounts', () => {
  it("another store's key cannot see or settle this store's orders", async () => {
    await put({ enabled: true, credentials: { apiKey: KEY_B, environment: 'sandbox' } }, bob, B).expect(200);
    const res = await placeDm();
    const o = await lastOrd();
    await setOrd(o.order_reference, { attempt: 'pay' });
    await webhook({ order_ref: o.order_reference }, B).expect(502);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ payment_status: 'UNPAID' });
    await sf('post', `/orders/${res.body.token}/sync-payment`, hostB).expect(404);
    await webhook({ order_ref: o.order_reference }).expect(200);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ payment_status: 'PAID' });
  });
});
