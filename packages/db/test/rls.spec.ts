/**
 * Database-level tenant isolation tests. These run against a real Postgres
 * as the restricted runtime role (mtjari_app) and prove that isolation holds
 * even if application code forgets a WHERE store_id = ... clause.
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PrismaClient, isSlugTaken, resolveStoreIdByHost, withTenant } from '../src';
import { appClient, requireEnv, truncateAll } from './helpers';

let prisma: PrismaClient;
const userA = randomUUID();
const userB = randomUUID();
const storeA = randomUUID();
const storeB = randomUUID();

async function seedStore(storeId: string, userId: string, slug: string) {
  await withTenant(prisma, { storeId, userId }, async (tx) => {
    await tx.store.create({ data: { id: storeId, name: slug, slug, createdById: userId } });
    const role = await tx.role.create({
      data: { storeId, key: 'owner', name: 'Owner', permissions: ['store:read'], isSystem: true },
    });
    await tx.membership.create({ data: { storeId, userId, roleId: role.id } });
    await tx.storeDomain.create({
      data: { storeId, hostname: `${slug}.mtjari.cc`, type: 'SUBDOMAIN', status: 'ACTIVE', isPrimary: true },
    });
    await tx.auditLog.create({ data: { storeId, actorUserId: userId, action: 'store.created' } });
  });
}

beforeAll(async () => {
  await truncateAll();
  prisma = appClient();
  await prisma.user.createMany({
    data: [
      { id: userA, email: 'a@test.local', name: 'A', passwordHash: 'x' },
      { id: userB, email: 'b@test.local', name: 'B', passwordHash: 'x' },
    ],
  });
  await seedStore(storeA, userA, 'store-a');
  await seedStore(storeB, userB, 'store-b');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('runtime role', () => {
  it('is not a superuser, cannot bypass RLS and does not own tables', async () => {
    const rows = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; owns: bigint }[]>`
      SELECT r.rolsuper, r.rolbypassrls,
             (SELECT count(*) FROM pg_tables t WHERE t.schemaname = 'public' AND t.tableowner = current_user) AS owns
      FROM pg_roles r WHERE r.rolname = current_user`;
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owns: 0n });
  });
});

describe('no tenant context (default deny)', () => {
  it('sees no tenant rows at all', async () => {
    expect(await prisma.store.count()).toBe(0);
    expect(await prisma.role.count()).toBe(0);
    expect(await prisma.membership.count()).toBe(0);
    expect(await prisma.storeDomain.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('cannot insert tenant rows', async () => {
    await expect(
      prisma.store.create({ data: { id: randomUUID(), name: 'x', slug: 'rogue' } }),
    ).rejects.toThrow();
  });
});

describe('tenant context A', () => {
  const ctxA = { storeId: storeA, userId: userA };

  it('only sees store A data even with no WHERE clause', async () => {
    await withTenant(prisma, ctxA, async (tx) => {
      expect((await tx.store.findMany()).map((s) => s.id)).toEqual([storeA]);
      expect((await tx.role.findMany()).every((r) => r.storeId === storeA)).toBe(true);
      expect((await tx.storeDomain.findMany()).map((d) => d.hostname)).toEqual(['store-a.mtjari.cc']);
      expect((await tx.auditLog.findMany()).every((l) => l.storeId === storeA)).toBe(true);
    });
  });

  it('cannot read store B by primary key', async () => {
    const found = await withTenant(prisma, ctxA, (tx) => tx.store.findUnique({ where: { id: storeB } }));
    expect(found).toBeNull();
  });

  it('cannot update or delete store B rows (0 rows affected)', async () => {
    await withTenant(prisma, ctxA, async (tx) => {
      const upd = await tx.store.updateMany({ where: { id: storeB }, data: { name: 'pwned' } });
      expect(upd.count).toBe(0);
      const del = await tx.storeDomain.deleteMany({ where: { storeId: storeB } });
      expect(del.count).toBe(0);
    });
    const name = await withTenant(prisma, { storeId: storeB, userId: userB }, (tx) =>
      tx.store.findUniqueOrThrow({ where: { id: storeB } }).then((s) => s.name),
    );
    expect(name).toBe('store-b');
  });

  it('cannot write rows that point at store B (WITH CHECK)', async () => {
    const roleB = await withTenant(prisma, { storeId: storeB }, (tx) => tx.role.findFirstOrThrow());
    await expect(
      withTenant(prisma, ctxA, (tx) =>
        tx.membership.create({ data: { storeId: storeB, userId: userA, roleId: roleB.id } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(prisma, ctxA, (tx) => tx.auditLog.create({ data: { storeId: storeB, action: 'forged' } })),
    ).rejects.toThrow();
  });

  it('cannot move a row from A to B', async () => {
    await expect(
      withTenant(prisma, ctxA, (tx) =>
        tx.storeDomain.updateMany({ where: { storeId: storeA }, data: { storeId: storeB } }),
      ),
    ).rejects.toThrow();
  });
});

describe('user-scoped visibility', () => {
  it('lets a user list their own memberships and stores across tenants, nothing else', async () => {
    const res = await withTenant(prisma, { userId: userA }, async (tx) => ({
      memberships: await tx.membership.findMany({ include: { store: true, role: true } }),
      stores: await tx.store.findMany(),
    }));
    expect(res.memberships.map((m) => m.storeId)).toEqual([storeA]);
    expect(res.memberships[0]?.role.key).toBe('owner');
    expect(res.stores.map((s) => s.id)).toEqual([storeA]);
  });

  it('does not let a user write into a store they only read via membership', async () => {
    const upd = await withTenant(prisma, { userId: userA }, (tx) =>
      tx.store.updateMany({ where: { id: storeA }, data: { name: 'x' } }),
    );
    expect(upd.count).toBe(0);
  });
});

describe('audit log is append-only', () => {
  it('rejects UPDATE and DELETE from the runtime role', async () => {
    await expect(
      withTenant(prisma, { storeId: storeA }, (tx) => tx.auditLog.updateMany({ data: { action: 'tampered' } })),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(prisma, { storeId: storeA }, (tx) => tx.auditLog.deleteMany()),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('context does not leak across pooled connections', () => {
  it('a query after a tenant transaction sees nothing', async () => {
    for (let i = 0; i < 10; i++) {
      await withTenant(prisma, { storeId: storeA }, (tx) => tx.store.count());
      expect(await prisma.store.count()).toBe(0);
    }
  });

  it('concurrent transactions for different tenants stay isolated', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const storeId = i % 2 ? storeA : storeB;
        return withTenant(prisma, { storeId }, async (tx) => {
          const ids = (await tx.store.findMany()).map((s) => s.id);
          return { storeId, ids };
        });
      }),
    );
    for (const r of results) expect(r.ids).toEqual([r.storeId]);
  });
});

describe('security-definer lookups', () => {
  it('resolve host and slug without exposing rows', async () => {
    expect(await resolveStoreIdByHost(prisma, 'STORE-B.mtjari.cc')).toBe(storeB);
    expect(await resolveStoreIdByHost(prisma, 'unknown.mtjari.cc')).toBeNull();
    expect(await isSlugTaken(prisma, 'store-a')).toBe(true);
    expect(await isSlugTaken(prisma, 'free-slug')).toBe(false);
  });

  it('rejects malformed context ids before reaching SQL', async () => {
    await expect(withTenant(prisma, { storeId: "x' OR 1=1 --" }, async () => 1)).rejects.toThrow(/Invalid storeId/);
  });
});

describe('raw SQL as the runtime role', () => {
  it('is subject to the same policies', async () => {
    const pg = new Client({ connectionString: requireEnv('TEST_DATABASE_URL') });
    await pg.connect();
    try {
      await pg.query('BEGIN');
      await pg.query("SELECT set_config('app.tenant_id', $1, true)", [storeA]);
      const r = await pg.query('SELECT id FROM stores');
      expect(r.rows.map((x) => x.id)).toEqual([storeA]);
      await pg.query('COMMIT');
      const after = await pg.query('SELECT count(*)::int AS n FROM stores');
      expect(after.rows[0].n).toBe(0);
    } finally {
      await pg.end();
    }
  });
});
