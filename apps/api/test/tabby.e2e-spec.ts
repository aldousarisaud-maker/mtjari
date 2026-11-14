import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createStore, createTestApp, ownerQuery, resetDb, signUp, type Session, type TestApp } from './helpers';

/**
 * Tabby adapter against the local stand-in (apps/e2e/fake-tabby.mjs), which copies the paths, key
 * handling and payload shapes of Tabby's API. These tests prove our side of the contract, not Tabby's behaviour.
 */
const PORT = 2600;
const TB = `http://127.0.0.1:${PORT}`;
const KEYS_A = { secretKey: 'sk_test_FakeTabbyKeyForTestsAAAA0001', merchantCode: 'FAKEA', region: 'ai' };
const KEYS_B = { secretKey: 'sk_test_FakeTabbyKeyForTestsBBBB0002', merchantCode: 'FAKEB', region: 'ai' };

let fake: ChildProcess;
let t: TestApp;
let alice: Session;
let bob: Session;
let A: string;
let B: string;
let oudV: string;
let zone: string;
const hostA = 'tb-a.mtjari.cc';
const hostB = 'tb-b.mtjari.cc';

type Pay = { id: string; status: string; amount: string; captures: { amount: string; reference_id: string }[]; request: Record<string, any> };
const control = async <T>(path: string, body?: unknown): Promise<T> =>
  (await fetch(`${TB}/__control${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json() as Promise<T>;
const allPayments = () => control<Pay[]>('/payments');
const lastPay = async () => (await allPayments()).pop()!;
const setPay = (id: string, body: Record<string, unknown>) => control<Pay>(`/payments/${id}`, body);

const put = (body: unknown, s = alice, store = A) => t.http().put(`/v1/stores/${store}/payment-methods/tabby`).set(s.auth).send(body as object);
const sf = (method: 'get' | 'post', path: string, host = hostA) => t.http()[method](`/v1/storefront${path}`).set('x-store-host', host);
const stock = async () => (await ownerQuery<{ stock_quantity: number }>('SELECT stock_quantity FROM product_variants WHERE id = $1', [oudV]))[0]!.stock_quantity;
const orderRow = async (number: number) =>
  (await ownerQuery<{ id: string; status: string; payment_status: string }>('SELECT id, status, payment_status FROM orders WHERE store_id = $1 AND number = $2', [A, number]))[0]!;
const paymentsOf = (orderId: string) => ownerQuery<{ status: string; provider_ref: string }>('SELECT status, provider_ref FROM payments WHERE order_id = $1 ORDER BY created_at', [orderId]);

const customer = { name: 'سارة أحمد', phone: '5000 1234', email: 'sara@example.com' };
async function placeTb(c: { name: string; phone: string; email?: string } = customer) {
  const cart = (await sf('post', '/cart/items').send({ variantId: oudV, quantity: 1 }).expect(200)).body.cartToken as string;
  return sf('post', '/checkout').set('x-cart-token', cart).send({
    fulfillment: 'DELIVERY', zoneId: zone, address: { area: 'السالمية', block: '10', street: 'شارع سالم المبارك', building: '15' },
    customer: c, paymentProvider: 'tabby', locale: 'ar', idempotencyKey: randomBytes(16).toString('hex'),
  });
}
const webhook = (body: Record<string, unknown>, store = A) =>
  t.http().post(`/v1/webhooks/payments/tabby/${store}`).set('content-type', 'application/json').send(JSON.stringify(body));

beforeAll(async () => {
  fake = fork(resolve(__dirname, '../../e2e/fake-tabby.mjs'), { env: { ...process.env, FAKE_TABBY_PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${TB}/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await resetDb();
  t = await createTestApp({ TABBY_API_URL: TB, API_PUBLIC_URL: 'https://api.mtjari.cc', WEB_URL: 'https://mtjari.cc' });
  alice = await signUp(t, 'alice@example.com');
  bob = await signUp(t, 'bob@example.com');
  A = (await createStore(t, alice, 'tb-a', 'متجر تابي')).id;
  B = (await createStore(t, bob, 'tb-b', 'Bob TB')).id;
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

describe('the merchant enters their own Tabby keys', () => {
  const method = async () => ((await t.http().get(`/v1/stores/${A}/payment-methods`).set(alice.auth).expect(200)).body as Record<string, any>[]).find((m) => m.provider === 'tabby')!;
  const stored = () => ownerQuery("SELECT 1 FROM payment_methods WHERE store_id = $1 AND provider = 'tabby'", [A]);

  it('is listed, off and not configured, with two secret fields and a region choice', async () => {
    const m = await method();
    expect(m).toMatchObject({ kind: 'online', configured: false, enabled: false, mode: null });
    expect(m.credentialFields.map((f: { key: string; type: string }) => [f.key, f.type])).toEqual([['secretKey', 'secret'], ['merchantCode', 'secret'], ['region', 'select']]);
    expect(m.credentialFields[2].options.map((o: { value: string }) => o.value)).toEqual(['ai', 'sa']);
    expect((await put({ enabled: true }).expect(400)).body.message).toBe('payment_credentials_required');
    expect((await put({ enabled: true, credentials: { secretKey: KEYS_A.secretKey } }).expect(400)).body.message).toBe('payment_credentials_required');
  });

  it('refuses malformed values and keys Tabby does not accept, and stores nothing', async () => {
    const bad = (c: Record<string, string>) => put({ enabled: true, credentials: { ...KEYS_A, ...c } }).expect(400);
    for (const c of <Record<string, string>[]>[{ secretKey: 'short' }, { secretKey: 'pk_test_FakeTabbyPublicKey000001' }, { merchantCode: 'x' }, { region: 'moon' },
      { secretKey: 'sk_test_UnknownTabbyKeyForTests0001' }, { merchantCode: 'FAKEB' }, { secretKey: KEYS_B.secretKey }]) {
      expect((await bad(c)).body.message).toBe('invalid_payment_credentials');
    }
    expect(await stored()).toHaveLength(0);
  });

  it('does not store keys it could not check because Tabby is unreachable', async () => {
    await control('/down', { down: true });
    expect((await put({ enabled: true, credentials: KEYS_A }).expect(502)).body.message).toBe('payment_provider_unreachable');
    await control('/down', { down: false });
    expect(await stored()).toHaveLength(0);
  });

  it('accepts good keys: test mode for a test key, keys encrypted and never returned, our notification address registered once', async () => {
    expect((await put({ enabled: true, credentials: KEYS_A }).expect(200)).body).toEqual({ provider: 'tabby', enabled: true, configured: true, mode: 'test' });
    const m = await method();
    expect(m).toMatchObject({ configured: true, enabled: true, mode: 'test' });
    expect(m.credentialFields.map((f: { value: string | null }) => f.value)).toEqual([null, null, 'ai']);
    const row = (await ownerQuery<{ credentials_enc: string }>("SELECT credentials_enc FROM payment_methods WHERE store_id = $1 AND provider = 'tabby'", [A]))[0]!;
    for (const secret of [KEYS_A.secretKey, KEYS_A.merchantCode]) {
      expect(JSON.stringify(m)).not.toContain(secret);
      expect(row.credentials_enc).not.toContain(secret);
    }
    // Saving again (here: changing the region) keeps the keys and must not register the address a second time.
    expect((await put({ enabled: true, credentials: { region: 'sa' } }).expect(200)).body).toMatchObject({ mode: 'test' });
    expect((await put({ enabled: true, credentials: { region: 'ai' } }).expect(200)).body).toMatchObject({ mode: 'test' });
    const hooks = await control<{ url: string }[]>('/webhooks');
    expect(hooks.filter((h) => h.url === `https://api.mtjari.cc/v1/webhooks/payments/tabby/${A}`)).toHaveLength(1);
  });
});

describe('paying an order through Tabby', () => {
  let token: string;
  let number: number;
  let id: string;

  it('checkout creates a payment for the server-computed total and sends the shopper to Tabby', async () => {
    const before = await stock();
    const res = await placeTb().then((r) => { expect(r.status).toBe(201); return r; });
    ({ token, orderNumber: number } = res.body);
    const pay = await lastPay();
    id = pay.id;
    expect(res.body.redirectUrl).toBe(`${TB}/hpp/${id}`);
    const row = await orderRow(number);
    expect(pay.request).toEqual({
      payment: {
        amount: '9.500', currency: 'KWD', description: `متجر تابي #${number}`,
        buyer: { name: 'سارة أحمد', email: 'sara@example.com', phone: '+96550001234' },
        shipping_address: { city: 'السالمية', address: '10, شارع سالم المبارك, 15', zip: '00000' },
        order: { reference_id: row.id, shipping_amount: '1.500', items: [{ title: 'دهن العود', quantity: 1, unit_price: '8.000', category: 'General', reference_id: 'OUD' }] },
        buyer_history: { registered_since: expect.any(String), loyalty_level: 0 }, order_history: [],
      },
      lang: 'ar', merchant_code: 'FAKEA',
      merchant_urls: { success: `https://${hostA}/ar/orders/${token}`, cancel: `https://${hostA}/ar/orders/${token}`, failure: `https://${hostA}/ar/orders/${token}` },
    });
    expect(row).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
    expect(await paymentsOf(row.id)).toEqual([{ status: 'PENDING', provider_ref: id }]);
    expect(await stock()).toBe(before - 1);
  });

  it('coming back without paying, or a forged "authorized" notification, changes nothing and captures nothing', async () => {
    expect((await sf('post', `/orders/${token}/sync-payment`).expect(200)).body).toEqual({ checked: true });
    await webhook({ id, status: 'authorized', amount: '9.500' }).expect(200);
    await webhook({ id: '11111111-2222-4333-8444-555555555555', status: 'authorized' }).expect(502);
    await webhook({ id: 'not-a-uuid' }).expect(401);
    await webhook({}).expect(401);
    expect(await orderRow(number)).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
    expect((await sf('get', `/orders/${token}`).expect(200)).body).toMatchObject({ canPay: true, paymentFailed: false });
    expect((await lastPay()).captures).toEqual([]);
  });

  it('after the shopper pays, returning to the shop marks the order paid and confirmed, once, and captures the payment', async () => {
    await setPay(id, { attempt: 'pay' });
    await sf('post', `/orders/${token}/sync-payment?ref=${id}`).expect(200);
    const row = await orderRow(number);
    expect(row).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
    expect(await paymentsOf(row.id)).toEqual([{ status: 'PAID', provider_ref: id }]);
    const pay = await lastPay();
    expect(pay.status).toBe('CLOSED');
    expect(pay.captures).toEqual([expect.objectContaining({ amount: '9.500', reference_id: `capture-${id}` })]);
    // The notifications that follow (captured, closed) change nothing and capture nothing more.
    await webhook({ id, status: 'closed' }).expect(200);
    await webhook({ id, status: 'authorized' }).expect(200);
    expect((await lastPay()).captures).toHaveLength(1);
    const events = await ownerQuery<{ type: string }>('SELECT type FROM order_events WHERE order_id = $1 ORDER BY created_at', [row.id]);
    expect(events.map((e) => e.type)).toEqual(['placed', 'payment_received']);
  });

  it('a notification alone (shopper closed the browser) also pays the order and captures it', async () => {
    const res = await placeTb();
    const pay = await lastPay();
    await setPay(pay.id, { attempt: 'pay' });
    expect((await webhook({ id: pay.id, status: 'authorized' }).expect(200)).body).toMatchObject({ status: 'PROCESSED' });
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
    expect((await lastPay()).status).toBe('CLOSED');
  });

  it('an authorized payment for a different amount neither pays the order nor gets captured', async () => {
    const res = await placeTb();
    const pay = await lastPay();
    await setPay(pay.id, { amount: 1, attempt: 'pay' });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
    expect(await ownerQuery<{ error: string }>('SELECT error FROM webhook_events WHERE store_id = $1 AND event_id = $2', [A, `${pay.id}:AUTHORIZED`])).toEqual([{ error: 'amount_mismatch' }]);
    expect((await lastPay()).captures).toEqual([]);
  });

  it('if the capture fails the order is still paid and confirmed, and the problem is logged, not hidden in the shopper page', async () => {
    const res = await placeTb();
    const pay = await lastPay();
    await setPay(pay.id, { attempt: 'pay' });
    await control('/capture-status', { status: 500 });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    await control('/capture-status', { status: 200 });
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
    expect((await lastPay()).status).toBe('AUTHORIZED');
  });

  it('a payment closed without a capture (cancelled) does not pay the order', async () => {
    const res = await placeTb();
    const pay = await lastPay();
    await setPay(pay.id, { status: 'CLOSED' });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
  });

  it('a rejected or cancelled payment is shown as failed, and the shopper can pay again with a new payment', async () => {
    for (const attempt of ['decline', 'cancel'] as const) {
      const res = await placeTb();
      const first = await lastPay();
      await setPay(first.id, { attempt });
      await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
      expect((await sf('get', `/orders/${res.body.token}`).expect(200)).body).toMatchObject({ paymentStatus: 'UNPAID', paymentFailed: true, canPay: true });
      const again = await sf('post', `/orders/${res.body.token}/pay`).expect(200);
      const second = await lastPay();
      expect(second.id).not.toBe(first.id);
      expect(again.body.redirectUrl).toBe(`${TB}/hpp/${second.id}`);
      await setPay(second.id, { attempt: 'pay' });
      await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
      const row = await orderRow(res.body.orderNumber);
      expect(row.payment_status).toBe('PAID');
      expect((await paymentsOf(row.id)).map((p) => p.status)).toEqual(['FAILED', 'PAID']);
    }
  });

  it('an earlier payment paid after a new attempt is found when the shopper returns', async () => {
    const res = await placeTb();
    const first = (await lastPay()).id;
    await sf('post', `/orders/${res.body.token}/pay`).expect(200);
    await setPay(first, { attempt: 'pay' });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    const row = await orderRow(res.body.orderNumber);
    expect(row.payment_status).toBe('PAID');
    expect((await paymentsOf(row.id)).map((p) => p.status)).toEqual(['PAID', 'PENDING']);
  });

  it('Tabby needs an email: without one checkout says so and nothing is created; a buyer Tabby does not approve gets a clear refusal', async () => {
    const before = await stock();
    const orders = (await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length;
    expect((await placeTb({ name: 'سارة', phone: '5000 1234' })).body.message).toBe('payment_email_required');
    expect((await placeTb({ ...customer, email: 'reject@example.com' })).body.message).toBe('payment_not_approved');
    expect(await stock()).toBe(before);
    expect((await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length).toBe(orders);
  });

  it('when Tabby is down, checkout fails cleanly: no order and no stock taken', async () => {
    const before = await stock();
    const orders = (await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length;
    await control('/down', { down: true });
    const res = await placeTb();
    await control('/down', { down: false });
    expect(res.status).toBe(502);
    expect(res.body.message).toBe('payment_provider_unreachable');
    expect(await stock()).toBe(before);
    expect((await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length).toBe(orders);
  });
});

describe('stores are separate Tabby accounts', () => {
  it("another store's keys cannot see or settle this store's payments", async () => {
    await put({ enabled: true, credentials: KEYS_B }, bob, B).expect(200);
    const res = await placeTb();
    const pay = await lastPay();
    await setPay(pay.id, { attempt: 'pay' });
    // Store B's endpoint asks Tabby with B's key, which cannot see A's payment.
    await webhook({ id: pay.id }, B).expect(502);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ payment_status: 'UNPAID' });
    expect((await lastPay()).captures).toEqual([]);
    await sf('post', `/orders/${res.body.token}/sync-payment`, hostB).expect(404);
    await webhook({ id: pay.id }).expect(200);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ payment_status: 'PAID' });
  });
});
