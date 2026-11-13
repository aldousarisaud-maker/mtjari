/** Isolation tests for the Phase 3 tables: theme settings and shopping carts. */
import { randomUUID } from 'node:crypto';
import { PrismaClient, withTenant } from '../src';
import { appClient, truncateAll } from './helpers';

let prisma: PrismaClient;
const A = randomUUID();
const B = randomUUID();
const ids = { variantA: randomUUID(), variantB: randomUUID(), cartA: randomUUID(), cartB: randomUUID() };

async function seed(storeId: string, slug: string, variantId: string, cartId: string) {
  await withTenant(prisma, { storeId }, async (tx) => {
    await tx.store.create({ data: { id: storeId, name: slug, slug } });
    const p = await tx.product.create({ data: { storeId, nameEn: 'Product', slug: 'product', status: 'ACTIVE' } });
    await tx.productVariant.create({ data: { id: variantId, storeId, productId: p.id, price: 1000, stockQuantity: 5 } });
    await tx.storeTheme.create({ data: { storeId, themeId: 'gulf-premium', draft: { marker: slug } } });
    await tx.cart.create({ data: { id: cartId, storeId, tokenHash: `hash-${slug}`, expiresAt: new Date(Date.now() + 3600_000) } });
    await tx.cartItem.create({ data: { storeId, cartId, variantId, quantity: 2 } });
  });
}

beforeAll(async () => {
  await truncateAll();
  prisma = appClient();
  await seed(A, 'shop-a', ids.variantA, ids.cartA);
  await seed(B, 'shop-b', ids.variantB, ids.cartB);
});
afterAll(() => prisma.$disconnect());

describe('storefront tables isolation', () => {
  it('each store sees only its own theme settings and carts', async () => {
    for (const [storeId, slug, cartId] of [[A, 'shop-a', ids.cartA], [B, 'shop-b', ids.cartB]] as const) {
      await withTenant(prisma, { storeId }, async (tx) => {
        expect((await tx.storeTheme.findMany()).map((t) => (t.draft as { marker: string }).marker)).toEqual([slug]);
        expect((await tx.cart.findMany()).map((c) => c.id)).toEqual([cartId]);
        expect(await tx.cartItem.count()).toBe(1);
      });
    }
  });

  it('nothing is visible without a tenant context', async () => {
    expect(await prisma.storeTheme.count()).toBe(0);
    expect(await prisma.cart.count()).toBe(0);
    expect(await prisma.cartItem.count()).toBe(0);
  });

  it("a cart token from another store finds nothing, even with the right hash", async () => {
    await withTenant(prisma, { storeId: A }, async (tx) => {
      expect(await tx.cart.findFirst({ where: { tokenHash: 'hash-shop-b' } })).toBeNull();
      expect(await tx.cart.findFirst({ where: { id: ids.cartB } })).toBeNull();
    });
  });

  it("cannot write theme settings or carts into another store", async () => {
    await expect(
      withTenant(prisma, { storeId: A }, (tx) => tx.storeTheme.create({ data: { storeId: B, themeId: 'coffee-house', draft: {} } })),
    ).rejects.toThrow();
    await expect(
      withTenant(prisma, { storeId: A }, (tx) => tx.cart.create({ data: { storeId: B, tokenHash: 'x', expiresAt: new Date() } })),
    ).rejects.toThrow();
    await withTenant(prisma, { storeId: A }, async (tx) => {
      expect((await tx.storeTheme.updateMany({ where: { storeId: B }, data: { themeId: 'hacked' } })).count).toBe(0);
      expect((await tx.cartItem.deleteMany({ where: { cartId: ids.cartB } })).count).toBe(0);
    });
  });

  it("a cart line cannot point at another store's cart or variant (composite foreign keys)", async () => {
    await expect(
      withTenant(prisma, { storeId: A }, (tx) => tx.cartItem.create({ data: { storeId: A, cartId: ids.cartA, variantId: ids.variantB, quantity: 1 } })),
    ).rejects.toThrow();
    await expect(
      withTenant(prisma, { storeId: A }, (tx) => tx.cartItem.create({ data: { storeId: A, cartId: ids.cartB, variantId: ids.variantA, quantity: 1 } })),
    ).rejects.toThrow();
  });

  it('quantity is bounded by the database', async () => {
    for (const quantity of [0, 100, -1]) {
      await expect(
        withTenant(prisma, { storeId: A }, (tx) => tx.cartItem.updateMany({ where: { cartId: ids.cartA }, data: { quantity } })),
      ).rejects.toThrow();
    }
  });

  it('one settings row per theme per store', async () => {
    await expect(
      withTenant(prisma, { storeId: A }, (tx) => tx.storeTheme.create({ data: { storeId: A, themeId: 'gulf-premium', draft: {} } })),
    ).rejects.toThrow();
  });
});
