import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TxClient } from '@mtjari/db';
import { isPermission, resolveRolePermissions } from '@mtjari/shared';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from '../common/request-meta';
import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../tenancy/tenancy';
import { canGrantRole } from '../members/rbac-rules';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private tx<T>(t: TenantContext, fn: (tx: TxClient) => Promise<T>) {
    return this.prisma.tx({ storeId: t.storeId, userId: t.userId }, fn);
  }

  private validate(t: TenantContext, permissions: string[]): string[] {
    const unique = [...new Set(permissions)];
    const unknown = unique.filter((p) => !isPermission(p));
    if (unknown.length) throw new BadRequestException({ statusCode: 400, error: 'validation_failed', message: 'unknown_permissions', unknown });
    if (!canGrantRole(t, { key: null, permissions: unique })) throw new ForbiddenException('role_escalation_denied');
    return unique.sort();
  }

  list(t: TenantContext) {
    return this.tx(t, async (tx) => {
      const roles = await tx.role.findMany({ where: { storeId: t.storeId }, include: { _count: { select: { memberships: true } } }, orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }] });
      return roles.map(({ _count, ...r }) => ({ ...r, permissions: resolveRolePermissions(r), memberCount: _count.memberships }));
    });
  }

  create(t: TenantContext, name: string, permissions: string[], meta: RequestMeta) {
    const perms = this.validate(t, permissions);
    return this.tx(t, async (tx) => {
      const role = await tx.role.create({ data: { storeId: t.storeId, name, permissions: perms } });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'role.created', entityType: 'role', entityId: role.id, metadata: { name, permissions: perms }, meta });
      return role;
    });
  }

  update(t: TenantContext, roleId: string, name: string, permissions: string[], meta: RequestMeta) {
    const perms = this.validate(t, permissions);
    return this.tx(t, async (tx) => {
      const role = await tx.role.findFirst({ where: { id: roleId, storeId: t.storeId } });
      if (!role) throw new NotFoundException('role_not_found');
      if (role.isSystem) throw new ForbiddenException('system_role_immutable');
      if (!canGrantRole(t, role)) throw new ForbiddenException('role_escalation_denied');
      const updated = await tx.role.update({ where: { id: role.id }, data: { name, permissions: perms } });
      await this.audit.record(tx, {
        storeId: t.storeId, actorUserId: t.userId, action: 'role.updated', entityType: 'role', entityId: role.id,
        metadata: { from: { name: role.name, permissions: role.permissions }, to: { name, permissions: perms } }, meta,
      });
      return updated;
    });
  }

  remove(t: TenantContext, roleId: string, meta: RequestMeta) {
    return this.tx(t, async (tx) => {
      const role = await tx.role.findFirst({ where: { id: roleId, storeId: t.storeId }, include: { _count: { select: { memberships: true } } } });
      if (!role) throw new NotFoundException('role_not_found');
      if (role.isSystem) throw new ForbiddenException('system_role_immutable');
      if (role._count.memberships > 0) throw new ConflictException('role_in_use');
      await tx.role.delete({ where: { id: role.id } });
      await this.audit.record(tx, { storeId: t.storeId, actorUserId: t.userId, action: 'role.deleted', entityType: 'role', entityId: role.id, metadata: { name: role.name }, meta });
    });
  }
}
