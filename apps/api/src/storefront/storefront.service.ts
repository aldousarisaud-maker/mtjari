import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TxClient } from '@mtjari/db';
import { DEFAULT_THEME_ID, resolveThemeSettings, type StorefrontProductsQuery } from '@mtjari/shared';
import { PrismaService } from '../common/prisma.service';
import { STORAGE, type StorageDriver } from '../storage/storage';
import type { ShopContext } from './storefront.guard';

// Only what a shopper may see. Cost, thresholds and internal notes are never selected.
const cardSelect = {
  id: true, slug: true, nameAr: true, nameEn: true, type: true, createdAt: true,
  brand: { select: { name: true } },
  variants: { select: { price: true, compareAtPrice: true, trackInventory: true, stockQuantity: true }, orderBy: { position: 'asc' } },
  media: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], take: 2 },
} satisfies Prisma.ProductSelect;
type CardRow = Prisma.ProductGetPayload<{ select: typeof cardSelect }>;
type MediaRow = { id: string; keyBase: string; widths: number[]; width: number; height: number; altAr: string | null; altEn: string | null };

export const variantAvailable = (v: { trackInventory: boolean; stockQuantity: number }) => !v.trackInventory || v.stockQuantity > 0;

@Injectable()
export class StorefrontService {
  constructor(private readonly prisma: PrismaService, @Inject(STORAGE) private readonly storage: StorageDriver) {}

  private tx<T>(shop: ShopContext, fn: (tx: TxClient) => Promise<T>) {
    return this.prisma.tx({ storeId: shop.storeId }, fn);
  }

  image(m: MediaRow) {
    return {
      id: m.id, width: m.width, height: m.height, altAr: m.altAr, altEn: m.altEn,
      urls: Object.fromEntries(m.widths.map((w) => [w, this.storage.publicUrl(`${m.keyBase}-${w}.webp`)])),
    };
  }

  card(p: CardRow) {
    const cheapest = [...p.variants].sort((a, b) => a.price - b.price)[0];
    const prices = p.variants.map((v) => v.price);
    return {
      id: p.id, slug: p.slug, nameAr: p.nameAr, nameEn: p.nameEn, type: p.type, brand: p.brand?.name ?? null,
      images: p.media.map((m) => this.image(m)),
      priceMin: Math.min(...prices), priceMax: Math.max(...prices),
      compareAtPrice: cheapest?.compareAtPrice && cheapest.compareAtPrice > cheapest.price ? cheapest.compareAtPrice : null,
      inStock: p.variants.some(variantAvailable),
      variantCount: p.variants.length,
    };
  }

  /** Store identity, the theme to render and the navigation categories. */
  async store(shop: ShopContext) {
    return this.tx(shop, async (tx) => {
      const themeId = shop.previewThemeId ?? shop.store.themeId ?? DEFAULT_THEME_ID;
      const [row, categories, counts] = await Promise.all([
        tx.storeTheme.findUnique({ where: { storeId_themeId: { storeId: shop.storeId, themeId } } }),
        tx.category.findMany({
          where: { storeId: shop.storeId, isActive: true },
          select: { id: true, parentId: true, slug: true, nameAr: true, nameEn: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        tx.productCategory.groupBy({
          by: ['categoryId'], where: { storeId: shop.storeId, product: { status: 'ACTIVE', deletedAt: null } }, _count: { _all: true },
        }),
      ]);
      const countOf = new Map(counts.map((c) => [c.categoryId, c._count._all]));
      // Shoppers get published settings; a previewing member gets the draft.
      const stored = shop.previewThemeId ? row?.draft : row?.published;
      const { id, name, slug, currency, country, defaultLocale } = shop.store;
      return {
        id, name, slug, currency, country, defaultLocale, host: shop.host,
        preview: !!shop.previewThemeId,
        theme: { id: themeId, settings: resolveThemeSettings(themeId, stored) },
        categories: categories.map((c) => ({ ...c, productCount: countOf.get(c.id) ?? 0 })),
      };
    });
  }

  /** A category and all of its descendants, by slug. */
  private async categoryIds(tx: TxClient, storeId: string, slug: string): Promise<string[] | null> {
    const all = await tx.category.findMany({ where: { storeId, isActive: true }, select: { id: true, parentId: true, slug: true } });
    const root = all.find((c) => c.slug === slug);
    if (!root) return null;
    const ids = [root.id];
    for (let i = 0; i < ids.length; i++) for (const c of all) if (c.parentId === ids[i] && !ids.includes(c.id)) ids.push(c.id);
    return ids;
  }

  async products(shop: ShopContext, q: StorefrontProductsQuery) {
    return this.tx(shop, async (tx) => {
      const categoryIds = q.category ? await this.categoryIds(tx, shop.storeId, q.category) : undefined;
      if (categoryIds === null) throw new NotFoundException('category_not_found');
      // % and _ typed by a shopper are searched literally, not as wildcards.
      const like = (q.q ?? '').replace(/[\\%_]/g, '\\$&');
      const where: Prisma.ProductWhereInput = {
        storeId: shop.storeId, status: 'ACTIVE', deletedAt: null,
        ...(categoryIds ? { categories: { some: { categoryId: { in: categoryIds } } } } : {}),
        ...(q.q ? { OR: [{ nameAr: { contains: like, mode: 'insensitive' } }, { nameEn: { contains: like, mode: 'insensitive' } }, { tags: { has: q.q } }] } : {}),
      };
      const skip = (q.page - 1) * q.limit;
      const total = await tx.product.count({ where });
      let rows: CardRow[];
      if (q.sort === 'newest') {
        rows = await tx.product.findMany({ where, select: cardSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take: q.limit });
      } else {
        // Price order needs the cheapest variant of each product, which Prisma can't sort by.
        const conds: Prisma.Sql[] = [Prisma.sql`p.store_id = ${shop.storeId}::uuid`, Prisma.sql`p.status = 'ACTIVE'`, Prisma.sql`p.deleted_at IS NULL`];
        if (categoryIds) conds.push(Prisma.sql`EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = ANY(${categoryIds}::uuid[]))`);
        if (q.q) {
          const pattern = `%${like}%`;
          conds.push(Prisma.sql`(p.name_ar ILIKE ${pattern} OR p.name_en ILIKE ${pattern} OR ${q.q} = ANY(p.tags))`);
        }
        const dir = q.sort === 'price_asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
        const ids = await tx.$queryRaw<{ id: string }[]>`
          SELECT p.id FROM products p
          WHERE ${Prisma.join(conds, ' AND ')}
          ORDER BY (SELECT min(v.price) FROM product_variants v WHERE v.product_id = p.id) ${dir} NULLS LAST, p.id
          LIMIT ${q.limit} OFFSET ${skip}`;
        const found = await tx.product.findMany({ where: { storeId: shop.storeId, id: { in: ids.map((r) => r.id) } }, select: cardSelect });
        const byId = new Map(found.map((p) => [p.id, p]));
        rows = ids.map((r) => byId.get(r.id)).filter((p): p is CardRow => !!p);
      }
      return { total, page: q.page, limit: q.limit, items: rows.filter((p) => p.variants.length).map((p) => this.card(p)) };
    });
  }

  async product(shop: ShopContext, slug: string) {
    return this.tx(shop, async (tx) => {
      const p = await tx.product.findFirst({
        where: { storeId: shop.storeId, slug, status: 'ACTIVE', deletedAt: null },
        select: {
          id: true, slug: true, type: true, nameAr: true, nameEn: true, descriptionAr: true, descriptionEn: true, tags: true,
          seoTitle: true, seoDescription: true, updatedAt: true,
          brand: { select: { name: true } },
          options: { select: { name: true, values: true }, orderBy: { position: 'asc' } },
          variants: {
            select: { id: true, sku: true, optionValues: true, price: true, compareAtPrice: true, trackInventory: true, stockQuantity: true },
            orderBy: { position: 'asc' },
          },
          media: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
          categories: { select: { category: { select: { id: true, slug: true, nameAr: true, nameEn: true, isActive: true } } } },
          relations: { where: { type: 'RELATED' }, select: { relatedProductId: true }, orderBy: { position: 'asc' } },
        },
      });
      if (!p || !p.variants.length) throw new NotFoundException('product_not_found');

      // Related: the merchant's own picks first, then other products from the same categories.
      const picked = p.relations.map((r) => r.relatedProductId);
      const categoryIds = p.categories.map((c) => c.category.id);
      const [explicit, sameCategory] = await Promise.all([
        picked.length ? tx.product.findMany({ where: { storeId: shop.storeId, id: { in: picked }, status: 'ACTIVE', deletedAt: null }, select: cardSelect }) : [],
        categoryIds.length
          ? tx.product.findMany({
              where: { storeId: shop.storeId, status: 'ACTIVE', deletedAt: null, id: { notIn: [p.id, ...picked] }, categories: { some: { categoryId: { in: categoryIds } } } },
              select: cardSelect, orderBy: { createdAt: 'desc' }, take: 4,
            })
          : [],
      ]);
      const related = [...picked.map((id) => explicit.find((x) => x.id === id)).filter((x): x is CardRow => !!x), ...sameCategory]
        .filter((x) => x.variants.length).slice(0, 4);

      return {
        id: p.id, slug: p.slug, type: p.type, nameAr: p.nameAr, nameEn: p.nameEn, descriptionAr: p.descriptionAr, descriptionEn: p.descriptionEn,
        tags: p.tags, seoTitle: p.seoTitle, seoDescription: p.seoDescription, updatedAt: p.updatedAt, brand: p.brand?.name ?? null,
        options: p.options,
        variants: p.variants.map((v) => ({
          id: v.id, sku: v.sku, optionValues: v.optionValues, price: v.price,
          compareAtPrice: v.compareAtPrice && v.compareAtPrice > v.price ? v.compareAtPrice : null,
          available: variantAvailable(v),
          // Enough to cap the quantity picker without publishing exact stock levels.
          maxQuantity: v.trackInventory ? Math.min(v.stockQuantity, 10) : 10,
        })),
        images: p.media.map((m) => this.image(m)),
        categories: p.categories.map((c) => c.category).filter((c) => c.isActive).map(({ isActive: _a, ...c }) => c),
        related: related.map((r) => this.card(r)),
      };
    });
  }

  /** URLs for sitemap.xml: published products and active categories only. */
  async sitemap(shop: ShopContext) {
    return this.tx(shop, async (tx) => {
      const [products, categories] = await Promise.all([
        tx.product.findMany({
          where: { storeId: shop.storeId, status: 'ACTIVE', deletedAt: null }, select: { slug: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' }, take: 5000,
        }),
        tx.category.findMany({ where: { storeId: shop.storeId, isActive: true }, select: { slug: true, updatedAt: true } }),
      ]);
      return { products, categories };
    });
  }
}
