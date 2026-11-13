import { THEMES } from '@mtjari/shared';
import { createStore, createTestApp, ownerQuery, resetDb, signUp, type Session, type TestApp } from './helpers';

let t: TestApp;
let alice: Session;
let bob: Session;
let A: string;
let B: string;
const hostA = 'shop-a.mtjari.cc';
const hostB = 'shop-b.mtjari.cc';
const shop = (host: string) => ({ 'x-store-host': host });
const sf = (path: string, host = hostA) => t.http().get(`/v1/storefront${path}`).set(shop(host));

const ids: Record<string, string> = {};

async function product(storeId: string, s: Session, body: Record<string, unknown>) {
  const res = await t.http().post(`/v1/stores/${storeId}/products`).set(s.auth).send(body).expect(201);
  return res.body as { id: string; slug: string; variants: { id: string; optionValues: Record<string, string> }[] };
}

beforeAll(async () => {
  await resetDb();
  t = await createTestApp();
  alice = await signUp(t, 'alice@example.com');
  bob = await signUp(t, 'bob@example.com');
  A = (await createStore(t, alice, 'shop-a', 'متجر أ')).id;
  B = (await createStore(t, bob, 'shop-b', 'Shop B')).id;

  const parent = await t.http().post(`/v1/stores/${A}/categories`).set(alice.auth).send({ nameAr: 'عطور', nameEn: 'Perfume' }).expect(201);
  const child = await t.http().post(`/v1/stores/${A}/categories`).set(alice.auth).send({ nameAr: 'عود', nameEn: 'Oud', parentId: parent.body.id }).expect(201);
  ids.catParent = parent.body.id;
  ids.catChild = child.body.id;

  const rose = await product(A, alice, {
    nameAr: 'عطر الورد', nameEn: 'Rose Perfume', status: 'ACTIVE', categoryIds: [parent.body.id], tags: ['gift'],
    variants: [{ sku: 'ROSE', price: 12500, compareAtPrice: 15000, cost: 7000, initialStock: 3, lowStockThreshold: 2 }],
  });
  const oud = await product(A, alice, {
    nameAr: 'دهن العود', nameEn: 'Oud Oil', status: 'ACTIVE', type: 'VARIANT', categoryIds: [child.body.id],
    options: [{ name: 'Size', values: ['3ml', '12ml'] }],
    variants: [
      { optionValues: { Size: '3ml' }, sku: 'OUD-3', price: 8000, cost: 3000, initialStock: 5 },
      { optionValues: { Size: '12ml' }, sku: 'OUD-12', price: 30000, cost: 9000, initialStock: 0 },
    ],
  });
  const draft = await product(A, alice, { nameEn: 'Secret Draft', status: 'DRAFT', variants: [{ sku: 'DRAFT', price: 1000, initialStock: 1 }] });
  const ebook = await product(A, alice, { nameEn: 'Fragrance Guide', status: 'ACTIVE', type: 'DIGITAL', variants: [{ price: 2000 }] });
  const other = await product(B, bob, { nameEn: 'Bob Mug', status: 'ACTIVE', variants: [{ sku: 'MUG', price: 500, cost: 100, initialStock: 9 }] });
  Object.assign(ids, {
    rose: rose.id, roseV: rose.variants[0]!.id, oud: oud.id, oud3: oud.variants.find((v) => v.optionValues.Size === '3ml')!.id,
    oud12: oud.variants.find((v) => v.optionValues.Size === '12ml')!.id, draftV: draft.variants[0]!.id, ebookV: ebook.variants[0]!.id,
    bobV: other.variants[0]!.id,
  });
});
afterAll(() => t.close());

describe('visibility before launch', () => {
  it('a store that is not launched does not exist for shoppers', async () => {
    for (const path of ['/store', '/products', '/products/rose-perfume', '/sitemap', '/cart']) {
      const res = await sf(path).expect(404);
      expect(res.body.message).toBe('store_not_found');
    }
    await t.http().post('/v1/storefront/cart/items').set(shop(hostA)).send({ variantId: ids.roseV }).expect(404);
  });

  it('unknown, malformed and missing hosts are plain 404s', async () => {
    for (const host of ['nope.mtjari.cc', 'shop-a.mtjari.cc.evil.com', "x' OR 1=1--", '../etc', 'a'.repeat(300)]) {
      await sf('/store', host).expect(404);
    }
    await t.http().get('/v1/storefront/store').expect(404);
  });

  it('launch is refused until a theme is published', async () => {
    const res = await t.http().post(`/v1/stores/${A}/launch`).set(alice.auth).expect(400);
    expect(res.body.message).toBe('theme_not_published');
  });

  it('launch is refused without a published product', async () => {
    await t.http().post(`/v1/stores/${B}/theme/publish`).set(bob.auth).send({ themeId: 'coffee-house' }).expect(200);
    await t.http().patch(`/v1/stores/${B}/products/${(await t.http().get(`/v1/stores/${B}/products`).set(bob.auth)).body.items[0].id}`).set(bob.auth).send({ status: 'DRAFT' }).expect(200);
    const res = await t.http().post(`/v1/stores/${B}/launch`).set(bob.auth).expect(400);
    expect(res.body.message).toBe('no_published_products');
    await t.http().patch(`/v1/stores/${B}/products/${(await t.http().get(`/v1/stores/${B}/products`).set(bob.auth)).body.items[0].id}`).set(bob.auth).send({ status: 'ACTIVE' }).expect(200);
  });
});

describe('themes: draft, preview, publish', () => {
  const custom = { ...THEMES['perfume-boutique'].defaults, colors: { primary: '#AA8833', accent: '#FFEECC' }, hero: { titleAr: 'عطور الخليج', titleEn: 'Gulf Scents', subtitleAr: '', subtitleEn: '' } };

  it('lists the five themes with defaults for a new store', async () => {
    const res = await t.http().get(`/v1/stores/${A}/theme`).set(alice.auth).expect(200);
    expect(res.body).toMatchObject({ status: 'DRAFT', publishedThemeId: null, host: hostA, publishedProducts: 3 });
    expect(res.body.themes.map((x: { id: string }) => x.id)).toEqual(['modern-electronics', 'luxury-fashion', 'perfume-boutique', 'coffee-house', 'gulf-premium']);
    expect(res.body.themes.every((x: { published: unknown; isPublished: boolean }) => x.published === null && !x.isPublished)).toBe(true);
  });

  it('saves a draft; invalid settings and foreign categories are refused', async () => {
    await t.http().post(`/v1/stores/${A}/theme/draft`).set(alice.auth).send({ themeId: 'perfume-boutique', settings: custom }).expect(200);
    await t.http().post(`/v1/stores/${A}/theme/draft`).set(alice.auth).send({ themeId: 'perfume-boutique', settings: { ...custom, colors: { primary: 'gold', accent: '#000000' } } }).expect(400);
    await t.http().post(`/v1/stores/${A}/theme/draft`).set(alice.auth).send({ themeId: 'perfume-boutique', settings: { ...custom, announcement: { ar: '<b>x</b>', en: '' } } }).expect(400);
    await t.http().post(`/v1/stores/${A}/theme/draft`).set(alice.auth).send({ themeId: 'made-up', settings: custom }).expect(400);
    const bobCat = await t.http().post(`/v1/stores/${B}/categories`).set(bob.auth).send({ nameEn: 'Mugs' }).expect(201);
    const res = await t.http().post(`/v1/stores/${A}/theme/draft`).set(alice.auth).send({ themeId: 'perfume-boutique', settings: { ...custom, featuredCategoryId: bobCat.body.id } }).expect(400);
    expect(res.body.message).toBe('category_not_found');
  });

  it('a preview token shows the draft of an unlaunched store, only for that store and only while valid', async () => {
    const { body } = await t.http().post(`/v1/stores/${A}/theme/preview-token`).set(alice.auth).send({ themeId: 'perfume-boutique' }).expect(200);
    const res = await sf('/store').set('x-preview-token', body.token).expect(200);
    expect(res.body).toMatchObject({ preview: true, name: 'متجر أ', currency: 'KWD', theme: { id: 'perfume-boutique', settings: { colors: custom.colors, hero: { titleEn: 'Gulf Scents' } } } });

    // Wrong store, tampered, truncated, or garbage: all refused.
    await sf('/store', hostB).set('x-preview-token', body.token).expect(404);
    const [payload, sig] = body.token.split('.');
    const forged = Buffer.from(Buffer.from(payload, 'base64url').toString().replace(A, B)).toString('base64url');
    await sf('/store', hostB).set('x-preview-token', `${forged}.${sig}`).expect(404);
    await sf('/store').set('x-preview-token', `${payload}.${sig.slice(0, -2)}xx`).expect(404);
    await sf('/store').set('x-preview-token', 'garbage').expect(404);
    await sf('/store').set('x-preview-token', alice.accessToken).expect(404); // an access token is not a preview token
  });

  it('an expired preview token is refused', async () => {
    const { PreviewTokens } = await import('../src/storefront/preview');
    const previews = t.app.get(PreviewTokens);
    const old = previews.issue(A, 'gulf-premium', Date.now() - 31 * 60 * 1000);
    expect(previews.verify(old.token, A)).toBeNull();
    await sf('/store').set('x-preview-token', old.token).expect(404);
    expect(previews.verify(previews.issue(A, 'gulf-premium').token, A)).toBe('gulf-premium');
  });

  it('publish and launch make the store public with the published settings', async () => {
    await t.http().post(`/v1/stores/${A}/theme/publish`).set(alice.auth).send({ themeId: 'perfume-boutique' }).expect(200);
    const launched = await t.http().post(`/v1/stores/${A}/launch`).set(alice.auth).expect(200);
    expect(launched.body).toMatchObject({ status: 'ACTIVE', publishedThemeId: 'perfume-boutique' });
    const res = await sf('/store').expect(200);
    expect(res.body).toMatchObject({ preview: false, theme: { id: 'perfume-boutique', settings: { colors: custom.colors } } });
    expect(res.body.categories.map((c: { slug: string; productCount: number }) => [c.slug, c.productCount])).toEqual([['perfume', 1], ['oud', 1]]);
  });

  it('later draft edits stay private until published; switching theme keeps each theme’s settings', async () => {
    await t.http().post(`/v1/stores/${A}/theme/draft`).set(alice.auth).send({ themeId: 'perfume-boutique', settings: { ...custom, announcement: { ar: 'شحن مجاني', en: 'Free shipping' } } }).expect(200);
    expect((await sf('/store').expect(200)).body.theme.settings.announcement.en).toBe('');
    const overview = await t.http().get(`/v1/stores/${A}/theme`).set(alice.auth).expect(200);
    expect(overview.body.themes.find((x: { id: string }) => x.id === 'perfume-boutique')).toMatchObject({ isPublished: true, hasUnpublishedChanges: true });

    await t.http().post(`/v1/stores/${A}/theme/publish`).set(alice.auth).send({ themeId: 'coffee-house' }).expect(200);
    const coffee = await sf('/store').expect(200);
    expect(coffee.body.theme).toMatchObject({ id: 'coffee-house', settings: { colors: THEMES['coffee-house'].defaults.colors } });
    expect((await sf('/products').expect(200)).body.total).toBe(3); // catalogue untouched by the switch

    await t.http().post(`/v1/stores/${A}/theme/publish`).set(alice.auth).send({ themeId: 'perfume-boutique' }).expect(200);
    const back = await sf('/store').expect(200);
    expect(back.body.theme).toMatchObject({ id: 'perfume-boutique', settings: { colors: custom.colors, announcement: { en: 'Free shipping' } } });
  });

  it('theme and launch actions need the right permission and are audited', async () => {
    const staff = await signUp(t, 'staff@example.com');
    const roles = await t.http().get(`/v1/stores/${A}/roles`).set(alice.auth).expect(200);
    await t.http().post(`/v1/stores/${A}/invitations`).set(alice.auth).send({ email: staff.email, roleId: roles.body.find((r: { key: string }) => r.key === 'staff').id }).expect(201);
    await t.http().post('/v1/invitations/accept').set(staff.auth).send({ token: t.mail.tokenFor(staff.email) }).expect(200);
    await t.http().get(`/v1/stores/${A}/theme`).set(staff.auth).expect(403);
    await t.http().post(`/v1/stores/${A}/theme/publish`).set(staff.auth).send({ themeId: 'gulf-premium' }).expect(403);
    await t.http().post(`/v1/stores/${A}/theme/preview-token`).set(staff.auth).send({ themeId: 'gulf-premium' }).expect(403);
    await t.http().post(`/v1/stores/${A}/unlaunch`).set(staff.auth).expect(403);
    // Another merchant: the store does not exist for them.
    await t.http().get(`/v1/stores/${A}/theme`).set(bob.auth).expect(404);
    await t.http().post(`/v1/stores/${A}/unlaunch`).set(bob.auth).expect(404);
    await t.http().post(`/v1/stores/${A}/theme/publish`).send({ themeId: 'gulf-premium' }).expect(401);

    const audit = await t.http().get(`/v1/stores/${A}/audit-logs?limit=100`).set(alice.auth).expect(200);
    const actions = audit.body.items.map((i: { action: string }) => i.action);
    for (const a of ['theme.draft_saved', 'theme.published', 'store.launched']) expect(actions).toContain(a);
  });
});

describe('catalogue as shoppers see it', () => {
  it('lists only published products of this store, without internal fields', async () => {
    const res = await sf('/products').expect(200);
    expect(res.body.items.map((p: { slug: string }) => p.slug).sort()).toEqual(['fragrance-guide', 'oud-oil', 'rose-perfume']);
    const raw = JSON.stringify(res.body);
    for (const leak of ['cost', 'lowStockThreshold', 'stockQuantity', 'storeId', 'Secret Draft', 'Bob Mug']) expect(raw).not.toContain(leak);
    const rose = res.body.items.find((p: { slug: string }) => p.slug === 'rose-perfume');
    expect(rose).toMatchObject({ priceMin: 12500, priceMax: 12500, compareAtPrice: 15000, inStock: true, variantCount: 1 });
    const oud = res.body.items.find((p: { slug: string }) => p.slug === 'oud-oil');
    expect(oud).toMatchObject({ priceMin: 8000, priceMax: 30000, inStock: true, variantCount: 2 });
  });

  it('sorts by cheapest variant, searches, pages and filters by category including sub-categories', async () => {
    expect((await sf('/products?sort=price_asc').expect(200)).body.items.map((p: { slug: string }) => p.slug)).toEqual(['fragrance-guide', 'oud-oil', 'rose-perfume']);
    expect((await sf('/products?sort=price_desc').expect(200)).body.items.map((p: { slug: string }) => p.slug)).toEqual(['rose-perfume', 'oud-oil', 'fragrance-guide']);
    const paged = await sf('/products?sort=price_asc&limit=1&page=2').expect(200);
    expect(paged.body).toMatchObject({ total: 3, page: 2, items: [{ slug: 'oud-oil' }] });
    expect((await sf(`/products?q=${encodeURIComponent('ورد')}`).expect(200)).body.items.map((p: { slug: string }) => p.slug)).toEqual(['rose-perfume']);
    expect((await sf('/products?q=gift&sort=price_desc').expect(200)).body.items).toHaveLength(1);
    expect((await sf('/products?q=%25').expect(200)).body.total).toBe(0); // wildcards are literal
    expect((await sf('/products?category=perfume').expect(200)).body.items.map((p: { slug: string }) => p.slug).sort()).toEqual(['oud-oil', 'rose-perfume']);
    expect((await sf('/products?category=oud&sort=price_asc').expect(200)).body.items.map((p: { slug: string }) => p.slug)).toEqual(['oud-oil']);
    await sf('/products?category=mugs').expect(404); // exists only in the other store
    await sf('/products?limit=1000').expect(400);
    await sf("/products?sort=price_asc;drop").expect(400);
  });

  it('product page data: variants with availability, never cost or exact stock', async () => {
    const res = await sf('/products/oud-oil').expect(200);
    expect(res.body).toMatchObject({ nameEn: 'Oud Oil', options: [{ name: 'Size', values: ['3ml', '12ml'] }], categories: [{ slug: 'oud' }] });
    expect(res.body.variants).toEqual([
      expect.objectContaining({ optionValues: { Size: '3ml' }, price: 8000, available: true, maxQuantity: 5 }),
      expect.objectContaining({ optionValues: { Size: '12ml' }, price: 30000, available: false, maxQuantity: 0 }),
    ]);
    const raw = JSON.stringify(res.body);
    for (const leak of ['cost', 'stockQuantity', 'lowStockThreshold', 'storeId']) expect(raw).not.toContain(leak);
    await sf('/products/secret-draft').expect(404);
    await sf('/products/bob-mug').expect(404);
    await sf('/products/rose-perfume', hostB).expect(404);
  });

  it('sitemap lists published products and categories only', async () => {
    const res = await sf('/sitemap').expect(200);
    expect(res.body.products.map((p: { slug: string }) => p.slug).sort()).toEqual(['fragrance-guide', 'oud-oil', 'rose-perfume']);
    expect(res.body.categories.map((c: { slug: string }) => c.slug).sort()).toEqual(['oud', 'perfume']);
  });

  it('the public endpoints ignore dashboard credentials and write nothing to the catalogue', async () => {
    // A merchant of another store gets exactly the public view.
    const res = await sf('/products').set(bob.auth).expect(200);
    expect(res.body.total).toBe(3);
    await t.http().post('/v1/storefront/products').set(shop(hostA)).send({ nameEn: 'x' }).expect(404);
    await t.http().delete('/v1/storefront/products/rose-perfume').set(shop(hostA)).expect(404);
  });
});

describe('cart', () => {
  let token: string;
  const add = (body: Record<string, unknown>, tok?: string, host = hostA) => {
    const req = t.http().post('/v1/storefront/cart/items').set(shop(host));
    return (tok ? req.set('x-cart-token', tok) : req).send(body);
  };

  it('an empty cart needs no token', async () => {
    const res = await sf('/cart').expect(200);
    expect(res.body).toMatchObject({ items: [], itemCount: 0, subtotal: 0, currency: 'KWD', checkoutAvailable: false });
  });

  it('adding creates a cart and returns its token once; only a hash is stored', async () => {
    const res = await add({ variantId: ids.roseV, quantity: 2 }).expect(200);
    token = res.body.cartToken;
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(res.body.cart).toMatchObject({ itemCount: 2, subtotal: 25000, items: [{ nameEn: 'Rose Perfume', unitPrice: 12500, quantity: 2, lineTotal: 25000, issue: null }] });
    const rows = await ownerQuery<{ token_hash: string }>('SELECT token_hash FROM carts');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toContain(token);

    const again = await add({ variantId: ids.oud3 }, token).expect(200);
    expect(again.body.cartToken).toBeUndefined();
    expect(again.body.cart).toMatchObject({ itemCount: 3, subtotal: 33000 });
  });

  it('prices come from the catalogue; extra fields from the client are refused', async () => {
    await add({ variantId: ids.roseV, quantity: 1, price: 1 }, token).expect(400);
    await add({ variantId: ids.roseV, quantity: 1, unitPrice: 0 }, token).expect(400);
    await t.http().patch(`/v1/stores/${A}/products/${ids.rose}`).set(alice.auth).send({ nameEn: 'Rose Perfume' }).expect(200);
    const view = await sf('/cart').set('x-cart-token', token).expect(200);
    expect(view.body.items[0].unitPrice).toBe(12500);
  });

  it('cannot add more than the stock, sold-out variants, drafts or bad quantities', async () => {
    expect((await add({ variantId: ids.roseV, quantity: 2 }, token).expect(400)).body.message).toBe('insufficient_stock'); // 2 in cart + 2 > 3
    expect((await add({ variantId: ids.oud12 }, token).expect(400)).body.message).toBe('insufficient_stock');
    await add({ variantId: ids.draftV }, token).expect(404);
    for (const quantity of [0, -1, 100, 1.5, '2']) await add({ variantId: ids.roseV, quantity }, token).expect(400);
    await add({ variantId: 'not-a-uuid' }, token).expect(400);
    // Untracked (digital) products have no stock ceiling but still a sane cap.
    await add({ variantId: ids.ebookV, quantity: 99 }, token).expect(200);
    expect((await add({ variantId: ids.ebookV, quantity: 1 }, token).expect(400)).body.message).toBe('quantity_too_large');
  });

  it("another store's variant or cart token never works here", async () => {
    await add({ variantId: ids.bobV }, token).expect(404);
    await t.http().post(`/v1/stores/${B}/launch`).set(bob.auth).expect(200);
    // Alice's shopper token presented to Bob's shop: treated as no cart at all.
    const view = await sf('/cart', hostB).set('x-cart-token', token).expect(200);
    expect(view.body.items).toEqual([]);
    const res = await add({ variantId: ids.bobV }, token, hostB).expect(200);
    expect(res.body.cartToken).toBeDefined(); // a new, separate cart
    expect(res.body.cartToken).not.toBe(token);
    await add({ variantId: ids.roseV }, res.body.cartToken, hostB).expect(404);
    const mine = await sf('/cart').set('x-cart-token', token).expect(200);
    expect(JSON.stringify(mine.body)).not.toContain('Bob Mug');
  });

  it('changes and removes lines; lines of another cart are not reachable', async () => {
    const view = await sf('/cart').set('x-cart-token', token).expect(200);
    const rose = view.body.items.find((i: { variantId: string }) => i.variantId === ids.roseV);
    const patch = (id: string, quantity: unknown, tok = token) => t.http().patch(`/v1/storefront/cart/items/${id}`).set(shop(hostA)).set('x-cart-token', tok).send({ quantity });
    expect((await patch(rose.id, 3).expect(200)).body.cart.items.find((i: { id: string }) => i.id === rose.id).quantity).toBe(3);
    expect((await patch(rose.id, 4).expect(400)).body.message).toBe('insufficient_stock');
    await patch(rose.id, 1000).expect(400);

    const stranger = (await add({ variantId: ids.oud3 }).expect(200)).body.cartToken;
    await patch(rose.id, 1, stranger).expect(404);
    await t.http().patch(`/v1/storefront/cart/items/${rose.id}`).set(shop(hostA)).send({ quantity: 1 }).expect(404);

    const removed = await patch(rose.id, 0).expect(200);
    expect(removed.body.cart.items.some((i: { id: string }) => i.id === rose.id)).toBe(false);
  });

  it('a product that is unpublished or sells out later is flagged and left out of the total', async () => {
    const fresh = (await add({ variantId: ids.roseV, quantity: 2 }).expect(200)).body.cartToken;
    await add({ variantId: ids.oud3, quantity: 1 }, fresh).expect(200);
    await t.http().post(`/v1/stores/${A}/inventory/adjust`).set(alice.auth).send({ variantId: ids.roseV, delta: -2, reason: 'DAMAGE' }).expect(200);
    let view = await sf('/cart').set('x-cart-token', fresh).expect(200);
    expect(view.body.items.find((i: { variantId: string }) => i.variantId === ids.roseV)).toMatchObject({ issue: 'insufficient_stock', maxQuantity: 1 });

    await t.http().patch(`/v1/stores/${A}/products/${ids.oud}`).set(alice.auth).send({ status: 'ARCHIVED' }).expect(200);
    view = await sf('/cart').set('x-cart-token', fresh).expect(200);
    expect(view.body.items.find((i: { variantId: string }) => i.variantId === ids.oud3).issue).toBe('unavailable');
    expect(view.body.subtotal).toBe(25000); // archived line not counted
    await t.http().patch(`/v1/stores/${A}/products/${ids.oud}`).set(alice.auth).send({ status: 'ACTIVE' }).expect(200);
  });

  it('expired carts are ignored', async () => {
    const tok = (await add({ variantId: ids.oud3 }).expect(200)).body.cartToken;
    await ownerQuery("UPDATE carts SET expires_at = now() - interval '1 minute' WHERE id = (SELECT id FROM carts ORDER BY created_at DESC LIMIT 1)");
    expect((await sf('/cart').set('x-cart-token', tok).expect(200)).body.items).toEqual([]);
  });
});

describe('taking the store offline', () => {
  it('unlaunch hides the storefront again without deleting anything', async () => {
    await t.http().post(`/v1/stores/${A}/unlaunch`).set(alice.auth).expect(200);
    await sf('/store').expect(404);
    await sf('/products').expect(404);
    const overview = await t.http().get(`/v1/stores/${A}/theme`).set(alice.auth).expect(200);
    expect(overview.body).toMatchObject({ status: 'DRAFT', publishedThemeId: 'perfume-boutique', publishedProducts: 3 });
    await t.http().post(`/v1/stores/${A}/launch`).set(alice.auth).expect(200);
    await sf('/store').expect(200);
  });

  it('a closed store disappears from the storefront', async () => {
    await t.http().delete(`/v1/stores/${B}`).set(bob.auth).send({ confirmSlug: 'shop-b' }).expect(204);
    await sf('/store', hostB).expect(404);
  });
});
