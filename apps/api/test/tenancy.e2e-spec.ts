/**
 * Cross-tenant attack tests through the public HTTP API: a member of store B
 * tries every store-A endpoint and every id-smuggling trick we can think of.
 */
import { createStore, createTestApp, resetDb, signUp, type Session, type TestApp } from './helpers';

let t: TestApp;
let alice: Session;
let bob: Session;
let storeA: { id: string; slug: string };
let storeB: { id: string; slug: string };

beforeAll(async () => {
  await resetDb();
  t = await createTestApp();
  alice = await signUp(t, 'alice@example.com');
  bob = await signUp(t, 'bob@example.com');
  storeA = await createStore(t, alice, 'alice-shop', 'متجر أليس');
  storeB = await createStore(t, bob, 'bob-shop');
});
afterAll(() => t.close());

describe('store creation', () => {
  it('creates the store with system roles, owner membership, subdomain and audit entry', async () => {
    const res = await t.http().get(`/v1/stores/${storeA.id}`).set(alice.auth).expect(200);
    expect(res.body).toMatchObject({ name: 'متجر أليس', slug: 'alice-shop', country: 'KW', currency: 'KWD', status: 'DRAFT' });
    expect(res.body.domains).toEqual([expect.objectContaining({ hostname: 'alice-shop.mtjari.cc', type: 'SUBDOMAIN', isPrimary: true })]);
    expect(res.body.access.roleKey).toBe('owner');

    const roles = await t.http().get(`/v1/stores/${storeA.id}/roles`).set(alice.auth).expect(200);
    expect(roles.body.map((r: { key: string }) => r.key).sort()).toEqual(['admin', 'manager', 'owner', 'staff', 'viewer']);

    const audit = await t.http().get(`/v1/stores/${storeA.id}/audit-logs`).set(alice.auth).expect(200);
    expect(audit.body.items[0]).toMatchObject({ action: 'store.created', actorUserId: alice.userId });
  });

  it('rejects taken, reserved and malformed slugs', async () => {
    await t.http().post('/v1/stores').set(bob.auth).send({ name: 'Shop X', slug: 'alice-shop' }).expect(409);
    await t.http().post('/v1/stores').set(bob.auth).send({ name: 'Shop X', slug: 'admin' }).expect(400);
    await t.http().post('/v1/stores').set(bob.auth).send({ name: 'Shop X', slug: 'bad_slug!' }).expect(400);
    const avail = await t.http().get('/v1/stores/slug-availability?slug=Alice-Shop').set(bob.auth).expect(200);
    expect(avail.body).toEqual({ slug: 'alice-shop', available: false, reason: 'taken' });
    const free = await t.http().get('/v1/stores/slug-availability?slug=new-shop').set(bob.auth).expect(200);
    expect(free.body.available).toBe(true);
  });

  it('enforces the per-user store limit on the backend', async () => {
    const limited = await createTestApp({ MAX_STORES_PER_USER: '1' });
    try {
      const res = await limited.http().post('/v1/stores').set(alice.auth).send({ name: 'Second', slug: 'alice-second' }).expect(403);
      expect(res.body.message).toBe('store_limit_reached');
    } finally {
      await limited.close();
    }
  });

  it('two users racing for the same slug: exactly one wins', async () => {
    const results = await Promise.all([
      t.http().post('/v1/stores').set(alice.auth).send({ name: 'Race', slug: 'race-slug' }),
      t.http().post('/v1/stores').set(bob.auth).send({ name: 'Race', slug: 'race-slug' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});

describe('cross-tenant access through the API', () => {
  const endpoints = (id: string) => [
    ['get', `/v1/stores/${id}`],
    ['patch', `/v1/stores/${id}`],
    ['delete', `/v1/stores/${id}`],
    ['get', `/v1/stores/${id}/members`],
    ['get', `/v1/stores/${id}/invitations`],
    ['post', `/v1/stores/${id}/invitations`],
    ['get', `/v1/stores/${id}/roles`],
    ['post', `/v1/stores/${id}/roles`],
    ['get', `/v1/stores/${id}/audit-logs`],
    ['post', `/v1/stores/${id}/leave`],
  ] as const;

  it.each(endpoints('STORE_A'))('bob gets 404 on %s %s of store A', async (method, path) => {
    const res = await t.http()[method](path.replace('STORE_A', storeA.id)).set(bob.auth).send({ name: 'pwned', slug: 'x', email: 'x@example.com', roleId: storeA.id, permissions: [], confirmSlug: 'alice-shop' });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('store_not_found');
  });

  it('store A is unchanged after the attack', async () => {
    const res = await t.http().get(`/v1/stores/${storeA.id}`).set(alice.auth).expect(200);
    expect(res.body.name).toBe('متجر أليس');
    expect(res.body.deletedAt).toBeNull();
  });

  it('cannot use a role id from store A inside store B', async () => {
    const rolesA = await t.http().get(`/v1/stores/${storeA.id}/roles`).set(alice.auth).expect(200);
    const ownerA = rolesA.body.find((r: { key: string }) => r.key === 'owner');
    const res = await t.http().post(`/v1/stores/${storeB.id}/invitations`).set(bob.auth).send({ email: 'mallory@example.com', roleId: ownerA.id }).expect(404);
    expect(res.body.message).toBe('role_not_found');
  });

  it('cannot touch a store-A member through store B routes', async () => {
    const membersA = await t.http().get(`/v1/stores/${storeA.id}/members`).set(alice.auth).expect(200);
    const aliceMember = membersA.body[0].id;
    const rolesB = await t.http().get(`/v1/stores/${storeB.id}/roles`).set(bob.auth).expect(200);
    const viewerB = rolesB.body.find((r: { key: string }) => r.key === 'viewer');
    await t.http().patch(`/v1/stores/${storeB.id}/members/${aliceMember}`).set(bob.auth).send({ roleId: viewerB.id }).expect(404);
    await t.http().delete(`/v1/stores/${storeB.id}/members/${aliceMember}`).set(bob.auth).expect(404);
  });

  it('cannot read store A audit logs via a cursor smuggled into store B', async () => {
    const auditA = await t.http().get(`/v1/stores/${storeA.id}/audit-logs`).set(alice.auth).expect(200);
    const res = await t.http().get(`/v1/stores/${storeB.id}/audit-logs?cursor=${auditA.body.items[0].id}`).set(bob.auth).expect(200);
    expect(res.body.items.every((l: { storeId: string }) => l.storeId === storeB.id)).toBe(true);
  });

  it('returns 404 for malformed and unknown store ids', async () => {
    await t.http().get('/v1/stores/not-a-uuid').set(alice.auth).expect(404);
    await t.http().get("/v1/stores/' OR 1=1 --").set(alice.auth).expect(404);
    await t.http().get('/v1/stores/00000000-0000-4000-8000-000000000000').set(alice.auth).expect(404);
  });

  it('/me lists only the caller’s own stores', async () => {
    const me = await t.http().get('/v1/me').set(bob.auth).expect(200);
    const ids = me.body.stores.map((s: { id: string }) => s.id);
    expect(ids).toContain(storeB.id);
    expect(ids).not.toContain(storeA.id);
  });
});

describe('store lifecycle', () => {
  it('owner can update, then close the store with slug confirmation', async () => {
    const s = await signUp(t, 'closer@example.com');
    const store = await createStore(t, s, 'closing-shop');
    const upd = await t.http().patch(`/v1/stores/${store.id}`).set(s.auth).send({ name: 'Renamed', currency: 'SAR', country: 'SA' }).expect(200);
    expect(upd.body).toMatchObject({ name: 'Renamed', currency: 'SAR', country: 'SA' });
    // A partial update must not reset the fields that were not sent.
    const only = await t.http().patch(`/v1/stores/${store.id}`).set(s.auth).send({ name: 'Renamed again' }).expect(200);
    expect(only.body).toMatchObject({ name: 'Renamed again', currency: 'SAR', country: 'SA' });
    await t.http().patch(`/v1/stores/${store.id}`).set(s.auth).send({ slug: 'changed' }).expect(400);
    await t.http().delete(`/v1/stores/${store.id}`).set(s.auth).send({ confirmSlug: 'wrong' }).expect(400);
    await t.http().delete(`/v1/stores/${store.id}`).set(s.auth).send({ confirmSlug: 'closing-shop' }).expect(204);
    await t.http().get(`/v1/stores/${store.id}`).set(s.auth).expect(404);
  });
});
