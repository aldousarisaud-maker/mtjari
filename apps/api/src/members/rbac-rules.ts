import { OWNER_ROLE_KEY, isPermission, type Permission } from '@mtjari/shared';
import type { TenantContext } from '../tenancy/tenancy';

/**
 * Anti-escalation rule: an actor may only grant a role whose permissions are
 * a subset of their own. Only owners can grant the owner role.
 */
export function canGrantRole(actor: Pick<TenantContext, 'isOwner' | 'permissions'>, role: { key: string | null; permissions: string[] }): boolean {
  if (actor.isOwner) return true;
  if (role.key === OWNER_ROLE_KEY) return false;
  return role.permissions.every((p) => isPermission(p) && actor.permissions.has(p as Permission));
}
