import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { createStore, createTestApp, ownerQuery, resetDb, signUp, type Session, type TestApp } from './helpers';

let t: TestApp;
let alice: Session;
let bob: Session;
let A: string;
let B: string;
const base = () => `/v1/stores/${A}`;

async function joinAs(email: string, roleKey: string): Promise<Session> {
  const s = await signUp(t, email);
  const roles = await t.http().get(`${base()}/roles`).set(alice.auth).expect(200);
  const roleId = roles.body.find((r: { key: string }) => r.key === roleKey).id;
  await t.http().post(`${base()}/invitations`).set(alice.auth).send({ email, roleId }).expect(201);
  await t.http().post('/v1/invitations/accept').set(s.auth).send({ token: t.mail.tokenFor(email) }).expect(200);
  return s;
}

const png = (w = 1200, h = 900) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 37, g: 99, b: 235 } } }).png().toBuffer();

beforeAll(async () => {
  await resetDb();
  t = await createTestApp();
  alice = await signUp(t, 'alice@example.com');
  bob = await signUp(t, 'bob@example.com');
  A = (await createStore(t, alice, 'catalog-a')).id; // KWD, 3 decimals
  B = (await createStore(t, bob, 'catalog-b')).id;
});
afterAll(() => t.close());

describe('categories and brands', () => {
  let parent: string;
  it('creates a tree with Arabic slugs and rejects cycles', async () => {
    const p = await t.http().post(`${base()}/categories`).set(alice.auth).send({ nameAr: 'عطور رجالية', nameEn: 'Men Perfume' }).expect(201);
    expect(p.body.slug).toBe('men-perfume');
    parent = p.body.id;
    const ar = await t.http().post(`${base()}/categories`).set(alice.auth).send({ nameAr: 'عود وبخور', parentId: parent }).expect(201);
    expect(ar.body.slug).toBe('عود-وبخور');
    const dup = await t.http().post(`${base()}/categories`).set(alice.auth).send({ nameEn: 'Men Perfume' }).expect(201);
    expect(dup.body.slug).toBe('men-perfume-2'); // generated slugs never collide
    await t.http().post(`${base()}/categories`).set(alice.auth).send({ nameEn: 'X', slug: 'men-perfume' }).expect(409);
    await t.http().post(`${base()}/categories`).set(alice.auth).send({ slug: 'no-name' }).expect(400);

    const cyc = await t.http().patch(`${base()}/categories/${parent}`).set(alice.auth).send({ parentId: ar.body.id }).expect(400);
    expect(cyc.body.message).toBe('category_cycle');
    const blocked = await t.http().delete(`${base()}/categories/${parent}`).set(alice.auth).expect(409);
    expect(blocked.body.message).toBe('category_has_children');
    await t.http().delete(`${base()}/categories/${dup.body.id}`).set(alice.auth).expect(204);
    const list = await t.http().get(`${base()}/categories`).set(alice.auth).expect(200);
    expect(list.body).toHaveLength(2);
  });

  it('a category in another store cannot be used as parent', async () => {
    const other = await t.http().post(`/v1/stores/${B}/categories`).set(bob.auth).send({ nameEn: 'Bob cat' }).expect(201);
    const res = await t.http().post(`${base()}/categories`).set(alice.auth).send({ nameEn: 'Child', parentId: other.body.id }).expect(400);
    expect(res.body.message).toBe('parent_not_found');
  });

  it('brands: create, rename, delete', async () => {
    const b = await t.http().post(`${base()}/brands`).set(alice.auth).send({ name: 'Ajmal' }).expect(201);
    expect(b.body.slug).toBe('ajmal');
    await t.http().patch(`${base()}/brands/${b.body.id}`).set(alice.auth).send({ name: 'Ajmal Perfumes' }).expect(200);
    await t.http().delete(`${base()}/brands/${b.body.id}`).set(alice.auth).expect(204);
    await t.http().delete(`${base()}/brands/${b.body.id}`).set(alice.auth).expect(404);
  });
});

describe('products', () => {
  let simpleId: string;
  let variantId: string;

  it('creates a simple product with stock, a ledger entry and an audit entry', async () => {
    const cats = await t.http().get(`${base()}/categories`).set(alice.auth).expect(200);
    const brand = await t.http().post(`${base()}/brands`).set(alice.auth).send({ name: 'Oud House' }).expect(201);
    const res = await t.http().post(`${base()}/products`).set(alice.auth).send({
      nameAr: 'عطر الورد', nameEn: 'Rose Perfume', status: 'ACTIVE', brandId: brand.body.id, categoryIds: [cats.body[0].id],
      seoTitle: 'Rose Perfume 50ml', tags: ['rose', 'gift'],
      variants: [{ sku: 'ROSE-50', barcode: '6291041500213', price: 12500, compareAtPrice: 15000, cost: 7000, initialStock: 20, lowStockThreshold: 5 }],
    }).expect(201);
    simpleId = res.body.id;
    expect(res.body).toMatchObject({ slug: 'rose-perfume', type: 'SIMPLE', status: 'ACTIVE', brand: { name: 'Oud House' } });
    expect(res.body.variants).toHaveLength(1);
    expect(res.body.variants[0]).toMatchObject({ sku: 'ROSE-50', price: 12500, stockQuantity: 20, trackInventory: true });
    expect(res.body.categories).toHaveLength(1);

    const moves = await t.http().get(`${base()}/inventory/movements?variantId=${res.body.variants[0].id}`).set(alice.auth).expect(200);
    expect(moves.body.items).toEqual([expect.objectContaining({ delta: 20, quantityAfter: 20, reason: 'INITIAL', actorUserId: alice.userId })]);
    const audit = await t.http().get(`${base()}/audit-logs?action=product.created`).set(alice.auth).expect(200);
    expect(audit.body.items[0].entityId).toBe(simpleId);
  });

  it('creates a variant product from an options matrix', async () => {
    const res = await t.http().post(`${base()}/products`).set(alice.auth).send({
      nameEn: 'Cotton Thobe', type: 'VARIANT',
      options: [{ name: 'Size', values: ['52', '54', '56'] }, { name: 'Color', values: ['White', 'Grey'] }],
      variants: ['52', '54', '56'].flatMap((size) => ['White', 'Grey'].map((color) => ({
        sku: `THOBE-${size}-${color[0]}`, optionValues: { Size: size, Color: color }, price: 9000, initialStock: 3,
      }))),
    }).expect(201);
    variantId = res.body.id;
    expect(res.body.variants).toHaveLength(6);
    expect(res.body.options.map((o: { name: string }) => o.name)).toEqual(['Size', 'Color']);
  });

  it('digital products never track stock', async () => {
    const res = await t.http().post(`${base()}/products`).set(alice.auth).send({
      nameEn: 'E-book', type: 'DIGITAL', variants: [{ price: 2000, initialStock: 50, trackInventory: true }],
    }).expect(201);
    expect(res.body.variants[0]).toMatchObject({ trackInventory: false, stockQuantity: 0 });
  });

  it.each([
    ['missing name', { variants: [{ price: 1 }] }],
    ['no variants', { nameEn: 'X', variants: [] }],
    ['negative price', { nameEn: 'X', variants: [{ price: -5 }] }],
    ['fractional price', { nameEn: 'X', variants: [{ price: 10.5 }] }],
    ['compare-at not above price', { nameEn: 'X', variants: [{ price: 100, compareAtPrice: 100 }] }],
    ['simple with two variants', { nameEn: 'X', variants: [{ price: 1 }, { price: 2 }] }],
    ['variant value not in options', { nameEn: 'X', type: 'VARIANT', options: [{ name: 'Size', values: ['S'] }], variants: [{ price: 1, optionValues: { Size: 'XL' } }] }],
    ['duplicate combination', { nameEn: 'X', type: 'VARIANT', options: [{ name: 'Size', values: ['S'] }], variants: [{ price: 1, optionValues: { Size: 'S' } }, { price: 1, optionValues: { Size: 'S' } }] }],
    ['client-supplied storeId', { nameEn: 'X', storeId: '00000000-0000-4000-8000-000000000000', variants: [{ price: 1 }] }],
  ])('rejects %s', async (_, body) => {
    await t.http().post(`${base()}/products`).set(alice.auth).send(body).expect(400);
  });

  it('SKU is unique per store, but reusable in another store', async () => {
    const dup = await t.http().post(`${base()}/products`).set(alice.auth).send({ nameEn: 'Dup', variants: [{ sku: 'ROSE-50', price: 1 }] }).expect(409);
    expect(dup.body.message).toBe('sku_taken');
    await t.http().post(`/v1/stores/${B}/products`).set(bob.auth).send({ nameEn: 'Bob Rose', slug: 'rose-perfume', variants: [{ sku: 'ROSE-50', price: 1 }] }).expect(201);
  });

  it('lists with search, filters, price range and pagination', async () => {
    const all = await t.http().get(`${base()}/products?limit=2`).set(alice.auth).expect(200);
    expect(all.body).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect(all.body.items).toHaveLength(2);
    const bySku = await t.http().get(`${base()}/products?q=thobe-54`).set(alice.auth).expect(200);
    expect(bySku.body.items.map((p: { id: string }) => p.id)).toEqual([variantId]);
    expect(bySku.body.items[0]).toMatchObject({ variantCount: 6, stock: 18, priceMin: 9000, priceMax: 9000 });
    const arabic = await t.http().get(`${base()}/products?q=${encodeURIComponent('الورد')}`).set(alice.auth).expect(200);
    expect(arabic.body.items.map((p: { id: string }) => p.id)).toEqual([simpleId]);
    const active = await t.http().get(`${base()}/products?status=ACTIVE`).set(alice.auth).expect(200);
    expect(active.body.total).toBe(1);
    await t.http().get(`${base()}/products?status=NOPE`).set(alice.auth).expect(400);
  });

  it('partial update changes only what was sent; names cannot both be cleared', async () => {
    const res = await t.http().patch(`${base()}/products/${simpleId}`).set(alice.auth).send({ descriptionAr: 'وصف', status: 'DRAFT' }).expect(200);
    expect(res.body).toMatchObject({ nameEn: 'Rose Perfume', descriptionAr: 'وصف', status: 'DRAFT', seoTitle: 'Rose Perfume 50ml' });
    expect(res.body.categories).toHaveLength(1);
    const cleared = await t.http().patch(`${base()}/products/${simpleId}`).set(alice.auth).send({ nameAr: '', nameEn: '' }).expect(400);
    expect(cleared.body.message).toBe('name_required');
    await t.http().patch(`${base()}/products/${simpleId}`).set(alice.auth).send({ slug: 'cotton-thobe' }).expect(409);
    await t.http().patch(`${base()}/products/${simpleId}`).set(alice.auth).send({ type: 'DIGITAL' }).expect(400);
  });

  it('replacing variants keeps stock of kept variants, adds new ones, removes the rest', async () => {
    const before = await t.http().get(`${base()}/products/${variantId}`).set(alice.auth).expect(200);
    const keep = before.body.variants.filter((v: { optionValues: { Color: string } }) => v.optionValues.Color === 'White');
    const res = await t.http().put(`${base()}/products/${variantId}/variants`).set(alice.auth).send({
      options: [{ name: 'Size', values: ['52', '54', '56', '58'] }, { name: 'Color', values: ['White'] }],
      variants: [
        ...keep.map((v: { id: string; sku: string; optionValues: object }) => ({ id: v.id, sku: v.sku, optionValues: v.optionValues, price: 9500, initialStock: 999 })),
        { sku: 'THOBE-58-W', optionValues: { Size: '58', Color: 'White' }, price: 9900, initialStock: 7 },
      ],
    }).expect(200);
    expect(res.body.variants).toHaveLength(4);
    const kept = res.body.variants.find((v: { id: string }) => v.id === keep[0].id);
    expect(kept).toMatchObject({ price: 9500, stockQuantity: 3 }); // initialStock ignored for existing variants
    expect(res.body.variants.find((v: { sku: string }) => v.sku === 'THOBE-58-W').stockQuantity).toBe(7);

    const foreign = await t.http().get(`${base()}/products/${simpleId}`).set(alice.auth).expect(200);
    await t.http().put(`${base()}/products/${variantId}/variants`).set(alice.auth).send({
      options: [{ name: 'Size', values: ['52'] }],
      variants: [{ id: foreign.body.variants[0].id, optionValues: { Size: '52' }, price: 1 }],
    }).expect(400);
  });

  it('relations must point at products of the same store', async () => {
    const ok = await t.http().put(`${base()}/products/${simpleId}/relations`).set(alice.auth).send({ type: 'UPSELL', productIds: [variantId] }).expect(200);
    expect(ok.body.relations).toEqual([expect.objectContaining({ type: 'UPSELL', id: variantId })]);
    await t.http().put(`${base()}/products/${simpleId}/relations`).set(alice.auth).send({ type: 'RELATED', productIds: [simpleId] }).expect(400);
    const bobs = await t.http().get(`/v1/stores/${B}/products`).set(bob.auth).expect(200);
    const res = await t.http().put(`${base()}/products/${simpleId}/relations`).set(alice.auth).send({ type: 'RELATED', productIds: [bobs.body.items[0].id] }).expect(400);
    expect(res.body.message).toBe('related_product_not_found');
  });

  it('deleting a product hides it and frees its slug and SKU', async () => {
    const p = await t.http().post(`${base()}/products`).set(alice.auth).send({ nameEn: 'Temp', variants: [{ sku: 'TEMP-1', price: 100 }] }).expect(201);
    await t.http().delete(`${base()}/products/${p.body.id}`).set(alice.auth).expect(204);
    await t.http().get(`${base()}/products/${p.body.id}`).set(alice.auth).expect(404);
    const again = await t.http().post(`${base()}/products`).set(alice.auth).send({ nameEn: 'Temp', slug: 'temp', variants: [{ sku: 'TEMP-1', price: 100 }] }).expect(201);
    expect(again.body.slug).toBe('temp');
    await t.http().delete(`${base()}/products/${again.body.id}`).set(alice.auth).expect(204);
  });
});

describe('inventory', () => {
  let variant: string;
  beforeAll(async () => {
    const p = await t.http().post(`${base()}/products`).set(alice.auth).send({ nameEn: 'Stock item', variants: [{ sku: 'STK-1', price: 500, initialStock: 10, lowStockThreshold: 4 }] }).expect(201);
    variant = p.body.variants[0].id;
  });

  it('adjusts by delta and by absolute count, writing the ledger each time', async () => {
    const a = await t.http().post(`${base()}/inventory/adjust`).set(alice.auth).send({ variantId: variant, delta: -3, reason: 'DAMAGE', note: 'broken in transit' }).expect(200);
    expect(a.body).toMatchObject({ changed: true, stockQuantity: 7, delta: -3 });
    const b = await t.http().post(`${base()}/inventory/adjust`).set(alice.auth).send({ variantId: variant, setTo: 12, reason: 'CORRECTION' }).expect(200);
    expect(b.body).toMatchObject({ stockQuantity: 12, delta: 5 });
    const same = await t.http().post(`${base()}/inventory/adjust`).set(alice.auth).send({ variantId: variant, setTo: 12, reason: 'CORRECTION' }).expect(200);
    expect(same.body.changed).toBe(false);
    const moves = await t.http().get(`${base()}/inventory/movements?variantId=${variant}`).set(alice.auth).expect(200);
    expect(moves.body.items.map((m: { delta: number; quantityAfter: number }) => [m.delta, m.quantityAfter])).toEqual([[5, 12], [-3, 7], [10, 10]]);
  });

  it('never lets stock go negative', async () => {
    const res = await t.http().post(`${base()}/inventory/adjust`).set(alice.auth).send({ variantId: variant, delta: -13, reason: 'ADJUSTMENT' }).expect(409);
    expect(res.body.message).toBe('insufficient_stock');
  });

  it('concurrent adjustments are serialised: balance equals the ledger', async () => {
    await t.http().post(`${base()}/inventory/adjust`).set(alice.auth).send({ variantId: variant, setTo: 10, reason: 'CORRECTION' }).expect(200);
    const results = await Promise.all(
      Array.from({ length: 15 }, () => t.http().post(`${base()}/inventory/adjust`).set(alice.auth).send({ variantId: variant, delta: -1, reason: 'ADJUSTMENT' })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(10);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    const [row] = await ownerQuery<{ stock: number; ledger: number }>(
      'SELECT v.stock_quantity AS stock, (SELECT sum(delta)::int FROM inventory_movements m WHERE m.variant_id = v.id) AS ledger FROM product_variants v WHERE v.id = $1', [variant]);
    expect(row).toEqual({ stock: 0, ledger: 0 });
  });

  it('low-stock list and summary reflect thresholds', async () => {
    const low = await t.http().get(`${base()}/inventory?lowStock=true`).set(alice.auth).expect(200);
    expect(low.body.items.map((v: { id: string }) => v.id)).toContain(variant);
    expect(low.body.items.every((v: { low: boolean }) => v.low)).toBe(true);
    const summary = await t.http().get(`${base()}/catalog/summary`).set(alice.auth).expect(200);
    expect(summary.body).toMatchObject({ products: 4, lowStock: 1, outOfStock: 1 });
    const search = await t.http().get(`${base()}/inventory?q=stk-1`).set(alice.auth).expect(200);
    expect(search.body.total).toBe(1);
  });

  it('untracked variants cannot be adjusted', async () => {
    const p = await t.http().post(`${base()}/products`).set(alice.auth).send({ nameEn: 'Service', variants: [{ price: 100, trackInventory: false }] }).expect(201);
    const res = await t.http().post(`${base()}/inventory/adjust`).set(alice.auth).send({ variantId: p.body.variants[0].id, delta: 1, reason: 'RESTOCK' }).expect(400);
    expect(res.body.message).toBe('inventory_not_tracked');
  });
});

describe('product images', () => {
  let productId: string;
  beforeAll(async () => {
    productId = (await t.http().post(`${base()}/products`).set(alice.auth).send({ nameEn: 'With image', variants: [{ price: 100 }] }).expect(201)).body.id;
  });

  it('re-encodes uploads to WebP sizes, stores them under the store prefix and serves them publicly', async () => {
    const res = await t.http().post(`${base()}/products/${productId}/media`).set(alice.auth).attach('file', await png(), 'photo.png').field('altAr', 'صورة المنتج').expect(201);
    expect(res.body).toMatchObject({ width: 1200, height: 900, altAr: 'صورة المنتج', position: 0 });
    expect(Object.keys(res.body.urls)).toEqual(['400', '800', '1200']);
    const url: string = res.body.urls['800'];
    expect(url).toContain(`/media/stores/${A}/products/${productId}/`);
    const file = await t.http().get(new URL(url).pathname).expect(200); // no auth: product images are public
    expect(file.headers['content-type']).toBe('image/webp');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    const meta = await sharp(file.body).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 800 });

    const list = await t.http().get(`${base()}/products`).set(alice.auth).expect(200);
    expect(list.body.items.find((p: { id: string }) => p.id === productId).image.urls['400']).toBeTruthy();
  });

  it('rejects files that are not images, whatever their name says', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const res = await t.http().post(`${base()}/products/${productId}/media`).set(alice.auth).attach('file', html, { filename: 'evil.png', contentType: 'image/png' }).expect(400);
    expect(res.body.message).toBe('invalid_image');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await t.http().post(`${base()}/products/${productId}/media`).set(alice.auth).attach('file', svg, 'x.svg').expect(400);
    await t.http().post(`${base()}/products/${productId}/media`).set(alice.auth).expect(400);
  });

  it('updates alt text and deletes the files with the record', async () => {
    const up = await t.http().post(`${base()}/products/${productId}/media`).set(alice.auth).attach('file', await png(300, 300), 'small.png').expect(201);
    expect(Object.keys(up.body.urls)).toEqual(['300']); // never upscaled
    const key = new URL(up.body.urls['300']).pathname.replace('/media/', '');
    const onDisk = join(process.env.STORAGE_LOCAL_DIR!, key);
    expect(existsSync(onDisk)).toBe(true);
    const upd = await t.http().patch(`${base()}/products/${productId}/media/${up.body.id}`).set(alice.auth).send({ altEn: 'Front view' }).expect(200);
    expect(upd.body.altEn).toBe('Front view');
    await t.http().delete(`${base()}/products/${productId}/media/${up.body.id}`).set(alice.auth).expect(204);
    expect(existsSync(onDisk)).toBe(false);
  });

  it('another store cannot attach, edit or delete images here', async () => {
    const mine = await t.http().get(`${base()}/products/${productId}`).set(alice.auth).expect(200);
    const mediaId = mine.body.media[0].id;
    await t.http().post(`${base()}/products/${productId}/media`).set(bob.auth).attach('file', await png(100, 100), 'a.png').expect(404);
    await t.http().post(`/v1/stores/${B}/products/${productId}/media`).set(bob.auth).attach('file', await png(100, 100), 'a.png').expect(404);
    await t.http().delete(`/v1/stores/${B}/products/${productId}/media/${mediaId}`).set(bob.auth).expect(404);
  });
});

describe('CSV import and export', () => {
  it('imports new products (simple + variants), creating brands and categories, and reports bad rows', async () => {
    const csv = [
      'slug,name_ar,name_en,brand,categories,sku,price,compare_at_price,cost,stock,low_stock_threshold,option1_name,option1_value',
      'arabic-coffee,قهوة عربية,Arabic Coffee,Dallah,Coffee|مشروبات,COF-250,3.500,4.250,1.900,40,5,,',
      'mug,,Ceramic Mug,Dallah,Coffee,MUG-S,2.000,,,10,,Size,Small',
      'mug,,Ceramic Mug,Dallah,Coffee,MUG-L,2.750,,,6,,Size,Large',
      'bad-price,,Bad price,,,BAD-1,abc,,,1,,,',
      'too-precise,,Too precise,,,BAD-2,1.2345,,,1,,,',
      ',,,,,NONAME,1.000,,,,,,',
      'dup-sku,,Dup SKU,,,COF-250,1.000,,,,,,',
    ].join('\r\n');
    const res = await t.http().post(`${base()}/products/import`).set(alice.auth).attach('file', Buffer.from(csv), 'products.csv').expect(200);
    expect(res.body).toMatchObject({ rows: 7, productsCreated: 2, variantsUpdated: 0 });
    expect(res.body.errors).toEqual([
      { row: 7, message: 'name_required' },
      { row: 5, message: 'invalid_price' },
      { row: 6, message: 'invalid_price' },
      { row: 8, message: 'sku_taken' },
    ]);

    const coffee = await t.http().get(`${base()}/products?q=COF-250`).set(alice.auth).expect(200);
    expect(coffee.body.items[0]).toMatchObject({ nameAr: 'قهوة عربية', brand: 'Dallah', priceMin: 3500, stock: 40 });
    const mug = await t.http().get(`${base()}/products?q=mug`).set(alice.auth).expect(200);
    expect(mug.body.items[0]).toMatchObject({ type: 'VARIANT', variantCount: 2, priceMin: 2000, priceMax: 2750, stock: 16 });
    const cats = await t.http().get(`${base()}/categories`).set(alice.auth).expect(200);
    expect(cats.body.map((c: { slug: string }) => c.slug)).toEqual(expect.arrayContaining(['coffee', 'مشروبات']));
  });

  it('re-importing updates price and stock by SKU through the ledger', async () => {
    const csv = 'slug,name_en,sku,price,stock\r\nmug,Ceramic Mug,MUG-S,2.250,25\r\nmug,Ceramic Mug,MUG-XL,9.000,1\r\n';
    const res = await t.http().post(`${base()}/products/import`).set(alice.auth).attach('file', Buffer.from(csv), 'p.csv').expect(200);
    // The unknown SKU fails the whole product, so MUG-S is not half-applied.
    expect(res.body).toMatchObject({ productsCreated: 0, errors: [{ row: 3, message: 'sku_not_found_in_product' }] });
    const ok = await t.http().post(`${base()}/products/import`).set(alice.auth).attach('file', Buffer.from('slug,name_en,sku,price,stock\r\nmug,Ceramic Mug,MUG-S,2.250,25\r\n'), 'p.csv').expect(200);
    expect(ok.body).toMatchObject({ variantsUpdated: 1, errors: [] });
    const inv = await t.http().get(`${base()}/inventory?q=MUG-S`).set(alice.auth).expect(200);
    expect(inv.body.items[0].stockQuantity).toBe(25);
    const moves = await t.http().get(`${base()}/inventory/movements?variantId=${inv.body.items[0].id}`).set(alice.auth).expect(200);
    expect(moves.body.items[0]).toMatchObject({ delta: 15, quantityAfter: 25, reason: 'IMPORT' });
  });

  it('rejects malformed, empty and oversized files', async () => {
    const post = (body: string) => t.http().post(`${base()}/products/import`).set(alice.auth).attach('file', Buffer.from(body), 'p.csv');
    expect((await post('name_en,price\r\n"unterminated,1')).body.message).toBe('csv_malformed');
    expect((await post('name_en,price\r\n')).body.message).toBe('csv_empty');
    expect((await post('title,amount\r\nx,1\r\n')).body.message).toBe('csv_missing_columns');
    expect((await post('name_en,price\r\n' + 'x,1\r\n'.repeat(1001))).body.message).toBe('csv_too_many_rows');
  });

  it('exports every variant with store-currency decimals and round-trips through import', async () => {
    const res = await t.http().get(`${base()}/products/export`).set(alice.auth).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toContain('slug,name_ar,name_en,type,status');
    const coffee = lines.find((l) => l.includes('COF-250'))!;
    expect(coffee).toContain('3.500,4.250,1.900,40,5');
    const again = await t.http().post(`${base()}/products/import`).set(alice.auth).attach('file', Buffer.from(res.text), 'export.csv').expect(200);
    expect(again.body.productsCreated).toBe(0);
    expect(again.body.errors).toEqual([]);
  });
});

describe('permissions and tenant isolation', () => {
  let viewer: Session;
  let productId: string;
  let variantId: string;
  beforeAll(async () => {
    viewer = await joinAs('viewer@example.com', 'viewer');
    const list = await t.http().get(`${base()}/products?q=ROSE-50`).set(alice.auth).expect(200);
    productId = list.body.items[0].id;
    variantId = (await t.http().get(`${base()}/products/${productId}`).set(alice.auth).expect(200)).body.variants[0].id;
  });

  it('viewer can read the catalogue and stock but change nothing', async () => {
    await t.http().get(`${base()}/products`).set(viewer.auth).expect(200);
    await t.http().get(`${base()}/inventory`).set(viewer.auth).expect(200);
    await t.http().get(`${base()}/products/export`).set(viewer.auth).expect(200);
    const tries = [
      t.http().post(`${base()}/products`).set(viewer.auth).send({ nameEn: 'X', variants: [{ price: 1 }] }),
      t.http().patch(`${base()}/products/${productId}`).set(viewer.auth).send({ status: 'ARCHIVED' }),
      t.http().delete(`${base()}/products/${productId}`).set(viewer.auth),
      t.http().post(`${base()}/categories`).set(viewer.auth).send({ nameEn: 'X' }),
      t.http().post(`${base()}/brands`).set(viewer.auth).send({ name: 'X' }),
      t.http().post(`${base()}/inventory/adjust`).set(viewer.auth).send({ variantId, delta: 1, reason: 'RESTOCK' }),
      t.http().post(`${base()}/products/import`).set(viewer.auth).attach('file', Buffer.from('name_en,price\r\nx,1\r\n'), 'p.csv'),
    ];
    for (const res of await Promise.all(tries)) expect(res.status).toBe(403);
  });

  it('a merchant from another store gets 404 on every catalogue route', async () => {
    const routes: [string, string][] = [
      ['get', '/products'], ['post', '/products'], ['get', `/products/${productId}`], ['patch', `/products/${productId}`],
      ['delete', `/products/${productId}`], ['put', `/products/${productId}/variants`], ['get', '/products/export'],
      ['get', '/categories'], ['post', '/categories'], ['get', '/brands'], ['get', '/inventory'],
      ['post', '/inventory/adjust'], ['get', '/inventory/movements'], ['get', '/catalog/summary'],
    ];
    for (const [method, path] of routes) {
      const res = await (t.http() as unknown as Record<string, (u: string) => { set: (h: object) => { send: (b: object) => Promise<{ status: number }> } }>)[method]!(`${base()}${path}`).set(bob.auth).send({});
      expect([method, path, res.status]).toEqual([method, path, 404]);
    }
  });

  it('ids from store A do not work inside store B routes', async () => {
    await t.http().get(`/v1/stores/${B}/products/${productId}`).set(bob.auth).expect(404);
    await t.http().patch(`/v1/stores/${B}/products/${productId}`).set(bob.auth).send({ status: 'ARCHIVED' }).expect(404);
    await t.http().delete(`/v1/stores/${B}/products/${productId}`).set(bob.auth).expect(404);
    const adj = await t.http().post(`/v1/stores/${B}/inventory/adjust`).set(bob.auth).send({ variantId, setTo: 0, reason: 'CORRECTION' }).expect(404);
    expect(adj.body.message).toBe('variant_not_found');
    const cats = await t.http().get(`${base()}/categories`).set(alice.auth).expect(200);
    const res = await t.http().post(`/v1/stores/${B}/products`).set(bob.auth).send({ nameEn: 'Steal', categoryIds: [cats.body[0].id], variants: [{ price: 1 }] }).expect(400);
    expect(res.body.message).toBe('category_not_found');
    const moves = await t.http().get(`/v1/stores/${B}/inventory/movements?variantId=${variantId}`).set(bob.auth).expect(200);
    expect(moves.body.total).toBe(0);

    const still = await t.http().get(`${base()}/products/${productId}`).set(alice.auth).expect(200);
    expect(still.body.variants[0].stockQuantity).toBe(20);
    const bobList = await t.http().get(`/v1/stores/${B}/products`).set(bob.auth).expect(200);
    expect(bobList.body.total).toBe(1);
  });
});
