import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createStore, createTestApp, ownerQuery, resetDb, signUp, type Session, type TestApp } from './helpers';

/**
 * MyFatoorah adapter against the local stand-in (apps/e2e/fake-myfatoorah.mjs),
 * which copies the request and response envelopes of MyFatoorah's v2 API.
 * These tests prove our side of the contract, not MyFatoorah's behaviour.
 */
const PORT = 2598;
const MF = `http://127.0.0.1:${PORT}`;
const TOKEN_A = 'FakeMyFatoorahToken_0000000001';
const TOKEN_B = 'FakeMyFatoorahToken_0000000002';

let fake: ChildProcess;
let t: TestApp;
let alice: Session;
let bob: Session;
let A: string;
let B: string;
let oudV: string;
let zone: string;
const hostA = 'mf-a.mtjari.cc';
const hostB = 'mf-b.mtjari.cc';

type Invoice = { InvoiceId: number; InvoiceStatus: string; InvoiceValue: number; request: Record<string, any> };
const control = async <T>(path: string, body?: unknown): Promise<T> =>
  (await fetch(`${MF}/__control${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json() as Promise<T>;
const lastInvoice = async () => (await control<Invoice[]>('/invoices')).pop()!;
const setInvoice = (id: number | string, body: Record<string, unknown>) => control(`/invoices/${id}`, body);

const put = (body: unknown, s = alice, store = A) => t.http().put(`/v1/stores/${store}/payment-methods/myfatoorah`).set(s.auth).send(body as object);
const sf = (method: 'get' | 'post', path: string, host = hostA) => t.http()[method](`/v1/storefront${path}`).set('x-store-host', host);
const stock = async () => (await ownerQuery<{ stock_quantity: number }>('SELECT stock_quantity FROM product_variants WHERE id = $1', [oudV]))[0]!.stock_quantity;
const orderRow = async (number: number) =>
  (await ownerQuery<{ id: string; status: string; payment_status: string }>('SELECT id, status, payment_status FROM orders WHERE store_id = $1 AND number = $2', [A, number]))[0]!;
const paymentsOf = (orderId: string) => ownerQuery<{ status: string; provider_ref: string }>('SELECT status, provider_ref FROM payments WHERE order_id = $1 ORDER BY created_at', [orderId]);

async function placeMf() {
  const cart = (await sf('post', '/cart/items').send({ variantId: oudV, quantity: 1 }).expect(200)).body.cartToken as string;
  return await sf('post', '/checkout').set('x-cart-token', cart).send({
    fulfillment: 'DELIVERY', zoneId: zone, address: { area: 'السالمية', block: '10', street: 'شارع سالم المبارك', building: '15' },
    customer: { name: 'سارة أحمد', phone: '5000 1234', email: 'sara@example.com' }, paymentProvider: 'myfatoorah', locale: 'ar',
    idempotencyKey: randomBytes(16).toString('hex'),
  }).expect(201);
}
const webhook = (body: Record<string, unknown>, store = A) =>
  t.http().post(`/v1/webhooks/payments/myfatoorah/${store}`).set('content-type', 'application/json').send(JSON.stringify(body));

beforeAll(async () => {
  fake = fork(resolve(__dirname, '../../e2e/fake-myfatoorah.mjs'), { env: { ...process.env, FAKE_MF_PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${MF}/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await resetDb();
  t = await createTestApp({ MYFATOORAH_API_URL: MF, API_PUBLIC_URL: 'https://api.mtjari.cc', WEB_URL: 'https://mtjari.cc' });
  alice = await signUp(t, 'alice@example.com');
  bob = await signUp(t, 'bob@example.com');
  A = (await createStore(t, alice, 'mf-a', 'متجر ماي فاتورة')).id;
  B = (await createStore(t, bob, 'mf-b', 'Bob MF')).id;
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

describe('the merchant enters their own MyFatoorah token', () => {
  const method = async () => ((await t.http().get(`/v1/stores/${A}/payment-methods`).set(alice.auth).expect(200)).body as Record<string, any>[]).find((m) => m.provider === 'myfatoorah')!;

  it('is listed, off and not configured, with a token field and an account-country choice', async () => {
    const m = await method();
    expect(m).toMatchObject({ kind: 'online', configured: false, enabled: false, mode: null });
    expect(m.credentialFields.map((f: { key: string; type: string }) => [f.key, f.type])).toEqual([['apiToken', 'secret'], ['account', 'select']]);
    expect(m.credentialFields[1].options.map((o: { value: string }) => o.value)).toEqual(['test', 'KW', 'BH', 'OM', 'SA', 'AE', 'QA']);
    expect((await put({ enabled: true }).expect(400)).body.message).toBe('payment_credentials_required');
    expect((await put({ enabled: true, credentials: { apiToken: TOKEN_A } }).expect(400)).body.message).toBe('payment_credentials_required');
  });

  it('refuses a malformed token, an unknown country, and a token MyFatoorah does not accept', async () => {
    expect((await put({ enabled: true, credentials: { apiToken: 'short', account: 'KW' } }).expect(400)).body.message).toBe('invalid_payment_credentials');
    expect((await put({ enabled: true, credentials: { apiToken: TOKEN_A, account: 'XX' } }).expect(400)).body.message).toBe('invalid_payment_credentials');
    expect((await put({ enabled: true, credentials: { apiToken: 'WrongMyFatoorahToken_000000001', account: 'KW' } }).expect(400)).body.message).toBe('invalid_payment_credentials');
    expect(await ownerQuery("SELECT 1 FROM payment_methods WHERE store_id = $1 AND provider = 'myfatoorah'", [A])).toHaveLength(0);
  });

  it('refuses an account whose currency is not the store currency', async () => {
    // The store sells in KWD; a Saudi MyFatoorah account invoices in SAR.
    expect((await put({ enabled: true, credentials: { apiToken: TOKEN_A, account: 'SA' } }).expect(400)).body.message).toBe('payment_currency_mismatch');
  });

  it('does not store a token it could not check because MyFatoorah is unreachable', async () => {
    await control('/down', { down: true });
    expect((await put({ enabled: true, credentials: { apiToken: TOKEN_A, account: 'KW' } }).expect(502)).body.message).toBe('payment_provider_unreachable');
    await control('/down', { down: false });
    expect(await ownerQuery("SELECT 1 FROM payment_methods WHERE store_id = $1 AND provider = 'myfatoorah'", [A])).toHaveLength(0);
  });

  it('accepts a good token: live mode for a country account, the token encrypted and never returned', async () => {
    expect((await put({ enabled: true, credentials: { apiToken: TOKEN_A, account: 'KW' } }).expect(200)).body).toEqual({ provider: 'myfatoorah', enabled: true, configured: true, mode: 'live' });
    const m = await method();
    expect(m).toMatchObject({ configured: true, enabled: true, mode: 'live' });
    // The country choice is shown back; the token is not.
    expect(m.credentialFields.map((f: { value: string | null }) => f.value)).toEqual([null, 'KW']);
    expect(JSON.stringify(m)).not.toContain('FakeMyFatoorahToken');
    const row = (await ownerQuery<{ credentials_enc: string }>("SELECT credentials_enc FROM payment_methods WHERE store_id = $1 AND provider = 'myfatoorah'", [A]))[0]!;
    expect(row.credentials_enc).not.toContain('FakeMyFatoorahToken');
    // Changing only the account to the demo one keeps the stored token and shows test mode.
    expect((await put({ enabled: true, credentials: { account: 'test' } }).expect(200)).body).toMatchObject({ mode: 'test' });
    expect((await put({ enabled: true, credentials: { account: 'KW' } }).expect(200)).body).toMatchObject({ mode: 'live' });
  });
});

describe('paying an order through MyFatoorah', () => {
  let token: string;
  let number: number;
  let invoiceId: number;

  it('checkout creates an invoice for the server-computed total and sends the shopper to MyFatoorah', async () => {
    const before = await stock();
    const res = await placeMf();
    ({ token, orderNumber: number } = res.body);
    const invoice = await lastInvoice();
    invoiceId = invoice.InvoiceId;
    expect(res.body.redirectUrl).toBe(`${MF}/pay/${invoiceId}`);
    const row = await orderRow(number);
    expect(invoice.request).toEqual({
      CustomerName: 'سارة أحمد', NotificationOption: 'LNK', InvoiceValue: 9.5, DisplayCurrencyIso: 'KWD', MobileCountryCode: '+965', CustomerMobile: '50001234',
      CustomerEmail: 'sara@example.com', Language: 'AR', CustomerReference: row.id, UserDefinedField: `متجر ماي فاتورة #${number}`,
      CallBackUrl: `https://${hostA}/ar/orders/${token}`, ErrorUrl: `https://${hostA}/ar/orders/${token}`,
      WebhookUrl: `https://api.mtjari.cc/v1/webhooks/payments/myfatoorah/${A}`,
    });
    expect(row).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
    expect(await paymentsOf(row.id)).toEqual([{ status: 'PENDING', provider_ref: String(invoiceId) }]);
    expect(await stock()).toBe(before - 1);
  });

  it('coming back without paying, or a forged "paid" notification, changes nothing', async () => {
    expect((await sf('post', `/orders/${token}/sync-payment`).expect(200)).body).toEqual({ checked: true });
    await webhook({ Event: { Code: 1, Name: 'PAYMENT_STATUS_CHANGED' }, Data: { Invoice: { Id: String(invoiceId), Status: 'PAID' }, Transaction: { Status: 'SUCCESS' } } }).expect(200);
    await webhook({ EventType: 1, Data: { InvoiceId: invoiceId, TransactionStatus: 'SUCCESS' } }).expect(200);
    expect(await orderRow(number)).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
    expect((await sf('get', `/orders/${token}`).expect(200)).body).toMatchObject({ canPay: true, paymentFailed: false });
    await webhook({ Data: { Invoice: { Id: '999999999' } } }).expect(502);
    await webhook({ Data: { Invoice: { Id: '1 OR 1=1' } } }).expect(401);
    await webhook({ Data: {} }).expect(401);
  });

  it('after the shopper pays at MyFatoorah, returning to the shop marks the order paid and confirmed, once', async () => {
    await setInvoice(invoiceId, { attempt: 'pay' });
    await sf('post', `/orders/${token}/sync-payment`).expect(200);
    const row = await orderRow(number);
    expect(row).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
    expect(await paymentsOf(row.id)).toEqual([{ status: 'PAID', provider_ref: String(invoiceId) }]);
    expect((await webhook({ Data: { Invoice: { Id: String(invoiceId) } } }).expect(200)).body).toMatchObject({ duplicate: true });
    const events = await ownerQuery<{ type: string }>('SELECT type FROM order_events WHERE order_id = $1 ORDER BY created_at', [row.id]);
    expect(events.map((e) => e.type)).toEqual(['placed', 'payment_received']);
  });

  it('a notification alone (webhook v1 or v2 shape) also pays the order', async () => {
    for (const shape of ['v1', 'v2'] as const) {
      const res = await placeMf();
      const id = (await lastInvoice()).InvoiceId;
      await setInvoice(id, { attempt: 'pay' });
      const body = shape === 'v1' ? { EventType: 1, Data: { InvoiceId: id } } : { Event: { Code: 1 }, Data: { Invoice: { Id: String(id) } } };
      expect((await webhook(body).expect(200)).body).toMatchObject({ status: 'PROCESSED' });
      expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
    }
  });

  it('a paid invoice for a different amount does not pay the order', async () => {
    const res = await placeMf();
    const id = (await lastInvoice()).InvoiceId;
    await setInvoice(id, { value: 1, attempt: 'pay' });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'PENDING', payment_status: 'UNPAID' });
    expect(await ownerQuery<{ error: string }>('SELECT error FROM webhook_events WHERE store_id = $1 AND event_id = $2', [A, `${id}:PAID`])).toEqual([{ error: 'amount_mismatch' }]);
  });

  it('a failed attempt is shown as failed; paying the same invoice afterwards still pays the order', async () => {
    const res = await placeMf();
    const id = (await lastInvoice()).InvoiceId;
    await setInvoice(id, { attempt: 'decline' });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    expect((await sf('get', `/orders/${res.body.token}`).expect(200)).body).toMatchObject({ paymentStatus: 'UNPAID', paymentFailed: true, canPay: true });
    await setInvoice(id, { attempt: 'pay' });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
  });

  it('"pay again" makes a new invoice; an earlier invoice paid later is found when the shopper returns', async () => {
    const res = await placeMf();
    const first = (await lastInvoice()).InvoiceId;
    const again = await sf('post', `/orders/${res.body.token}/pay`).expect(200);
    const second = (await lastInvoice()).InvoiceId;
    expect(second).not.toBe(first);
    expect(again.body.redirectUrl).toBe(`${MF}/pay/${second}`);
    // The shopper pays the first page after all.
    await setInvoice(first, { attempt: 'pay' });
    await sf('post', `/orders/${res.body.token}/sync-payment`).expect(200);
    const row = await orderRow(res.body.orderNumber);
    expect(row.payment_status).toBe('PAID');
    expect((await paymentsOf(row.id)).map((p) => p.status)).toEqual(['PAID', 'PENDING']);
  });

  it('when MyFatoorah is down, checkout fails cleanly: no order and no stock taken', async () => {
    const before = await stock();
    const orders = (await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length;
    const cart = (await sf('post', '/cart/items').send({ variantId: oudV, quantity: 1 }).expect(200)).body.cartToken as string;
    await control('/down', { down: true });
    const res = await sf('post', '/checkout').set('x-cart-token', cart).send({
      fulfillment: 'DELIVERY', zoneId: zone, address: { area: 'السالمية', block: '10', street: 'شارع', building: '1' },
      customer: { name: 'سارة', phone: '50001234' }, paymentProvider: 'myfatoorah', locale: 'en', idempotencyKey: randomBytes(16).toString('hex'),
    }).expect(502);
    await control('/down', { down: false });
    expect(res.body.message).toBe('payment_provider_error');
    expect(await stock()).toBe(before);
    expect((await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length).toBe(orders);
  });
});

describe('stores are separate MyFatoorah accounts', () => {
  it("another store's token cannot see or settle this store's invoices", async () => {
    await put({ enabled: true, credentials: { apiToken: TOKEN_B, account: 'KW' } }, bob, B).expect(200);
    const res = await placeMf();
    const id = (await lastInvoice()).InvoiceId;
    await setInvoice(id, { attempt: 'pay' });
    await webhook({ Data: { Invoice: { Id: String(id) } } }, B).expect(502);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ payment_status: 'UNPAID' });
    await sf('post', `/orders/${res.body.token}/sync-payment`, hostB).expect(404);
    await webhook({ Data: { Invoice: { Id: String(id) } } }).expect(200);
    expect(await orderRow(res.body.orderNumber)).toMatchObject({ payment_status: 'PAID' });
  });
});
