/**
 * Isolation tests for the Phase 2 catalogue tables, plus a schema-wide guard:
 * any table with a store_id column must have RLS enabled and forced through a
 * policy for the runtime role. A future migration that forgets this fails here.
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PrismaClient, withTenant } from '../src';
import { appClient, requireEnv, truncateAll } from './helpers';

let prisma: PrismaClient;
const storeA = randomUUID();
const storeB = randomUUID();
const ids = { productA: randomUUID(), productB: randomUUID(), variantA: randomUUID(), variantB: randomUUID(), catA: randomUUID(), catB: randomUUID() };

async function seed(storeId: string, slug: string, productId: string, variantId: string, catId: string) {
  await withTenant(prisma, { storeId }, async (tx) => {
    await tx.store.create({ data: { id: storeId, name: slug, slug } });
    await tx.category.create({ data: { id: catId, storeId, nameEn: 'Cat', slug: 'cat' } });
    await tx.brand.create({ data: { storeId, name: 'Brand', slug: 'brand' } });
    await tx.product.create({ data: { id: productId, storeId, nameEn: 'Product', slug: 'product' } });
    await tx.productVariant.create({ data: { id: variantId, storeId, productId, sku: 'SKU-1', price: 1500, stockQuantity: 5 } });
    await tx.productCategory.create({ data: { storeId, productId, categoryId: catId } });
    await tx.inventoryMovement.create({ data: { storeId, variantId, delta: 5, quantityAfter: 5, reason: 'INITIAL' } });
  });
}

beforeAll(async () => {
  await truncateAll();
  prisma = appClient();
  await seed(storeA, 'cat-a', ids.productA, ids.variantA, ids.catA);
  await seed(storeB, 'cat-b', ids.productB, ids.variantB, ids.catB);
});
afterAll(() => prisma.$disconnect());

describe('schema-wide guard', () => {
  it('every table with a store_id column has RLS enabled and a policy for the runtime role', async () => {
    const pg = new Client({ connectionString: requireEnv('TEST_DATABASE_OWNER_URL') });
    await pg.connect();
    try {
      const { rows } = await pg.query(`
        SELECT c.relname AS table, c.relrowsecurity AS rls,
               (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname AND 'mtjari_app' = ANY(p.roles)) AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'store_id' AND NOT a.attisdropped
        WHERE c.relkind = 'r' ORDER BY 1`);
      expect(rows.length).toBeGreaterThanOrEqual(24);
      const unprotected = rows.filter((r) => !r.rls || r.policies === 0).map((r) => r.table);
      expect(unprotected).toEqual([]);
    } finally {
      await pg.end();
    }
  });
});

describe('catalogue isolation', () => {
  it('same slug and SKU can exist in two stores, and each store sees only its own', async () => {
    for (const [storeId, productId] of [[storeA, ids.productA], [storeB, ids.productB]] as const) {
      await withTenant(prisma, { storeId }, async (tx) => {
        expect((await tx.product.findMany()).map((p) => p.id)).toEqual([productId]);
        expect(await tx.productVariant.count()).toBe(1);
        expect(await tx.category.count()).toBe(1);
        expect(await tx.brand.count()).toBe(1);
        expect(await tx.productCategory.count()).toBe(1);
        expect(await tx.inventoryMovement.count()).toBe(1);
      });
    }
  });

  it('sees nothing without a tenant context', async () => {
    expect(await prisma.product.count()).toBe(0);
    expect(await prisma.productVariant.count()).toBe(0);
    expect(await prisma.inventoryMovement.count()).toBe(0);
  });

  it('cannot update or delete another store’s catalogue rows', async () => {
    await withTenant(prisma, { storeId: storeA }, async (tx) => {
      expect((await tx.productVariant.updateMany({ where: { id: ids.variantB }, data: { price: 1 } })).count).toBe(0);
      expect((await tx.product.deleteMany({ where: { id: ids.productB } })).count).toBe(0);
    });
  });

  it('composite foreign keys reject links to another store’s rows', async () => {
    // Variant in store A pointing at store B's product.
    await expect(
      withTenant(prisma, { storeId: storeA }, (tx) => tx.productVariant.create({ data: { storeId: storeA, productId: ids.productB, price: 100 } })),
    ).rejects.toThrow();
    // Store A's product filed under store B's category.
    await expect(
      withTenant(prisma, { storeId: storeA }, (tx) => tx.productCategory.create({ data: { storeId: storeA, productId: ids.productA, categoryId: ids.catB } })),
    ).rejects.toThrow();
    // Stock movement against store B's variant.
    await expect(
      withTenant(prisma, { storeId: storeA }, (tx) => tx.inventoryMovement.create({ data: { storeId: storeA, variantId: ids.variantB, delta: 1, quantityAfter: 1, reason: 'ADJUSTMENT' } })),
    ).rejects.toThrow();
    // Cross-store product relation.
    await expect(
      withTenant(prisma, { storeId: storeA }, (tx) => tx.productRelation.create({ data: { storeId: storeA, productId: ids.productA, relatedProductId: ids.productB, type: 'RELATED' } })),
    ).rejects.toThrow();
  });
});

describe('integrity rules', () => {
  it('stock can never go negative and prices cannot be negative', async () => {
    await expect(
      withTenant(prisma, { storeId: storeA }, (tx) => tx.productVariant.update({ where: { id: ids.variantA }, data: { stockQuantity: { decrement: 6 } } })),
    ).rejects.toThrow();
    await expect(
      withTenant(prisma, { storeId: storeA }, (tx) => tx.productVariant.update({ where: { id: ids.variantA }, data: { price: -1 } })),
    ).rejects.toThrow();
  });

  it('a product needs a name in at least one language', async () => {
    await expect(
      withTenant(prisma, { storeId: storeA }, (tx) => tx.product.create({ data: { storeId: storeA, slug: 'nameless', nameAr: '  ' } })),
    ).rejects.toThrow();
  });

  it('the stock ledger is append-only', async () => {
    await expect(withTenant(prisma, { storeId: storeA }, (tx) => tx.inventoryMovement.updateMany({ data: { delta: 99 } }))).rejects.toThrow(/permission denied/i);
    await expect(withTenant(prisma, { storeId: storeA }, (tx) => tx.inventoryMovement.deleteMany())).rejects.toThrow(/permission denied/i);
  });
});
