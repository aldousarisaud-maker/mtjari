import { OWNER_ROLE_KEY, isPermission, resolveRolePermissions } from '@mtjari/shared';
import type { TenantContext } from '../tenancy/tenancy';

/**
 * Anti-escalation rule: an actor may only grant a role whose permissions are
 * a subset of their own. Only owners can grant the owner role.
 */
export function canGrantRole(actor: Pick<TenantContext, 'isOwner' | 'permissions'>, role: { key: string | null; isSystem?: boolean; permissions: string[] }): boolean {
  if (actor.isOwner) return true;
  if (role.key === OWNER_ROLE_KEY) return false;
  // Custom roles must not carry unknown strings; built-in roles resolve from the template.
  if (!role.isSystem && !role.permissions.every(isPermission)) return false;
  return resolveRolePermissions(role).every((p) => actor.permissions.has(p));
}
