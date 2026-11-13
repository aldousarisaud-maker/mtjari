import { randomBytes } from 'node:crypto';
import { TestGatewayAdapter } from '../src/orders/payment-adapters';
import { createStore, createTestApp, ownerQuery, resetDb, signUp, type Session, type TestApp } from './helpers';

let t: TestApp;
let alice: Session;
let bob: Session;
let viewer: Session;
let staff: Session;
let A: string;
let B: string;
const hostA = 'orders-a.mtjari.cc';
const hostB = 'orders-b.mtjari.cc';
type Id = 'rose' | 'roseV' | 'oudV' | 'ebookV' | 'mugV' | 'zoneHawalli' | 'zoneJahra' | 'zoneCapital' | 'token1' | 'order1' | 'bobToken' | 'bobOrder';
const ids = {} as Record<Id, string>;
const SECRET = 'whsec_super_secret_value_123';

const key = () => randomBytes(16).toString('hex');
const sfGet = (path: string, host = hostA, token?: string) => {
  const r = t.http().get(`/v1/storefront${path}`).set('x-store-host', host);
  return token ? r.set('x-cart-token', token) : r;
};
const stock = async (variantId: string) => (await ownerQuery<{ stock_quantity: number }>('SELECT stock_quantity FROM product_variants WHERE id = $1', [variantId]))[0]!.stock_quantity;

async function product(storeId: string, s: Session, body: Record<string, unknown>) {
  const res = await t.http().post(`/v1/stores/${storeId}/products`).set(s.auth).send(body).expect(201);
  return res.body as { id: string; variants: { id: string; optionValues: Record<string, string> }[] };
}

async function joinAs(email: string, roleKey: string): Promise<Session> {
  const s = await signUp(t, email);
  const roles = await t.http().get(`/v1/stores/${A}/roles`).set(alice.auth).expect(200);
  const roleId = (roles.body as { id: string; key: string }[]).find((r) => r.key === roleKey)!.id;
  await t.http().post(`/v1/stores/${A}/invitations`).set(alice.auth).send({ email, roleId }).expect(201);
  await t.http().post('/v1/invitations/accept').set(s.auth).send({ token: t.mail.tokenFor(email) }).expect(200);
  return s;
}

/** Fills a new cart and returns its token. */
async function cartWith(lines: [string, number][], host = hostA): Promise<string> {
  let token: string | undefined;
  for (const [variantId, quantity] of lines) {
    const r = t.http().post('/v1/storefront/cart/items').set('x-store-host', host);
    const res = await (token ? r.set('x-cart-token', token) : r).send({ variantId, quantity }).expect(200);
    token ??= res.body.cartToken;
  }
  return token!;
}

const address = { area: 'السالمية', block: '10', street: 'شارع سالم المبارك', building: '15', floor: '2', apartment: '4', directions: 'مقابل المجمع' };
const delivery = (extra: Record<string, unknown> = {}) => ({
  fulfillment: 'DELIVERY', zoneId: ids.zoneHawalli, address, customer: { name: 'سارة أحمد', phone: '5000 1234', email: 'sara@example.com' },
  paymentProvider: 'cod', locale: 'ar', idempotencyKey: key(), ...extra,
});
const place = (token: string | undefined, body: Record<string, unknown>, host = hostA) => {
  const r = t.http().post('/v1/storefront/checkout').set('x-store-host', host);
  return (token ? r.set('x-cart-token', token) : r).send(body);
};
const orderOf = async (storeId: string, number: number) => (await ownerQuery<{ id: string }>('SELECT id FROM orders WHERE store_id = $1 AND number = $2', [storeId, number]))[0]!.id;

beforeAll(async () => {
  await resetDb();
  t = await createTestApp();
  alice = await signUp(t, 'alice@example.com');
  bob = await signUp(t, 'bob@example.com');
  A = (await createStore(t, alice, 'orders-a', 'متجر الطلبات')).id;
  B = (await createStore(t, bob, 'orders-b', 'Bob Shop')).id;
  viewer = await joinAs('viewer@example.com', 'viewer');
  staff = await joinAs('staff@example.com', 'staff');

  const rose = await product(A, alice, { nameAr: 'عطر الورد', nameEn: 'Rose Perfume', status: 'ACTIVE', variants: [{ sku: 'ROSE', price: 12500, cost: 7000, initialStock: 3 }] });
  const oud = await product(A, alice, {
    nameAr: 'دهن العود', nameEn: 'Oud Oil', status: 'ACTIVE', type: 'VARIANT', options: [{ name: 'Size', values: ['3ml'] }],
    variants: [{ optionValues: { Size: '3ml' }, sku: 'OUD-3', price: 8000, initialStock: 50 }],
  });
  const ebook = await product(A, alice, { nameEn: 'Fragrance Guide', status: 'ACTIVE', type: 'DIGITAL', variants: [{ price: 2000 }] });
  const mug = await product(B, bob, { nameEn: 'Bob Mug', status: 'ACTIVE', variants: [{ sku: 'MUG', price: 500, initialStock: 9 }] });
  Object.assign(ids, { rose: rose.id, roseV: rose.variants[0]!.id, oudV: oud.variants[0]!.id, ebookV: ebook.variants[0]!.id, mugV: mug.variants[0]!.id });

  for (const [storeId, s] of [[A, alice], [B, bob]] as const) {
    await t.http().post(`/v1/stores/${storeId}/theme/publish`).set(s.auth).send({ themeId: 'gulf-premium' }).expect(200);
    await t.http().post(`/v1/stores/${storeId}/launch`).set(s.auth).expect(200);
  }
});
afterAll(() => t.close());

describe('a store cannot take orders until it is set up', () => {
  it('no payment method and no delivery option: no checkout, and the reason is stated', async () => {
    const token = await cartWith([[ids.oudV, 1]]);
    const view = await sfGet('/checkout', hostA, token).expect(200);
    expect(view.body).toMatchObject({ available: false, unavailableReason: 'no_payment_method', paymentMethods: [], zones: [] });
    expect((await sfGet('/cart', hostA, token).expect(200)).body.checkoutAvailable).toBe(false);
    const res = await place(token, delivery({ zoneId: '5b0f5c0e-6f0a-4b54-9a51-0c9f0e3f4a11' })).expect(409);
    expect(res.body.message).toBe('checkout_unavailable');
  });
});

describe('delivery zones and checkout settings', () => {
  it('adds the Kuwait governorates once, with one fee', async () => {
    expect((await t.http().post(`/v1/stores/${A}/delivery-zones/kuwait`).set(alice.auth).send({ fee: 1500 }).expect(200)).body).toEqual({ added: 6 });
    expect((await t.http().post(`/v1/stores/${A}/delivery-zones/kuwait`).set(alice.auth).send({ fee: 9999 }).expect(200)).body).toEqual({ added: 0 });
    const zones = (await t.http().get(`/v1/stores/${A}/delivery-zones`).set(alice.auth).expect(200)).body as { id: string; nameEn: string; fee: number }[];
    expect(zones.map((z) => z.nameEn)).toEqual(['Capital', 'Hawalli', 'Farwaniya', 'Mubarak Al-Kabeer', 'Ahmadi', 'Jahra']);
    expect(zones.every((z) => z.fee === 1500)).toBe(true);
    ids.zoneHawalli = zones[1]!.id;
    ids.zoneJahra = zones[5]!.id;
    ids.zoneCapital = zones[0]!.id;
  });

  it('edits a zone: fee, free-delivery threshold, active flag; bad input is refused', async () => {
    const put = (id: string, body: unknown) => t.http().put(`/v1/stores/${A}/delivery-zones/${id}`).set(alice.auth).send(body as object);
    await put(ids.zoneCapital!, { nameAr: 'العاصمة', nameEn: 'Capital', fee: 1000, freeAbove: 20000 }).expect(200);
    await put(ids.zoneJahra!, { nameAr: 'الجهراء', nameEn: 'Jahra', fee: 3000, isActive: false }).expect(200);
    await put(ids.zoneCapital!, { nameAr: 'العاصمة', nameEn: 'Capital', fee: -5 }).expect(400);
    await put(ids.zoneCapital!, { nameAr: 'العاصمة', nameEn: '<i>Capital</i>', fee: 5 }).expect(400);
    await put(ids.zoneCapital!, { nameAr: 'العاصمة', nameEn: 'Capital', fee: 5, storeId: B }).expect(400);
  });

  it('settings and zones need the settings permission; other stores cannot touch them', async () => {
    await t.http().get(`/v1/stores/${A}/delivery-zones`).set(viewer.auth).expect(200);
    await t.http().post(`/v1/stores/${A}/delivery-zones`).set(staff.auth).send({ nameAr: 'منطقة', nameEn: 'Zone', fee: 1 }).expect(403);
    await t.http().put(`/v1/stores/${A}/checkout-settings`).set(staff.auth).send({ pickupEnabled: true }).expect(403);
    await t.http().get(`/v1/stores/${A}/delivery-zones`).set(bob.auth).expect(404);
    // Bob edits "his" zone using Alice's zone id: not found in his store.
    await t.http().put(`/v1/stores/${B}/delivery-zones/${ids.zoneHawalli}`).set(bob.auth).send({ nameAr: 'x', nameEn: 'x', fee: 0 }).expect(404);
    await t.http().delete(`/v1/stores/${B}/delivery-zones/${ids.zoneHawalli}`).set(bob.auth).expect(404);
  });

  it('pickup and minimum order are stored', async () => {
    await t.http().put(`/v1/stores/${A}/checkout-settings`).set(alice.auth).send({ pickupEnabled: true, pickupInstructionsAr: 'الاستلام من الفرع الرئيسي', pickupInstructionsEn: 'Collect from the main branch', minOrderAmount: 3000 }).expect(200);
    expect((await t.http().get(`/v1/stores/${A}/checkout-settings`).set(alice.auth).expect(200)).body).toMatchObject({ pickupEnabled: true, minOrderAmount: 3000 });
  });
});

describe('payment methods and credentials', () => {
  const put = (provider: string, body: unknown, s = alice, store = A) => t.http().put(`/v1/stores/${store}/payment-methods/${provider}`).set(s.auth).send(body as object);

  it('lists the providers that exist, all off for a new store', async () => {
    const res = await t.http().get(`/v1/stores/${A}/payment-methods`).set(alice.auth).expect(200);
    expect(res.body.map((m: { provider: string; enabled: boolean; kind: string }) => [m.provider, m.kind, m.enabled])).toEqual([['cod', 'offline', false], ['tap', 'online', false], ['myfatoorah', 'online', false], ['hesabe', 'online', false], ['testpay', 'online', false]]);
  });

  it('cash on delivery needs no credentials', async () => {
    await put('cod', { enabled: true }).expect(200);
  });

  it('an online provider cannot be switched on without its credentials', async () => {
    expect((await put('testpay', { enabled: true }).expect(400)).body.message).toBe('payment_credentials_required');
    expect((await put('testpay', { enabled: true, credentials: { apiKey: 'x' } }).expect(400)).body.message).toBe('unknown_credential_field');
    await put('nope', { enabled: true }).expect(404);
    await put('testpay', { enabled: true, credentials: { webhookSecret: SECRET } }).expect(200);
  });

  it('credentials are encrypted at rest and never come back from the API or reach the audit log', async () => {
    const row = (await ownerQuery<{ credentials_enc: string }>("SELECT credentials_enc FROM payment_methods WHERE store_id = $1 AND provider = 'testpay'", [A]))[0]!;
    expect(row.credentials_enc).not.toContain(SECRET);
    expect(row.credentials_enc).toMatch(/^[a-z0-9]+:[\w-]+:[\w-]+:[\w-]+$/);
    const list = await t.http().get(`/v1/stores/${A}/payment-methods`).set(alice.auth).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(SECRET);
    expect(list.body.find((m: { provider: string }) => m.provider === 'testpay')).toMatchObject({ enabled: true, configured: true });
    const audit = await ownerQuery<{ metadata: unknown }>("SELECT metadata FROM audit_logs WHERE store_id = $1 AND action LIKE 'payment_method.%'", [A]);
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(SECRET);
  });

  it('a ciphertext copied into another store does not decrypt there', async () => {
    await ownerQuery(
      "INSERT INTO payment_methods (id, store_id, provider, enabled, credentials_enc, updated_at) SELECT gen_random_uuid(), $2, provider, true, credentials_enc, now() FROM payment_methods WHERE store_id = $1 AND provider = 'testpay'", [A, B]);
    await t.http().get(`/v1/stores/${B}/payment-methods`).set(bob.auth).expect(500);
    await ownerQuery("DELETE FROM payment_methods WHERE store_id = $1 AND provider = 'testpay'", [B]);
  });

  it('only members with the payments permission can see or change payment methods', async () => {
    await t.http().get(`/v1/stores/${A}/payment-methods`).set(staff.auth).expect(403);
    await put('cod', { enabled: false }, staff).expect(403);
    await put('cod', { enabled: false }, bob).expect(404);
  });
});

describe('checkout', () => {
  it('shows the shopper the real options: active zones, pickup, enabled payment methods', async () => {
    const token = await cartWith([[ids.oudV, 1]]);
    const view = (await sfGet('/checkout', hostA, token).expect(200)).body;
    expect(view).toMatchObject({ available: true, unavailableReason: null, minOrderAmount: 3000, country: 'KW', pickup: { enabled: true, instructionsEn: 'Collect from the main branch' } });
    expect(view.zones.map((z: { nameEn: string }) => z.nameEn)).not.toContain('Jahra');
    expect(view.zones).toHaveLength(5);
    expect(view.paymentMethods.map((m: { provider: string }) => m.provider)).toEqual(['cod', 'testpay']);
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect((await sfGet('/cart', hostA, token).expect(200)).body.checkoutAvailable).toBe(true);
  });

  it('places a delivery order: totals computed on the server, stock taken, cart emptied, emails sent', async () => {
    const token = await cartWith([[ids.roseV, 2], [ids.oudV, 1], [ids.ebookV, 1]]);
    const before = t.mail.sent.length;
    const res = await place(token, delivery()).expect(201);
    expect(res.body).toMatchObject({ orderNumber: 1001, redirectUrl: null });
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    ids.token1 = res.body.token;
    ids.order1 = await orderOf(A, 1001);

    const order = (await sfGet(`/orders/${res.body.token}`).expect(200)).body;
    expect(order).toMatchObject({
      number: 1001, status: 'PENDING', paymentStatus: 'UNPAID', fulfillment: 'DELIVERY', currency: 'KWD',
      subtotal: 2 * 12500 + 8000 + 2000, deliveryFee: 1500, total: 36500, customerPhone: '+96550001234',
      address: { area: 'السالمية', zoneNameEn: 'Hawalli' }, paymentName: { en: 'Cash on delivery' },
    });
    expect(order.items).toHaveLength(3);
    expect(order).not.toHaveProperty('id');
    expect(JSON.stringify(order)).not.toContain('7000'); // cost price

    expect(await stock(ids.roseV!)).toBe(1);
    expect(await stock(ids.oudV!)).toBe(49);
    expect((await ownerQuery("SELECT 1 FROM inventory_movements WHERE variant_id = $1 AND reason = 'SALE' AND delta = -2", [ids.roseV])).length).toBe(1);
    expect((await sfGet('/cart', hostA, token).expect(200)).body.items).toEqual([]);

    // Mail goes out after the order is committed.
    await new Promise((r) => setTimeout(r, 200));
    const mails = t.mail.sent.slice(before);
    expect(mails.map((m) => m.to).sort()).toEqual(['alice@example.com', 'sara@example.com']);
    const customer = mails.find((m) => m.to === 'sara@example.com')!;
    expect(customer.subject).toContain('1001');
    expect(customer.text).toContain(`http://${hostA}:3000/ar/orders/${res.body.token}`);
    expect(customer.text).toContain('36.500');
  });

  it('a repeated submit with the same key returns the same order and takes no more stock', async () => {
    const token = await cartWith([[ids.oudV, 2]]);
    const body = delivery();
    const first = await place(token, body).expect(201);
    const again = await place(token, body).expect(201);
    const noCart = await place(undefined, body).expect(201);
    expect(again.body).toEqual(first.body);
    expect(noCart.body).toEqual(first.body);
    expect(first.body.orderNumber).toBe(1002);
    expect(await stock(ids.oudV!)).toBe(47);
    expect((await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length).toBe(2);
  });

  it('two simultaneous submits with the same key create one order', async () => {
    const token = await cartWith([[ids.oudV, 1]]);
    const body = delivery();
    const [a, b] = await Promise.all([place(token, body), place(token, body)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.orderNumber).toBe(b.body.orderNumber);
    expect(await stock(ids.oudV!)).toBe(46);
  });

  it('free delivery from the zone threshold; pickup has no fee and no address', async () => {
    const t1 = await cartWith([[ids.oudV, 3]]);
    const free = await place(t1, delivery({ zoneId: ids.zoneCapital })).expect(201);
    expect((await sfGet(`/orders/${free.body.token}`).expect(200)).body).toMatchObject({ subtotal: 24000, deliveryFee: 0, total: 24000 });
    const t2 = await cartWith([[ids.oudV, 1]]);
    const paid = await place(t2, delivery({ zoneId: ids.zoneCapital })).expect(201);
    expect((await sfGet(`/orders/${paid.body.token}`).expect(200)).body).toMatchObject({ subtotal: 8000, deliveryFee: 1000, total: 9000 });
    const t3 = await cartWith([[ids.oudV, 1]]);
    const pickup = await place(t3, { fulfillment: 'PICKUP', customer: { name: 'Omar', phone: '+96566001122' }, paymentProvider: 'cod', locale: 'en', idempotencyKey: key() }).expect(201);
    expect((await sfGet(`/orders/${pickup.body.token}`).expect(200)).body).toMatchObject({ fulfillment: 'PICKUP', deliveryFee: 0, total: 8000, address: null, pickupInstructionsEn: 'Collect from the main branch' });
  });

  it('refuses what the shopper is not allowed to choose', async () => {
    const token = await cartWith([[ids.oudV, 1]]);
    const stockBefore = await stock(ids.oudV!);
    const ordersBefore = (await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length;
    const cases: [Record<string, unknown>, number, string][] = [
      [delivery({ zoneId: ids.zoneJahra }), 400, 'zone_unavailable'], // inactive zone
      [delivery({ paymentProvider: 'tap' }), 400, 'payment_method_unavailable'],
      [delivery({ customer: { name: 'Sara', phone: '123' } }), 400, 'invalid_phone'],
    ];
    for (const [body, status, message] of cases) expect((await place(token, body).expect(status)).body.message).toBe(message);
    // Client-supplied money or identity is rejected outright.
    await place(token, { ...delivery(), total: 1 }).expect(400);
    await place(token, { ...delivery(), deliveryFee: 0 }).expect(400);
    await place(token, { ...delivery(), storeId: B }).expect(400);
    await place(token, { ...delivery(), address: { ...address, area: '<script>alert(1)</script>' } }).expect(400);
    await place(token, { ...delivery(), address: undefined }).expect(400);
    // Nothing was created by any of these.
    expect(await stock(ids.oudV!)).toBe(stockBefore);
    expect((await ownerQuery('SELECT 1 FROM orders WHERE store_id = $1', [A])).length).toBe(ordersBefore);
  });

  it('an empty cart, a missing cart and a cart below the minimum cannot be ordered', async () => {
    expect((await place(undefined, delivery()).expect(409)).body.message).toBe('cart_empty');
    expect((await place('x'.repeat(43), delivery()).expect(409)).body.message).toBe('cart_empty');
    const small = await cartWith([[ids.ebookV, 1]]);
    expect((await place(small, delivery()).expect(409)).body.message).toBe('below_minimum_order');
  });

  it('a cart that changed since the shopper saw it is not silently ordered', async () => {
    const token = await cartWith([[ids.roseV, 1]]);
    await t.http().patch(`/v1/stores/${A}/products/${ids.rose}`).set(alice.auth).send({ status: 'DRAFT' }).expect(200);
    expect((await place(token, delivery()).expect(409)).body.message).toBe('cart_changed');
    await t.http().patch(`/v1/stores/${A}/products/${ids.rose}`).set(alice.auth).send({ status: 'ACTIVE' }).expect(200);
  });

  it('the last unit goes to exactly one of two simultaneous shoppers', async () => {
    expect(await stock(ids.roseV!)).toBe(1);
    const [c1, c2] = [await cartWith([[ids.roseV, 1]]), await cartWith([[ids.roseV, 1]])];
    const results = await Promise.all([place(c1, delivery()), place(c2, delivery())]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.message).toMatch(/insufficient_stock|cart_changed/);
    expect(await stock(ids.roseV!)).toBe(0);
  });

  it('order numbers are consecutive per store and never repeat under load', async () => {
    const carts = await Promise.all(Array.from({ length: 6 }, () => cartWith([[ids.oudV, 1]])));
    const results = await Promise.all(carts.map((c) => place(c, delivery())));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.orderNumber as number).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(6);
    expect(numbers[5]! - numbers[0]!).toBe(5);
    // Bob's store has its own sequence starting at 1001.
    await t.http().put(`/v1/stores/${B}/payment-methods/cod`).set(bob.auth).send({ enabled: true }).expect(200);
    await t.http().put(`/v1/stores/${B}/checkout-settings`).set(bob.auth).send({ pickupEnabled: true }).expect(200);
    const bobCart = await cartWith([[ids.mugV, 1]], hostB);
    const bobOrder = await place(bobCart, { fulfillment: 'PICKUP', customer: { name: 'Zed', phone: '55512345' }, paymentProvider: 'cod', idempotencyKey: key() }, hostB).expect(201);
    expect(bobOrder.body.orderNumber).toBe(1001);
    ids.bobToken = bobOrder.body.token;
    ids.bobOrder = await orderOf(B, 1001);
  });

  it('shops are separate: carts, zones, payment methods and order links do not cross', async () => {
    const aliceCart = await cartWith([[ids.oudV, 1]]);
    // Alice's cart token on Bob's shop is no cart at all.
    expect((await place(aliceCart, { fulfillment: 'PICKUP', customer: { name: 'Zed', phone: '55512345' }, paymentProvider: 'cod', idempotencyKey: key() }, hostB).expect(409)).body.message).toBe('cart_empty');
    // Bob's shop cannot deliver to Alice's zone or use a method only Alice enabled.
    const bobCart = await cartWith([[ids.mugV, 1]], hostB);
    expect((await place(bobCart, delivery({ zoneId: ids.zoneHawalli }), hostB).expect(400)).body.message).toBe('zone_unavailable');
    expect((await place(bobCart, { fulfillment: 'PICKUP', customer: { name: 'Zed', phone: '55512345' }, paymentProvider: 'testpay', idempotencyKey: key() }, hostB).expect(400)).body.message).toBe('payment_method_unavailable');
    // An order link only works on the shop that took the order.
    await sfGet(`/orders/${ids.token1}`, hostB).expect(404);
    await sfGet(`/orders/${ids.bobToken}`, hostA).expect(404);
    await sfGet(`/orders/${'A'.repeat(43)}`).expect(404);
    await sfGet('/orders/1001').expect(404);
  });

  it('a store in preview (not launched) takes no orders', async () => {
    await t.http().post(`/v1/stores/${A}/unlaunch`).set(alice.auth).expect(200);
    const { body } = await t.http().post(`/v1/stores/${A}/theme/preview-token`).set(alice.auth).send({ themeId: 'gulf-premium' }).expect(200);
    const view = await sfGet('/checkout').set('x-preview-token', body.token).expect(200);
    expect(view.body).toMatchObject({ available: false, unavailableReason: 'store_not_live' });
    const res = await t.http().post('/v1/storefront/checkout').set('x-store-host', hostA).set('x-preview-token', body.token).send(delivery()).expect(409);
    expect(res.body.message).toBe('checkout_unavailable');
    await t.http().post(`/v1/stores/${A}/launch`).set(alice.auth).expect(200);
  });
});

describe('orders in the dashboard', () => {
  const orders = (s: Session, store = A) => t.http().get(`/v1/stores/${store}/orders`).set(s.auth);
  const move = (id: string, to: string, s = alice, store = A) => t.http().post(`/v1/stores/${store}/orders/${id}/transition`).set(s.auth).send({ to });

  it('lists the store\'s orders, newest first, with search and status filter', async () => {
    const all = (await orders(alice).expect(200)).body;
    expect(all.total).toBeGreaterThanOrEqual(12);
    expect(all.items[0].number).toBeGreaterThan(all.items[1].number);
    expect(all.counts.PENDING).toBe(all.total);
    expect((await orders(alice).query({ q: '1001' }).expect(200)).body.items.map((o: { number: number }) => o.number)).toEqual([1001]);
    expect((await orders(alice).query({ q: '#1001' }).expect(200)).body.total).toBe(1);
    expect((await orders(alice).query({ q: '66001122' }).expect(200)).body.items[0].customerName).toBe('Omar');
    expect((await orders(alice).query({ status: 'DELIVERED' }).expect(200)).body.total).toBe(0);
    expect(JSON.stringify(all)).not.toContain('accessTokenHash');
  });

  it('order detail has items, address, timeline and what can be done next', async () => {
    const o = (await t.http().get(`/v1/stores/${A}/orders/${ids.order1}`).set(alice.auth).expect(200)).body;
    expect(o).toMatchObject({ number: 1001, total: 36500, customerEmail: 'sara@example.com', allowedTransitions: ['CONFIRMED', 'CANCELLED'], canRecordPayment: true });
    expect(o.items.map((i: { sku: string | null; quantity: number }) => [i.sku, i.quantity]).sort()).toEqual([['OUD-3', 1], ['ROSE', 2], [null, 1]].sort());
    expect(o.events.map((e: { type: string }) => e.type)).toEqual(['placed']);
    expect(o.payments).toMatchObject([{ provider: 'cod', status: 'PENDING', amount: 36500 }]);
    expect(o).not.toHaveProperty('accessTokenHash');
    expect(o).not.toHaveProperty('idempotencyKey');
  });

  it('other stores and non-members see nothing', async () => {
    expect((await orders(bob, B).expect(200)).body.total).toBe(1);
    await orders(bob).expect(404);
    await t.http().get(`/v1/stores/${B}/orders/${ids.order1}`).set(bob.auth).expect(404);
    await move(ids.order1!, 'CONFIRMED', bob, B).expect(404);
    await t.http().post(`/v1/stores/${B}/orders/${ids.order1}/record-payment`).set(bob.auth).expect(404);
  });

  it('a viewer can read orders but not change them', async () => {
    await orders(viewer).expect(200);
    await move(ids.order1!, 'CONFIRMED', viewer).expect(403);
    await t.http().post(`/v1/stores/${A}/orders/${ids.order1}/record-payment`).set(viewer.auth).expect(403);
    await t.http().post(`/v1/stores/${A}/orders/${ids.order1}/notes`).set(viewer.auth).send({ note: 'x' }).expect(403);
  });

  it('status follows the state machine and every step is on the timeline and in the audit log', async () => {
    expect((await move(ids.order1!, 'SHIPPED').expect(409)).body.message).toBe('invalid_order_transition');
    await move(ids.order1!, 'NOPE').expect(400);
    await move(ids.order1!, 'CONFIRMED', staff).expect(200);
    await move(ids.order1!, 'PENDING').expect(409);
    await t.http().post(`/v1/stores/${A}/orders/${ids.order1}/transition`).set(alice.auth).send({ to: 'PROCESSING', note: 'جاري التجهيز' }).expect(200);
    await move(ids.order1!, 'SHIPPED').expect(200);
    await t.http().post(`/v1/stores/${A}/orders/${ids.order1}/notes`).set(staff.auth).send({ note: 'العميل طلب الاتصال قبل الوصول' }).expect(200);
    const o = (await t.http().get(`/v1/stores/${A}/orders/${ids.order1}`).set(alice.auth).expect(200)).body;
    expect(o.status).toBe('SHIPPED');
    expect(o.events.map((e: { type: string; toStatus: string | null; actorName: string | null }) => [e.type, e.toStatus, e.actorName])).toEqual([
      ['placed', 'PENDING', null], ['status', 'CONFIRMED', 'staff'], ['status', 'PROCESSING', 'alice'], ['status', 'SHIPPED', 'alice'], ['note', null, 'staff'],
    ]);
    expect((await ownerQuery("SELECT 1 FROM audit_logs WHERE store_id = $1 AND action = 'order.status_changed' AND entity_id = $2", [A, ids.order1])).length).toBe(3);
    // The shopper's link shows the new status.
    expect((await sfGet(`/orders/${ids.token1}`).expect(200)).body.status).toBe('SHIPPED');
  });

  it('cash is recorded once, by staff, and only then is the order paid', async () => {
    expect((await sfGet(`/orders/${ids.token1}`).expect(200)).body.paymentStatus).toBe('UNPAID');
    await t.http().post(`/v1/stores/${A}/orders/${ids.order1}/record-payment`).set(staff.auth).expect(200);
    expect((await t.http().post(`/v1/stores/${A}/orders/${ids.order1}/record-payment`).set(staff.auth).expect(409)).body.message).toBe('order_already_paid');
    const o = (await t.http().get(`/v1/stores/${A}/orders/${ids.order1}`).set(alice.auth).expect(200)).body;
    expect(o).toMatchObject({ paymentStatus: 'PAID', canRecordPayment: false });
    expect(o.payments).toMatchObject([{ provider: 'cod', status: 'PAID', amount: 36500 }]);
    await move(ids.order1!, 'DELIVERED').expect(200);
    expect((await move(ids.order1!, 'CANCELLED').expect(409)).body.message).toBe('invalid_order_transition');
  });

  it('cancelling returns the stock once and closes the pending payment', async () => {
    const id = await orderOf(A, 1002); // 2 × oud
    const before = await stock(ids.oudV!);
    await move(id, 'CANCELLED').expect(200);
    expect(await stock(ids.oudV!)).toBe(before + 2);
    expect((await ownerQuery("SELECT 1 FROM inventory_movements WHERE variant_id = $1 AND reason = 'RETURN' AND delta = 2", [ids.oudV])).length).toBe(1);
    await move(id, 'CANCELLED').expect(409);
    await move(id, 'CONFIRMED').expect(409);
    expect(await stock(ids.oudV!)).toBe(before + 2);
    const o = (await t.http().get(`/v1/stores/${A}/orders/${id}`).set(alice.auth).expect(200)).body;
    expect(o.payments[0].status).toBe('CANCELLED');
    expect((await t.http().post(`/v1/stores/${A}/orders/${id}/record-payment`).set(alice.auth).expect(409)).body.message).toBe('order_cancelled');
  });

  it('cancelling still works after the product was deleted', async () => {
    const p = await product(A, alice, { nameEn: 'Short Lived', status: 'ACTIVE', variants: [{ sku: 'TMP', price: 5000, initialStock: 2 }] });
    const res = await place(await cartWith([[p.variants[0]!.id, 1]]), delivery()).expect(201);
    await t.http().delete(`/v1/stores/${A}/products/${p.id}`).set(alice.auth).expect(204);
    const id = await orderOf(A, res.body.orderNumber);
    await move(id, 'CANCELLED').expect(200);
    const o = (await t.http().get(`/v1/stores/${A}/orders/${id}`).set(alice.auth).expect(200)).body;
    expect(o.items[0]).toMatchObject({ nameEn: 'Short Lived', unitPrice: 5000 });
  });

  it('an order keeps the price and name it was placed with', async () => {
    await t.http().patch(`/v1/stores/${A}/products/${ids.rose}`).set(alice.auth).send({ nameEn: 'Renamed Rose' }).expect(200);
    const o = (await t.http().get(`/v1/stores/${A}/orders/${ids.order1}`).set(alice.auth).expect(200)).body;
    expect(o.items.find((i: { sku: string }) => i.sku === 'ROSE')).toMatchObject({ nameEn: 'Rose Perfume', unitPrice: 12500, lineTotal: 25000 });
  });
});

describe('online payments: an order is paid only by a verified webhook', () => {
  let orderId: string;
  let providerRef: string;
  let token: string;
  const hook = (body: Record<string, unknown>, opts: { secret?: string; store?: string; provider?: string } = {}) => {
    const raw = JSON.stringify(body);
    return t.http().post(`/v1/webhooks/payments/${opts.provider ?? 'testpay'}/${opts.store ?? A}`)
      .set('content-type', 'application/json').set('x-testpay-signature', TestGatewayAdapter.sign(raw, opts.secret ?? SECRET)).send(raw);
  };
  const state = async () => (await t.http().get(`/v1/stores/${A}/orders/${orderId}`).set(alice.auth).expect(200)).body;

  beforeAll(async () => {
    const res = await place(await cartWith([[ids.oudV, 1]]), delivery({ paymentProvider: 'testpay' })).expect(201);
    token = res.body.token;
    orderId = await orderOf(A, res.body.orderNumber);
    providerRef = (await ownerQuery<{ provider_ref: string }>('SELECT provider_ref FROM payments WHERE order_id = $1', [orderId]))[0]!.provider_ref;
  });

  it('starts unpaid and cannot be marked paid by hand, by anyone', async () => {
    expect(await state()).toMatchObject({ status: 'PENDING', paymentStatus: 'UNPAID', canRecordPayment: false, total: 9500 });
    expect((await t.http().post(`/v1/stores/${A}/orders/${orderId}/record-payment`).set(alice.auth).expect(400)).body.message).toBe('manual_payment_not_allowed');
  });

  it('a webhook with a wrong or missing signature changes nothing', async () => {
    const body = { id: 'evt_forged', type: 'payment.paid', payment: providerRef, amount: 9500, currency: 'KWD' };
    await hook(body, { secret: 'guess' }).expect(401);
    await t.http().post(`/v1/webhooks/payments/testpay/${A}`).send(body).expect(401);
    // Signed with the right secret but sent to another store (which has no such provider): not found.
    await hook(body, { store: B }).expect(404);
    await hook(body, { provider: 'cod' }).expect(404);
    await hook(body, { provider: 'unknown' }).expect(404);
    await hook(body, { store: 'not-a-uuid' }).expect(404);
    expect(await state()).toMatchObject({ paymentStatus: 'UNPAID' });
    expect((await ownerQuery('SELECT 1 FROM webhook_events WHERE store_id = $1', [A])).length).toBe(0);
  });

  it('a signed webhook for the wrong amount or currency does not pay the order', async () => {
    expect((await hook({ id: 'evt_low', type: 'payment.paid', payment: providerRef, amount: 100, currency: 'KWD' }).expect(200)).body).toMatchObject({ status: 'FAILED' });
    expect((await hook({ id: 'evt_cur', type: 'payment.paid', payment: providerRef, amount: 9500, currency: 'USD' }).expect(200)).body).toMatchObject({ status: 'FAILED' });
    expect((await hook({ id: 'evt_none', type: 'payment.paid', payment: 'tp_does_not_exist', amount: 9500, currency: 'KWD' }).expect(200)).body).toMatchObject({ status: 'FAILED' });
    expect((await hook({ id: 'evt_other', type: 'customer.created', payment: providerRef }).expect(200)).body).toMatchObject({ status: 'IGNORED' });
    expect(await state()).toMatchObject({ status: 'PENDING', paymentStatus: 'UNPAID' });
    const rows = await ownerQuery<{ event_id: string; error: string | null }>('SELECT event_id, error FROM webhook_events WHERE store_id = $1 ORDER BY event_id', [A]);
    expect(rows).toEqual([{ event_id: 'evt_cur', error: 'amount_mismatch' }, { event_id: 'evt_low', error: 'amount_mismatch' }, { event_id: 'evt_none', error: 'payment_not_found' }, { event_id: 'evt_other', error: null }]);
  });

  it('the genuine webhook pays and confirms the order; redeliveries do nothing', async () => {
    const body = { id: 'evt_paid_1', type: 'payment.paid', payment: providerRef, amount: 9500, currency: 'KWD' };
    expect((await hook(body).expect(200)).body).toEqual({ received: true, status: 'PROCESSED' });
    const o = await state();
    expect(o).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    expect(o.payments).toMatchObject([{ provider: 'testpay', status: 'PAID', amount: 9500 }]);
    expect(o.events.map((e: { type: string }) => e.type)).toEqual(['placed', 'payment_received']);
    for (let i = 0; i < 3; i++) expect((await hook(body).expect(200)).body).toEqual({ received: true, duplicate: true });
    // A second "paid" event with a new id for the same payment is ignored too.
    expect((await hook({ ...body, id: 'evt_paid_2' }).expect(200)).body).toMatchObject({ status: 'IGNORED' });
    expect((await state()).events).toHaveLength(2);
    expect((await ownerQuery("SELECT 1 FROM audit_logs WHERE store_id = $1 AND action = 'order.paid' AND actor_type = 'SYSTEM'", [A])).length).toBe(1);
    expect((await sfGet(`/orders/${token}`).expect(200)).body.paymentStatus).toBe('PAID');
  });

  it('simultaneous deliveries of one event pay the order once', async () => {
    const res = await place(await cartWith([[ids.oudV, 1]]), delivery({ paymentProvider: 'testpay' })).expect(201);
    const id = await orderOf(A, res.body.orderNumber);
    const ref = (await ownerQuery<{ provider_ref: string }>('SELECT provider_ref FROM payments WHERE order_id = $1', [id]))[0]!.provider_ref;
    const body = { id: 'evt_race', type: 'payment.paid', payment: ref, amount: 9500, currency: 'KWD' };
    const results = await Promise.all(Array.from({ length: 5 }, () => hook(body)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.status === 'PROCESSED')).toHaveLength(1);
    const o = (await t.http().get(`/v1/stores/${A}/orders/${id}`).set(alice.auth).expect(200)).body;
    expect(o.events.filter((e: { type: string }) => e.type === 'payment_received')).toHaveLength(1);
  });

  it('a failed payment is recorded and leaves the order unpaid', async () => {
    const res = await place(await cartWith([[ids.oudV, 1]]), delivery({ paymentProvider: 'testpay' })).expect(201);
    const id = await orderOf(A, res.body.orderNumber);
    const ref = (await ownerQuery<{ provider_ref: string }>('SELECT provider_ref FROM payments WHERE order_id = $1', [id]))[0]!.provider_ref;
    await hook({ id: 'evt_fail', type: 'payment.failed', payment: ref }).expect(200);
    const o = (await t.http().get(`/v1/stores/${A}/orders/${id}`).set(alice.auth).expect(200)).body;
    expect(o).toMatchObject({ status: 'PENDING', paymentStatus: 'UNPAID' });
    expect(o.payments[0].status).toBe('FAILED');
  });

  it('a payment arriving after cancellation is recorded but does not reopen the order', async () => {
    const res = await place(await cartWith([[ids.oudV, 1]]), delivery({ paymentProvider: 'testpay' })).expect(201);
    const id = await orderOf(A, res.body.orderNumber);
    const ref = (await ownerQuery<{ provider_ref: string }>('SELECT provider_ref FROM payments WHERE order_id = $1', [id]))[0]!.provider_ref;
    await t.http().post(`/v1/stores/${A}/orders/${id}/transition`).set(alice.auth).send({ to: 'CANCELLED' }).expect(200);
    // Cancelling closed the pending payment, so a late "paid" notice has nothing to pay.
    expect((await hook({ id: 'evt_late', type: 'payment.paid', payment: ref, amount: 9500, currency: 'KWD' }).expect(200)).body).toMatchObject({ status: 'PROCESSED' });
    const o = (await t.http().get(`/v1/stores/${A}/orders/${id}`).set(alice.auth).expect(200)).body;
    expect(o).toMatchObject({ status: 'CANCELLED', paymentStatus: 'PAID' });
    expect(o.events.map((e: { type: string }) => e.type)).toContain('payment_after_cancel');
  });
});
