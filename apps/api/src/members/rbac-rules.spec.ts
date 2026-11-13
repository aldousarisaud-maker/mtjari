import { canGrantRole } from './rbac-rules';

const actor = (perms: string[], isOwner = false) => ({ isOwner, permissions: new Set(perms) as never });

describe('canGrantRole', () => {
  it('owners can grant anything, including owner', () => {
    expect(canGrantRole(actor([], true), { key: 'owner', isSystem: true, permissions: [] })).toBe(true);
  });
  it('non-owners can never grant owner', () => {
    expect(canGrantRole(actor(['store:read', 'members:invite']), { key: 'owner', isSystem: true, permissions: [] })).toBe(false);
  });
  it('non-owners can grant only subsets of their own permissions', () => {
    const a = actor(['store:read', 'products:read', 'members:invite']);
    expect(canGrantRole(a, { key: null, permissions: ['store:read', 'products:read'] })).toBe(true);
    expect(canGrantRole(a, { key: null, permissions: ['store:read', 'billing:manage'] })).toBe(false);
  });
  it('rejects unknown permission strings', () => {
    expect(canGrantRole(actor(['store:read']), { key: null, permissions: ['store:read', 'bogus'] })).toBe(false);
  });
});
