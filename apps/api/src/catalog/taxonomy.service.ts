import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TxClient } from '@mtjari/db';
import type { BrandInput, CategoryCreateInput, CategoryUpdateInput } from '@mtjari/shared';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';
import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../tenancy/tenancy';
import { isUniqueViolation, resolveSlug } from './helpers';

const MAX_DEPTH = 4;

/** Categories (tree) and brands. */
@Injectable()
export class TaxonomyService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private tx<T>(t: TenantContext, fn: (tx: TxClient) => Promise<T>) {
    return this.prisma.tx({ storeId: t.storeId, userId: t.userId }, fn);
  }

  // ---- categories -------------------------------------------------------

  listCategories(t: TenantContext) {
    return this.tx(t, async (tx) => {
      const rows = await tx.category.findMany({
        where: { storeId: t.storeId },
        include: { _count: { select: { products: true } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      return rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
    });
  }

  /** Walks up from `parentId`; rejects unknown parents, cycles and trees deeper than MAX_DEPTH. */
  private async checkParent(tx: TxClient, storeId: string, parentId: string | null | undefined, selfId?: string): Promise<void> {
    let cursor = parentId ?? null;
    let depth = 1;
    while (cursor) {
      if (cursor === selfId) throw new BadRequestException('category_cycle');
      const parent: { parentId: string | null } | null = await tx.category.findFirst({ where: { id: cursor, storeId }, select: { parentId: true } });
      if (!parent) throw new BadRequestException('parent_not_found');
      cursor = parent.parentId;
      if (++depth > MAX_DEPTH) throw new BadRequestException('category_too_deep');
    }
  }

  createCategory(t: TenantContext, input: CategoryCreateInput, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      await this.checkParent(tx, t.storeId, input.parentId);
      const slug = await resolveSlug(
        async (s) => !!(await tx.category.findFirst({ where: { storeId: t.storeId, slug: s }, select: { id: true } })),
        input.slug, input.nameEn, input.nameAr,
      );
      const category = await tx.category.create({ data: { ...input, parentId: input.parentId ?? null, slug, storeId: t.storeId } });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'category.created', entityType: 'category', entityId: category.id, metadata: { slug }, meta });
      return category;
    });
  }

  updateCategory(t: TenantContext, id: string, input: CategoryUpdateInput, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const current = await tx.category.findFirst({ where: { id, storeId: t.storeId } });
      if (!current) throw new NotFoundException('category_not_found');
      if (input.parentId !== undefined) await this.checkParent(tx, t.storeId, input.parentId, id);
      const nameAr = input.nameAr === undefined ? current.nameAr : input.nameAr;
      const nameEn = input.nameEn === undefined ? current.nameEn : input.nameEn;
      if (!nameAr && !nameEn) throw new BadRequestException('name_required');
      if (input.slug && input.slug !== current.slug) {
        const taken = await tx.category.findFirst({ where: { storeId: t.storeId, slug: input.slug, NOT: { id } }, select: { id: true } });
        if (taken) throw new ConflictException('slug_taken');
      }
      const category = await tx.category.update({ where: { id }, data: input });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'category.updated', entityType: 'category', entityId: id, metadata: { fields: Object.keys(input) }, meta });
      return category;
    });
  }

  deleteCategory(t: TenantContext, id: string, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const current = await tx.category.findFirst({ where: { id, storeId: t.storeId }, include: { _count: { select: { children: true } } } });
      if (!current) throw new NotFoundException('category_not_found');
      if (current._count.children > 0) throw new ConflictException('category_has_children');
      await tx.category.delete({ where: { id } }); // product links cascade; products stay
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'category.deleted', entityType: 'category', entityId: id, metadata: { slug: current.slug }, meta });
    });
  }

  // ---- brands -----------------------------------------------------------

  listBrands(t: TenantContext) {
    return this.tx(t, async (tx) => {
      const rows = await tx.brand.findMany({ where: { storeId: t.storeId }, include: { _count: { select: { products: { where: { deletedAt: null } } } } }, orderBy: { name: 'asc' } });
      return rows.map(({ _count, ...b }) => ({ ...b, productCount: _count.products }));
    });
  }

  createBrand(t: TenantContext, input: BrandInput, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const slug = await resolveSlug(
        async (s) => !!(await tx.brand.findFirst({ where: { storeId: t.storeId, slug: s }, select: { id: true } })),
        input.slug, input.name,
      );
      const brand = await tx.brand.create({ data: { storeId: t.storeId, name: input.name, slug } });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'brand.created', entityType: 'brand', entityId: brand.id, metadata: { name: brand.name }, meta });
      return brand;
    });
  }

  updateBrand(t: TenantContext, id: string, input: BrandInput, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const current = await tx.brand.findFirst({ where: { id, storeId: t.storeId } });
      if (!current) throw new NotFoundException('brand_not_found');
      try {
        const brand = await tx.brand.update({ where: { id }, data: { name: input.name, ...(input.slug ? { slug: input.slug } : {}) } });
        await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'brand.updated', entityType: 'brand', entityId: id, metadata: { from: current.name, to: brand.name }, meta });
        return brand;
      } catch (e) {
        if (isUniqueViolation(e)) throw new ConflictException('slug_taken');
        throw e;
      }
    });
  }

  deleteBrand(t: TenantContext, id: string, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const r = await tx.brand.deleteMany({ where: { id, storeId: t.storeId } }); // products keep existing, brand_id → NULL
      if (r.count !== 1) throw new NotFoundException('brand_not_found');
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'brand.deleted', entityType: 'brand', entityId: id, meta });
    });
  }
}
