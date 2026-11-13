import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma, TxClient } from '@mtjari/db';
import {
  validateVariantMatrix,
  type ProductCreateInput, type ProductListQuery, type ProductUpdateInput, type VariantInput, type VariantsReplaceInput,
} from '@mtjari/shared';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';
import { AuditService } from '../audit/audit.service';
import { STORAGE, type StorageDriver } from '../storage/storage';
import type { TenantContext } from '../tenancy/tenancy';
import { isUniqueViolation, resolveSlug } from './helpers';

const fullInclude = {
  brand: { select: { id: true, name: true, slug: true } },
  options: { orderBy: { position: 'asc' } },
  variants: { orderBy: { position: 'asc' } },
  media: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
  categories: { select: { category: { select: { id: true, nameAr: true, nameEn: true, slug: true } } } },
  relations: { select: { type: true, position: true, related: { select: { id: true, nameAr: true, nameEn: true, slug: true } } }, orderBy: { position: 'asc' } },
} satisfies Prisma.ProductInclude;

type FullProduct = Prisma.ProductGetPayload<{ include: typeof fullInclude }>;
type MediaRow = { id: string; keyBase: string; widths: number[]; width: number; height: number; altAr: string | null; altEn: string | null; position: number };

export const mediaKeys = (m: { keyBase: string; widths: number[] }) => m.widths.map((w) => `${m.keyBase}-${w}.webp`);

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  private tx<T>(t: TenantContext, fn: (tx: TxClient) => Promise<T>) {
    return this.prisma.tx({ storeId: t.storeId, userId: t.userId }, fn);
  }

  presentMedia(m: MediaRow) {
    return {
      id: m.id, width: m.width, height: m.height, altAr: m.altAr, altEn: m.altEn, position: m.position,
      urls: Object.fromEntries(m.widths.map((w) => [w, this.storage.publicUrl(`${m.keyBase}-${w}.webp`)])),
    };
  }

  private present(p: FullProduct) {
    const { categories, relations, media, ...rest } = p;
    return {
      ...rest,
      media: media.map((m) => this.presentMedia(m)),
      categories: categories.map((c) => c.category),
      relations: relations.map((r) => ({ type: r.type, ...r.related })),
    };
  }

  private async assertRefs(tx: TxClient, storeId: string, brandId: string | null | undefined, categoryIds: string[] | undefined) {
    if (brandId) {
      const brand = await tx.brand.findFirst({ where: { id: brandId, storeId }, select: { id: true } });
      if (!brand) throw new BadRequestException('brand_not_found');
    }
    if (categoryIds?.length) {
      const found = await tx.category.count({ where: { storeId, id: { in: categoryIds } } });
      if (found !== new Set(categoryIds).size) throw new BadRequestException('category_not_found');
    }
  }

  private async createVariant(tx: TxClient, t: TenantContext, productId: string, digital: boolean, v: VariantInput, position: number) {
    const track = digital ? false : v.trackInventory;
    const stock = track ? v.initialStock : 0;
    const variant = await tx.productVariant.create({
      data: {
        storeId: t.storeId, productId, position,
        sku: v.sku, barcode: v.barcode, optionValues: v.optionValues, price: v.price,
        compareAtPrice: v.compareAtPrice ?? null, cost: v.cost ?? null,
        trackInventory: track, lowStockThreshold: track ? (v.lowStockThreshold ?? null) : null, stockQuantity: stock,
      },
    });
    if (stock > 0) {
      await tx.inventoryMovement.create({ data: { storeId: t.storeId, variantId: variant.id, delta: stock, quantityAfter: stock, reason: 'INITIAL', actorUserId: t.userId } });
    }
    return variant;
  }

  /** Creates a product inside an existing tenant transaction (also used by the CSV import). */
  async createInTx(tx: TxClient, t: TenantContext, input: ProductCreateInput, meta?: RequestMeta): Promise<string> {
    const problem = validateVariantMatrix(input.type, input.options, input.variants);
    if (problem) throw new BadRequestException(problem);
    await this.assertRefs(tx, t.storeId, input.brandId, input.categoryIds);
    const slug = await resolveSlug(
      async (s) => !!(await tx.product.findFirst({ where: { storeId: t.storeId, slug: s }, select: { id: true } })),
      input.slug, input.nameEn, input.nameAr,
    );
    const product = await tx.product.create({
      data: {
        storeId: t.storeId, type: input.type, status: input.status, nameAr: input.nameAr, nameEn: input.nameEn, slug,
        descriptionAr: input.descriptionAr, descriptionEn: input.descriptionEn, brandId: input.brandId ?? null,
        tags: input.tags, seoTitle: input.seoTitle, seoDescription: input.seoDescription,
      },
    });
    if (input.options.length) {
      await tx.productOption.createMany({ data: input.options.map((o, i) => ({ storeId: t.storeId, productId: product.id, name: o.name, values: o.values, position: i })) });
    }
    for (const [i, v] of input.variants.entries()) await this.createVariant(tx, t, product.id, input.type === 'DIGITAL', v, i);
    if (input.categoryIds.length) {
      await tx.productCategory.createMany({ data: [...new Set(input.categoryIds)].map((categoryId) => ({ storeId: t.storeId, productId: product.id, categoryId })) });
    }
    await this.audit.record(tx, {
      storeId: t.storeId, actorUserId: t.userId, action: 'product.created', entityType: 'product', entityId: product.id,
      metadata: { slug, type: input.type, variants: input.variants.length }, meta,
    });
    return product.id;
  }

  async create(t: TenantContext, input: ProductCreateInput, meta: RequestMeta) {
    try {
      const id = await this.tx(t, (tx) => this.createInTx(tx, t, input, meta));
      return this.get(t, id);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('sku_taken');
      throw e;
    }
  }

  async get(t: TenantContext, id: string) {
    const product = await this.tx(t, (tx) => tx.product.findFirst({ where: { id, storeId: t.storeId, deletedAt: null }, include: fullInclude }));
    if (!product) throw new NotFoundException('product_not_found');
    return this.present(product);
  }

  async list(t: TenantContext, q: ProductListQuery) {
    const where: Prisma.ProductWhereInput = {
      storeId: t.storeId, deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.brandId ? { brandId: q.brandId } : {}),
      ...(q.categoryId ? { categories: { some: { categoryId: q.categoryId } } } : {}),
      ...(q.q
        ? { OR: [
            { nameAr: { contains: q.q, mode: 'insensitive' } },
            { nameEn: { contains: q.q, mode: 'insensitive' } },
            { variants: { some: { OR: [{ sku: { contains: q.q, mode: 'insensitive' } }, { barcode: q.q }] } } },
          ] }
        : {}),
    };
    const [total, rows] = await this.tx(t, (tx) => Promise.all([
      tx.product.count({ where }),
      tx.product.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.limit, take: q.limit,
        include: {
          brand: { select: { name: true } },
          variants: { select: { price: true, stockQuantity: true, trackInventory: true, lowStockThreshold: true } },
          media: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], take: 1 },
        },
      }),
    ]));
    return {
      total, page: q.page, limit: q.limit,
      items: rows.map((p) => {
        const prices = p.variants.map((v) => v.price);
        const tracked = p.variants.filter((v) => v.trackInventory);
        return {
          id: p.id, nameAr: p.nameAr, nameEn: p.nameEn, slug: p.slug, type: p.type, status: p.status, brand: p.brand?.name ?? null,
          image: p.media[0] ? this.presentMedia(p.media[0]) : null,
          priceMin: Math.min(...prices), priceMax: Math.max(...prices), variantCount: p.variants.length,
          stock: tracked.length ? tracked.reduce((n, v) => n + v.stockQuantity, 0) : null,
          lowStock: tracked.some((v) => v.lowStockThreshold != null && v.stockQuantity <= v.lowStockThreshold),
          createdAt: p.createdAt,
        };
      }),
    };
  }

  async update(t: TenantContext, id: string, input: ProductUpdateInput, meta: RequestMeta) {
    await this.tx(t, async (tx) => {
      const current = await tx.product.findFirst({ where: { id, storeId: t.storeId, deletedAt: null } });
      if (!current) throw new NotFoundException('product_not_found');
      const nameAr = input.nameAr === undefined ? current.nameAr : input.nameAr;
      const nameEn = input.nameEn === undefined ? current.nameEn : input.nameEn;
      if (!nameAr && !nameEn) throw new BadRequestException('name_required');
      await this.assertRefs(tx, t.storeId, input.brandId, input.categoryIds);
      if (input.slug && input.slug !== current.slug) {
        const taken = await tx.product.findFirst({ where: { storeId: t.storeId, slug: input.slug, NOT: { id } }, select: { id: true } });
        if (taken) throw new ConflictException('slug_taken');
      }
      const { categoryIds, ...fields } = input;
      await tx.product.update({ where: { id }, data: fields });
      if (categoryIds) {
        await tx.productCategory.deleteMany({ where: { productId: id } });
        if (categoryIds.length) {
          await tx.productCategory.createMany({ data: [...new Set(categoryIds)].map((categoryId) => ({ storeId: t.storeId, productId: id, categoryId })) });
        }
      }
      await this.audit.record(tx, {
        storeId: t.storeId, actorUserId: t.userId, action: input.status && input.status !== current.status ? 'product.status_changed' : 'product.updated',
        entityType: 'product', entityId: id,
        metadata: { fields: Object.keys(input), ...(input.status && input.status !== current.status ? { from: current.status, to: input.status } : {}) }, meta,
      });
    });
    return this.get(t, id);
  }

  /**
   * Replaces the option/variant set. Variants sent with an id are updated
   * (stock is untouched: it only changes through inventory adjustments),
   * variants without an id are created, variants left out are removed.
   */
  async replaceVariants(t: TenantContext, id: string, input: VariantsReplaceInput, meta: RequestMeta) {
    try {
      await this.tx(t, async (tx) => {
        const product = await tx.product.findFirst({ where: { id, storeId: t.storeId, deletedAt: null }, include: { variants: { select: { id: true } } } });
        if (!product) throw new NotFoundException('product_not_found');
        const problem = validateVariantMatrix(product.type, input.options, input.variants);
        if (problem) throw new BadRequestException(problem);
        const existing = new Set(product.variants.map((v) => v.id));
        const keep = new Set(input.variants.map((v) => v.id).filter((x): x is string => !!x));
        if (keep.size !== input.variants.filter((v) => v.id).length) throw new BadRequestException('duplicate_variant');
        for (const vid of keep) if (!existing.has(vid)) throw new BadRequestException('variant_not_found');

        const removed = [...existing].filter((vid) => !keep.has(vid));
        if (removed.length) await tx.productVariant.deleteMany({ where: { productId: id, id: { in: removed } } });
        // Clear SKUs first so two variants can swap SKUs in one request.
        await tx.productVariant.updateMany({ where: { productId: id }, data: { sku: null } });

        await tx.productOption.deleteMany({ where: { productId: id } });
        if (input.options.length) {
          await tx.productOption.createMany({ data: input.options.map((o, i) => ({ storeId: t.storeId, productId: id, name: o.name, values: o.values, position: i })) });
        }
        const digital = product.type === 'DIGITAL';
        for (const [i, v] of input.variants.entries()) {
          if (v.id) {
            const track = digital ? false : v.trackInventory;
            await tx.productVariant.update({
              where: { id: v.id },
              data: {
                position: i, sku: v.sku, barcode: v.barcode, optionValues: v.optionValues, price: v.price,
                compareAtPrice: v.compareAtPrice ?? null, cost: v.cost ?? null, trackInventory: track,
                lowStockThreshold: track ? (v.lowStockThreshold ?? null) : null,
              },
            });
          } else {
            await this.createVariant(tx, t, id, digital, v, i);
          }
        }
        await this.audit.record(tx, {
          storeId: t.storeId, actorUserId: t.userId, action: 'product.variants_updated', entityType: 'product', entityId: id,
          metadata: { kept: keep.size, created: input.variants.length - keep.size, removed: removed.length }, meta,
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('sku_taken');
      throw e;
    }
    return this.get(t, id);
  }

  /** Soft delete: hidden everywhere, slug and SKUs released for reuse. */
  async remove(t: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    await this.tx(t, async (tx) => {
      const current = await tx.product.findFirst({ where: { id, storeId: t.storeId, deletedAt: null } });
      if (!current) throw new NotFoundException('product_not_found');
      await tx.product.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'ARCHIVED', slug: `${current.slug}--deleted-${randomBytes(4).toString('hex')}` },
      });
      await tx.productVariant.updateMany({ where: { productId: id }, data: { sku: null } });
      await tx.productRelation.deleteMany({ where: { OR: [{ productId: id }, { relatedProductId: id }] } });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'product.deleted', entityType: 'product', entityId: id, metadata: { slug: current.slug }, meta });
    });
  }

  async setRelations(t: TenantContext, id: string, type: 'RELATED' | 'UPSELL' | 'CROSS_SELL', productIds: string[], meta: RequestMeta) {
    await this.tx(t, async (tx) => {
      const product = await tx.product.findFirst({ where: { id, storeId: t.storeId, deletedAt: null }, select: { id: true } });
      if (!product) throw new NotFoundException('product_not_found');
      if (productIds.includes(id)) throw new BadRequestException('cannot_relate_to_self');
      const found = await tx.product.count({ where: { storeId: t.storeId, deletedAt: null, id: { in: productIds } } });
      if (found !== productIds.length) throw new BadRequestException('related_product_not_found');
      await tx.productRelation.deleteMany({ where: { productId: id, type } });
      if (productIds.length) {
        await tx.productRelation.createMany({ data: productIds.map((relatedProductId, position) => ({ storeId: t.storeId, productId: id, relatedProductId, type, position })) });
      }
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'product.relations_updated', entityType: 'product', entityId: id, metadata: { type, count: productIds.length }, meta });
    });
    return this.get(t, id);
  }

  async summary(t: TenantContext) {
    return this.tx(t, async (tx) => {
      const live = { storeId: t.storeId, deletedAt: null };
      const [products, active, draft, categories, brands, lowStock, outOfStock] = await Promise.all([
        tx.product.count({ where: live }),
        tx.product.count({ where: { ...live, status: 'ACTIVE' } }),
        tx.product.count({ where: { ...live, status: 'DRAFT' } }),
        tx.category.count({ where: { storeId: t.storeId } }),
        tx.brand.count({ where: { storeId: t.storeId } }),
        tx.productVariant.count({ where: { storeId: t.storeId, trackInventory: true, product: { deletedAt: null }, lowStockThreshold: { not: null }, stockQuantity: { lte: tx.productVariant.fields.lowStockThreshold } } }),
        tx.productVariant.count({ where: { storeId: t.storeId, trackInventory: true, product: { deletedAt: null }, stockQuantity: 0 } }),
      ]);
      return { products, active, draft, categories, brands, lowStock, outOfStock };
    });
  }
}
