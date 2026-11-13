/**
 * Store-level permissions. Every protected merchant API route declares the
 * permission it needs; roles are just named bundles of these strings.
 *
 * Add new permissions here (never rename existing ones: they are persisted
 * in custom roles). Phase 2+ modules append their own entries.
 */
export const PERMISSIONS = {
  STORE_READ: 'store:read',
  STORE_UPDATE: 'store:update',
  STORE_DELETE: 'store:delete',

  MEMBERS_READ: 'members:read',
  MEMBERS_INVITE: 'members:invite',
  MEMBERS_UPDATE: 'members:update',
  MEMBERS_REMOVE: 'members:remove',

  ROLES_READ: 'roles:read',
  ROLES_MANAGE: 'roles:manage',

  AUDIT_READ: 'audit:read',

  DOMAINS_READ: 'domains:read',
  DOMAINS_MANAGE: 'domains:manage',

  // Catalogue (products, categories, brands, media, import/export).
  PRODUCTS_READ: 'products:read',
  PRODUCTS_WRITE: 'products:write',
  INVENTORY_READ: 'inventory:read',
  INVENTORY_WRITE: 'inventory:write',

  // Reserved for later phases (declared now so roles are stable).
  ORDERS_READ: 'orders:read',
  ORDERS_WRITE: 'orders:write',
  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_WRITE: 'customers:write',
  PAYMENTS_MANAGE: 'payments:manage',
  THEMES_MANAGE: 'themes:manage',
  MARKETING_MANAGE: 'marketing:manage',
  SEO_MANAGE: 'seo:manage',
  REPORTS_READ: 'reports:read',
  BILLING_MANAGE: 'billing:manage',
  SETTINGS_MANAGE: 'settings:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(
  Object.values(PERMISSIONS),
);

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

const P = PERMISSIONS;

/**
 * Built-in role templates copied into every new store. The OWNER role is
 * special: it always has every permission (including ones added later) and
 * cannot be edited or deleted.
 */
export const SYSTEM_ROLES = {
  OWNER: {
    key: 'owner',
    name: 'Owner',
    nameAr: 'المالك',
    permissions: ALL_PERMISSIONS,
  },
  ADMIN: {
    key: 'admin',
    name: 'Administrator',
    nameAr: 'مدير',
    permissions: ALL_PERMISSIONS.filter(
      (p) => p !== P.STORE_DELETE && p !== P.BILLING_MANAGE,
    ),
  },
  MANAGER: {
    key: 'manager',
    name: 'Store manager',
    nameAr: 'مدير المتجر',
    permissions: [
      P.STORE_READ,
      P.MEMBERS_READ,
      P.ROLES_READ,
      P.DOMAINS_READ,
      P.PRODUCTS_READ,
      P.PRODUCTS_WRITE,
      P.INVENTORY_READ,
      P.INVENTORY_WRITE,
      P.ORDERS_READ,
      P.ORDERS_WRITE,
      P.CUSTOMERS_READ,
      P.CUSTOMERS_WRITE,
      P.MARKETING_MANAGE,
      P.SEO_MANAGE,
      P.REPORTS_READ,
    ],
  },
  STAFF: {
    key: 'staff',
    name: 'Staff',
    nameAr: 'موظف',
    permissions: [
      P.STORE_READ,
      P.PRODUCTS_READ,
      P.PRODUCTS_WRITE,
      P.INVENTORY_READ,
      P.INVENTORY_WRITE,
      P.ORDERS_READ,
      P.ORDERS_WRITE,
      P.CUSTOMERS_READ,
    ],
  },
  VIEWER: {
    key: 'viewer',
    name: 'Viewer',
    nameAr: 'مشاهد',
    permissions: [P.STORE_READ, P.PRODUCTS_READ, P.INVENTORY_READ, P.ORDERS_READ, P.REPORTS_READ],
  },
} as const satisfies Record<
  string,
  { key: string; name: string; nameAr: string; permissions: readonly Permission[] }
>;

export type SystemRoleKey = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES]['key'];
export const OWNER_ROLE_KEY = SYSTEM_ROLES.OWNER.key;

const TEMPLATE_BY_KEY = new Map<string, readonly Permission[]>(Object.values(SYSTEM_ROLES).map((r) => [r.key, r.permissions]));

/**
 * The permissions a role actually grants. Built-in roles always follow the
 * current template in code, so permissions introduced by later releases reach
 * existing stores without a data migration. Custom roles use their stored
 * list (unknown strings are ignored).
 */
export function resolveRolePermissions(role: { key: string | null; isSystem?: boolean; permissions: readonly string[] }): Permission[] {
  const template = role.key ? TEMPLATE_BY_KEY.get(role.key) : undefined;
  if (template && role.isSystem !== false) return [...template];
  return role.permissions.filter(isPermission);
}
