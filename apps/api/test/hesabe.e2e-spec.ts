import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createStore, createTestApp, ownerQuery, resetDb, signUp, type Session, type TestApp } from './helpers';

/**
 * Hesabe adapter against the local stand-in (apps/e2e/fake-hesabe.mjs), which copies the
 * AES-encrypted request/answer format and the endpoints of Hesabe's API. These tests prove
 * our side of the contract, not Hesabe's behaviour.
 */
const PORT = 2599;
const HS = `http://127.0.0.1:${PORT}`;
const KEYS_A = { merchantCode: '1000001', accessCode: 'aaaaaaaa-0000-4000-8000-000000000001', secretKey: 'FakeHesabeSecretKeyForTestsAAA01', ivKey: 'FakeHesabeIvA001', environment: 'sandbox' };
const KEYS_B = { merchantCode: '1000002', accessCode: 'bbbbbbbb-0000-4000-8000-000000000002', secretKey: 'FakeHesabeSecretKeyForTestsBBB02', ivKey: 'FakeHesabeIvB002', environment: 'sandbox' };

let fake: ChildProcess;
let t: TestApp;
let alice: Session;
let bob: Session;
let A: string;
let B: string;
let oudV: string;
let zone: string;
const hostA = 'hs-a.mtjari.cc';
const hostB = 'hs-b.mtjari.cc';

type Tx = { token: string; status: string; amount: string; request: Record<string, any> };
const control = async <T>(path: string, body?: unknown): Promise<T> =>
  (await fetch(`${HS}/__control${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json() as Promise<T>;
const lastTx = async () => (await control<Tx[]>('/transactions')).pop()!;
const setTx = (token: string, body: Record<string, unknown>) => control(`/transactions/${token}`, body);

const put = (body: unknown, s = alice, store = A) => t.http().put(`/v1/stores/${store}/payment-methods/hesabe`).set(s.auth).send(body as object);
const sf = (method: 'get' | 'post', path: string, host = hostA) => t.http()[method](`/v1/storefront${path}`).set('x-store-host', host);
const stock = async () => (await ownerQuery<{ stock_quantity: number }>('SELECT stock_quantity FROM product_variants WHERE id = $1', [oudV]))[0]!.stock_quantity;
const orderRow = async (number: number) =>
  (await ownerQuery<{ id: string; status: string; payment_status: string }>('SELECT id, status, payment_status FROM orders WHERE store_id = $1 AND number = $2', [A, number]))[0]!;
const paymentsOf = (orderId: string) => ownerQuery<{ status: string; provider_ref: string }>('SELECT status, provider_ref FROM payments WHERE order_id = $1 ORDER BY created_at', [orderId]);

async function placeHs() {
  const cart = (await sf('post', '/cart/items').send({ variantId: oudV, quantity: 1 }).expect(200)).body.cartToken as string;
  return await sf('post', '/checkout').set('x-cart-token', cart).send({
    fulfillment: 'DELIVERY', zoneId: zone, address: { area: 'السالمية', block: '10', street: 'شارع سالم المبارك', building: '15' },
    customer: { name: 'سارة أحمد', phone: '5000 1234', email: 'sara@example.com' }, paymentProvider: 'hesabe', locale: 'ar',
    idempotencyKey: randomBytes(16).toString('hex'),
  }).expect(201);
}
const webhook = (body: Record<string, unknown>, store = A) =>
  t.http().post(`/v1/webhooks/payments/hesabe/${store}`).set('content-type', 'application/json').send(JSON.stringify(body));

beforeAll(async () => {
  fake = fork(resolve(__dirname, '../../e2e/fake-hesabe.mjs'), { env: { ...process.env, FAKE_HESABE_PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${HS}/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await resetDb();
  t = await createTestApp({ HESABE_API_URL: HS, API_PUBLIC_URL: 'https://api.mtjari.cc', WEB_URL: 'https://mtjari.cc' });
  alice = await signUp(t, 'alice@example.com');
  bob = await signUp(t, 'bob@example.com');
  A = (await createStore(t, alice, 'hs-a', 'متجر حسابي')).id;
  B = (await createStore(t, bob, 'hs-b', 'Bob HS')).id;
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

describe('the merchant enters their own Hesabe keys', () => {
  const method = async () => ((await t.http().get(`/v1/stores/${A}/payment-methods`).set(alice.auth).expect(200)).body as Record<string, any>[]).find((m) => m.provider === 'hesabe')!;
  const stored = async () => ownerQuery("SELECT 1 FROM payment_methods WHERE store_id = $1 AND provider = 'hesabe'", [A]);

  it('is listed, off and not configured, with four secret fields and an environment choice', async () => {
    const m = await method();
    expect(m).toMatchObject({ kind: 'online', configured: false, enabled: false, mode: null });
    expect(m.credentialFields.map((f: { key: string; type: string }) => [f.key, f.type])).toEqual([
      ['merchantCode', 'secret'], ['accessCode', 'secret'], ['secretKey', 'secret'], ['ivKey', 'secret'], ['environment', 'select'],
    ]);
    expect(m.credentialFields[4].options.map((o: { value: string }) => o.value)).toEqual(['sandbox', 'production']);
    expect((await put({ enabled: true }).expect(400)).body.message).toBe('payment_credentials_required');
    expect((await put({ enabled: true, credentials: { merchantCode: '1000001' } }).expect(400)).body.message).toBe('payment_credentials_required');
  });

  it('refuses malformed values and keys Hesabe does not accept, and stores nothing', async () => {
    const bad = (c: Record<string, string>) => put({ enabled: true, credentials: { ...KEYS_A, ...c } }).expect(400);
    for (const c of <Record<string, string>[]>[{ merchantCode: 'abc' }, { accessCode: 'short' }, { secretKey: 'tooShort' }, { ivKey: 'x'.repeat(17) }, { environment: 'moon' }]) {
      expect((await bad(c)).body.message).toBe('invalid_payment_credentials');
    }
    // Well-formed but wrong: another account's access code, a wrong secret, a wrong IV, a wrong merchant code.
    for (const c of <Record<string, string>[]>[
      { accessCode: 'cccccccc-0000-4000-8000-000000000003' }, { secretKey: KEYS_B.secretKey }, { ivKey: KEYS_B.ivKey }, { merchantCode: '1000002' },
    ]) {
      expect((await bad(c)).body.message).toBe('invalid_payment_credentials');
    }
    expect(await stored()).toHaveLength(0);
  });

  it('refuses a store whose currency is not KWD', async () => {
    await ownerQuery("UPDATE stores SET currency = 'SAR' WHERE id = $1", [A]);
    try {
      expect((await put({ enabled: true, credentials: KEYS_A }).expect(400)).body.message).toBe('payment_currency_mismatch');
    } finally {
      await ownerQuery("UPDATE stores SET currency = 'KWD' WHERE id = $1", [A]);
    }
    expect(await stored()).toHaveLength(0);
  });

  it('does not store keys it could not check because Hesabe is unreachable', async () => {
    await control('/down', { down: true });
    expect((await put({ enabled: true, credentials: KEYS_A }).expect(502)).body.message).toBe('payment_provider_unreachable');
    await control('/down', { down: false });
    expect(await stored()).toHaveLength(0);
  });

  it('accepts good keys: test mode for sandbox, everything encrypted and never returned', async () => {
    expect((await put({ enabled: true, credentials: KEYS_A }).expect(200)).body).toEqual({ provider: 'hesabe', enabled: true, configured: true, mode: 'test' });
    const m = await method();
    expect(m).toMatchObject({ configured: true, enabled: true, mode: 'test' });
    expect(m.credentialFields.map((f: { value: string | null }) => f.value)).toEqual([null, null, null, null, 'sandbox']);
    const row = (await ownerQuery<{ credentials_enc: string }>("SELECT credentials_enc FROM payment_methods WHERE store_id = $1 AND provider = 'hesabe'", [A]))[0]!;
    for (const secret of [KEYS_A.accessCode, KEYS_A.secretKey, KEYS_A.ivKey]) {
      expect(JSON.stringify(m)).not.toContain(secret);
      expect(row.credentials_enc).not.toContain(secret);
    }
    // Switching only the environment keeps the stored keys and shows live mode.
    expect((await put({ enabled: true, credentials: { environment: 'production' } }).expect(200)).body).toMatchObject({ mode: 'live' });
    expect((await put({ enabled: true, credentials: { environment: 'sandbox' } }).expect(200)).body).toMatchObject({ mode: 'test' });
  });
});

describe('paying an order through Hesabe', () => {
  let token: string;
  let number: number;
  let ref: string;

  it('checkout creates a transaction for the server-computed total and sends the shopper to Hesabe', async () => {
    const before = await stock();
    const res = await placeHs();
    ({ token, orderNumber: number } = res.body);
    const tx = await lastTx();
    ref = tx.token;
    expect(res.body.redirectUrl).toMatch(new RegExp(`^${HS}/payment\\?data=[0-9a-f]+$`));
    const row = await orderRow(number);
    expect(tx.request).toEqual({
      merchantCode: '1000001', amount: 9.5, paymentType: 0, currency: 'KWD', orderReferenceNumber: row.id, version: '3.0',
      responseUrl: `https://${hostA}/ar/orders/${token}`, failureUrl: `https://${hostA}/ar/orders/${token}`,
      name: 'سارة أحمد', mobile_number: '50001234', email: 'sara@example.com', variable1: String(number),
      webhookUrl: `https://api.mtjari.cc/v1/webhooks/payments/hesabe/${A}`,
    });
    expect(row).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
    expect(await paymentsOf(row.id)).toEqual([{ status: 'PENDING', provider_ref: ref }]);
    expect(await stock()).toBe(before - 1);
  });

  it('coming back without paying, or a forged "paid" notification, changes nothing', async () => {
    expect((await sf('post', `/orders/${token}/sync-payment`).expect(200)).body).toEqual({ checked: true });
    await webhook({ token: ref, status: 'SUCCESSFUL' }).expect(200);
    await webhook({ token: ref, resultCode: 'CAPTURED', amount: '9.500' }).expect(200);
    expect(await orderRow(number)).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
    expect((await sf('get', `/orders/${token}`).expect(200)).body).toMatchObject({ canPay: true, paymentFailed: false });
    await webhook({ token: '99999999999999' }).expect(200);
    expect(await orderRow(number)).toMatchObject({ payment_status: 'UNPAID' });
    await webhook({ token: '1 OR 1=1' }).expect(401);
    await webhook({}).expect(401);
  });

  it('after the shopper pays at Hesabe, returning to the shop marks the order paid and confirmed, once', async () => {
    await setTx(ref, { attempt: 'pay' });
    await sf('post', `/orders/${token}/sync-payment`).expect(200);
    const row = await orderRow(number);
    expect(row).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
    expect(await paymentsOf(row.id)).toEqual([{ status: 'PAID', provider_ref: ref }]);
    expect((await webhook({ token: ref }).expect(200)).body).toMatchObject({ duplicate: true });
    const events = await ownerQuery<{ type: string }>('SELECT type FROM order_events WHERE order_id = $1 ORDER BY created_at', [row.id]);
    expect(events.map((e) => e.type)).toEqual(['placed', 'payment_received']);
  });

  it('a notification alone also pays the order', async () => {
    const res = await placeHs();
    const tx = await lastTx();
    await setTx(tx.token, { attempt: 'pay' });
    expect((await webhook({ token: tx.token }).expect(200)).body).toBeDefined();
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
  });

  it('a paid transaction for a different amount does not pay the order', async () => {
    const res = await placeHs();
    const tx = await lastTx();
    await setTx(tx.token, { amount: 1, attempt: 'pay' });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
    expect(await ownerQuery<{ error: string }>('SELECT error FROM webhook_events WHERE store_id = $1 AND event_id = $2', [A, `${tx.token}:SUCCESSFUL`])).toEqual([{ error: 'amount_mismatch' }]);
  });

  it('a failed attempt is shown as failed; paying the same transaction afterwards still pays the order', async () => {
    const res = await placeHs();
    const tx = await lastTx();
    await setTx(tx.token, { attempt: 'decline' });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    expect((await sf('get', `/orders/${res.body.token}`).expect(200)).body).toMatchObject({ paymentStatus: 'UNPAID', paymentFailed: true, canPay: true });
    await setTx(tx.token, { attempt: 'pay' });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
  });

  it('"pay again" makes a new transaction; an earlier one paid later is found when the shopper returns', async () => {
    const res = await placeHs();
    const first = (await lastTx()).token;
    const again = await sf('post', `/orders/${res.body.token}/pay`).expect(200);
    const second = (await lastTx()).token;
    expect(second).not.toBe(first);
    expect(again.body.redirectUrl).toMatch(new RegExp(`^${HS}/payment\\?data=`));
    await setTx(first, { attempt: 'pay' });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    const row = await orderRow(res.body.orderNumber);
    expect(row.payment_status).toBe('PAID');
    expect((await paymentsOf(row.id)).map((p) => p.status)).toEqual(['PAID', 'PENDING']);
  });

  it('when Hesabe is down, checkout fails cleanly: no order and no stock taken', async () => {
    const before = await stock();
    const orders = (await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length;
    const cart = (await sf('post', '/cart/items').send({ variantId: oudV, quantity: 1 }).expect(200)).body.cartToken as string;
    await control('/down', { down: true });
    const res = await sf('post', '/checkout').set('x-cart-token', cart).send({
      fulfillment: 'DELIVERY', zoneId: zone, address: { area: 'السالمية', block: '10', street: 'شارع', building: '1' },
      customer: { name: 'سارة', phone: '50001234' }, paymentProvider: 'hesabe', locale: 'en', idempotencyKey: randomBytes(16).toString('hex'),
    }).expect(502);
    await control('/down', { down: false });
    expect(res.body.message).toBe('payment_provider_unreachable');
    expect(await stock()).toBe(before);
    expect((await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length).toBe(orders);
  });
});

describe('stores are separate Hesabe accounts', () => {
  it("another store's keys cannot see or settle this store's transactions", async () => {
    await put({ enabled: true, credentials: KEYS_B }, bob, B).expect(200);
    const res = await placeHs();
    const tx = await lastTx();
    await setTx(tx.token, { attempt: 'pay' });
    // Store B's webhook endpoint asks Hesabe with B's keys, which cannot see A's transaction.
    await webhook({ token: tx.token }, B).expect(200);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ payment_status: 'UNPAID' });
    await sf('post', `/orders/${res.body.token}/sync-payment`, hostB).expect(404);
    await webhook({ token: tx.token }).expect(200);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ payment_status: 'PAID' });
  });
});
