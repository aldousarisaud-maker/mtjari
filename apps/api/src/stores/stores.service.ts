import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isSlugTaken } from '@mtjari/db';
import { SYSTEM_ROLES, checkSlug, normalizeSlug, type CreateStoreInput, type UpdateStoreInput } from "@mtjari/shared";
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/decorators';
import type { TenantContext } from '../tenancy/tenancy';

@Injectable()
export class StoresService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async slugAvailability(raw: string): Promise<{ slug: string; available: boolean; reason?: string }> {
    const slug = normalizeSlug(raw ?? '');
    const check = checkSlug(slug);
    if (!check.ok) return { slug, available: false, reason: check.reason };
    const taken = await isSlugTaken(this.prisma.client, slug);
    return taken ? { slug, available: false, reason: 'taken' } : { slug, available: true };
  }

  /**
   * Creates the tenant and everything it needs to be usable: system roles,
   * the creator's OWNER membership, the default subdomain and an audit entry,
   * all in one transaction under the new store's RLS context.
   */
  async create(user: AuthUser, input: CreateStoreInput, meta: RequestMeta) {
    const owned = await this.prisma.tx({ userId: user.id }, (tx) =>
      tx.membership.count({ where: { userId: user.id, role: { key: SYSTEM_ROLES.OWNER.key }, store: { deletedAt: null } } }),
    );
    if (owned >= this.env.MAX_STORES_PER_USER) throw new ForbiddenException('store_limit_reached');
    if (await isSlugTaken(this.prisma.client, input.slug)) throw new ConflictException('slug_taken');

    const storeId = randomUUID();
    const hostname = `${input.slug}.${this.env.ROOT_DOMAIN}`;
    try {
      return await this.prisma.tx({ storeId, userId: user.id }, async (tx) => {
        const store = await tx.store.create({
          data: {
            id: storeId,
            name: input.name,
            slug: input.slug,
            businessType: input.businessType,
            country: input.country,
            currency: input.currency,
            defaultLocale: input.defaultLocale,
            createdById: user.id,
          },
        });
        const roles = await Promise.all(
          Object.values(SYSTEM_ROLES).map((r) =>
            tx.role.create({ data: { storeId, key: r.key, name: r.name, permissions: [...r.permissions], isSystem: true } }),
          ),
        );
        const ownerRole = roles.find((r) => r.key === SYSTEM_ROLES.OWNER.key)!;
        await tx.membership.create({ data: { storeId, userId: user.id, roleId: ownerRole.id } });
        // Subdomains are served by the platform wildcard certificate.
        await tx.storeDomain.create({ data: { storeId, hostname, type: 'SUBDOMAIN', status: 'ACTIVE', isPrimary: true, verifiedAt: new Date() } });
        await this.audit.record(tx, {
          storeId, actorUserId: user.id, action: 'store.created', entityType: 'store', entityId: storeId,
          metadata: { slug: input.slug, name: input.name }, meta,
        });
        return { ...store, primaryDomain: hostname };
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('slug_taken');
      throw e;
    }
  }

  async get(t: TenantContext) {
    return this.prisma.tx({ storeId: t.storeId, userId: t.userId }, async (tx) => {
      const store = await tx.store.findUniqueOrThrow({
        where: { id: t.storeId },
        include: { domains: { orderBy: { createdAt: 'asc' } } },
      });
      return { ...store, access: { roleId: t.roleId, roleKey: t.roleKey, permissions: [...t.permissions].sort() } };
    });
  }

  async update(t: TenantContext, data: UpdateStoreInput, meta: RequestMeta) {
    return this.prisma.tx({ storeId: t.storeId, userId: t.userId }, async (tx) => {
      const before = await tx.store.findUniqueOrThrow({ where: { id: t.storeId } });
      const store = await tx.store.update({ where: { id: t.storeId }, data });
      const changes = Object.fromEntries(
        Object.keys(data).map((k) => [k, { from: (before as Record<string, unknown>)[k], to: (store as Record<string, unknown>)[k] }]),
      );
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'store.updated', entityType: 'store', entityId: t.storeId, metadata: JSON.parse(JSON.stringify(changes)), meta });
      return store;
    });
  }

  async remove(t: TenantContext, confirmSlug: string | undefined, meta: RequestMeta): Promise<void> {
    if (!t.isOwner) throw new ForbiddenException('owner_only');
    await this.prisma.tx({ storeId: t.storeId, userId: t.userId }, async (tx) => {
      const store = await tx.store.findUniqueOrThrow({ where: { id: t.storeId } });
      if (confirmSlug !== store.slug) throw new BadRequestException('confirmation_mismatch');
      await tx.store.update({ where: { id: t.storeId }, data: { deletedAt: new Date(), status: 'CLOSED' } });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'store.closed', entityType: 'store', entityId: t.storeId, meta });
    });
  }
}
