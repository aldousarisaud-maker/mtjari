import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, SetMetadata, createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OWNER_ROLE_KEY, resolveRolePermissions, type Permission } from '@mtjari/shared';
import { PrismaService } from '../common/prisma.service';
import type { AuthedRequest } from '../auth/decorators';

export interface TenantContext {
  storeId: string;
  userId: string;
  membershipId: string;
  roleId: string;
  roleKey: string | null;
  isOwner: boolean;
  permissions: ReadonlySet<Permission>;
}

type TenantRequest = AuthedRequest & { tenant?: TenantContext };

const PERMS = 'mtjari:permissions';
/** Declare the permission(s) a store-scoped route needs. All must be held. */
export const RequirePermission = (...perms: Permission[]) => SetMetadata(PERMS, perms);

export const Tenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext => {
  const t = ctx.switchToHttp().getRequest<TenantRequest>().tenant;
  if (!t) throw new Error('Tenant used without StoreAccessGuard');
  return t;
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function effectivePermissions(role: { key: string | null; isSystem?: boolean; permissions: string[] }): Set<Permission> {
  return new Set(resolveRolePermissions(role));
}

/**
 * Resolves the tenant from the :storeId route param and checks that the
 * authenticated user is an active member holding the required permissions.
 * Non-members get 404 (not 403) so store ids can't be probed.
 */
@Injectable()
export class StoreAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    const user = req.user;
    const storeId = req.params['storeId'];
    if (!user) throw new ForbiddenException();
    if (typeof storeId !== 'string' || !UUID_RE.test(storeId)) throw new NotFoundException('store_not_found');

    const membership = await this.prisma.tx({ storeId, userId: user.id }, (tx) =>
      tx.membership.findFirst({
        where: { storeId, userId: user.id, status: 'ACTIVE', store: { deletedAt: null } },
        include: { role: true },
      }),
    );
    if (!membership) throw new NotFoundException('store_not_found');

    const permissions = effectivePermissions(membership.role);
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMS, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const missing = required.filter((p) => !permissions.has(p));
    if (missing.length) throw new ForbiddenException({ statusCode: 403, error: 'forbidden', message: 'missing_permission', missing });

    req.tenant = {
      storeId,
      userId: user.id,
      membershipId: membership.id,
      roleId: membership.roleId,
      roleKey: membership.role.key,
      isOwner: membership.role.key === OWNER_ROLE_KEY,
      permissions,
    };
    return true;
  }
}
