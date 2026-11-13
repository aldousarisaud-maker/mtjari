import { createStore, createTestApp, resetDb, signUp, type Session, type TestApp } from './helpers';

let t: TestApp;
let owner: Session;
let store: { id: string };
let roles: Record<string, string>;

async function inviteAndJoin(email: string, roleKeyOrId: string): Promise<Session> {
  const member = await signUp(t, email);
  const roleId = roles[roleKeyOrId] ?? roleKeyOrId;
  await t.http().post(`/v1/stores/${store.id}/invitations`).set(owner.auth).send({ email, roleId }).expect(201);
  await t.http().post('/v1/invitations/accept').set(member.auth).send({ token: t.mail.tokenFor(email) }).expect(200);
  return member;
}

async function memberId(email: string): Promise<string> {
  const res = await t.http().get(`/v1/stores/${store.id}/members`).set(owner.auth).expect(200);
  return res.body.find((m: { user: { email: string } }) => m.user.email === email).id;
}

beforeAll(async () => {
  await resetDb();
  t = await createTestApp();
  owner = await signUp(t, 'owner@example.com');
  store = await createStore(t, owner, 'rbac-shop');
  const res = await t.http().get(`/v1/stores/${store.id}/roles`).set(owner.auth).expect(200);
  roles = Object.fromEntries(res.body.map((r: { key: string; id: string }) => [r.key, r.id]));
});
afterAll(() => t.close());

describe('invitations', () => {
  it('invited staff can join, and the invitation email is the only way in', async () => {
    const staff = await inviteAndJoin('staff@example.com', 'staff');
    const me = await t.http().get('/v1/me').set(staff.auth).expect(200);
    expect(me.body.stores).toEqual([expect.objectContaining({ id: store.id, role: expect.objectContaining({ key: 'staff' }) })]);
  });

  it('an invitation cannot be accepted by a different account or twice', async () => {
    const intruder = await signUp(t, 'intruder@example.com');
    const target = await signUp(t, 'target@example.com');
    await t.http().post(`/v1/stores/${store.id}/invitations`).set(owner.auth).send({ email: 'target@example.com', roleId: roles.viewer }).expect(201);
    const token = t.mail.tokenFor('target@example.com');
    const res = await t.http().post('/v1/invitations/accept').set(intruder.auth).send({ token }).expect(403);
    expect(res.body.message).toBe('invitation_email_mismatch');
    await t.http().post('/v1/invitations/accept').set(target.auth).send({ token }).expect(200);
    await t.http().post('/v1/invitations/accept').set(target.auth).send({ token }).expect(400);
  });

  it('revoked invitations stop working', async () => {
    const late = await signUp(t, 'late@example.com');
    const inv = await t.http().post(`/v1/stores/${store.id}/invitations`).set(owner.auth).send({ email: 'late@example.com', roleId: roles.viewer }).expect(201);
    await t.http().delete(`/v1/stores/${store.id}/invitations/${inv.body.id}`).set(owner.auth).expect(204);
    await t.http().post('/v1/invitations/accept').set(late.auth).send({ token: t.mail.tokenFor('late@example.com') }).expect(400);
  });
});

describe('permission enforcement', () => {
  let staff: Session;
  beforeAll(async () => {
    staff = (await t.http().post('/v1/auth/login').send({ email: 'staff@example.com', password: 'correct-horse-battery' }).expect(200)).body.tokens;
  });
  const auth = () => ({ Authorization: `Bearer ${(staff as unknown as { accessToken: string }).accessToken}` });

  it('staff can read the store but not change it or see the team', async () => {
    await t.http().get(`/v1/stores/${store.id}`).set(auth()).expect(200);
    const res = await t.http().patch(`/v1/stores/${store.id}`).set(auth()).send({ name: 'Hacked' }).expect(403);
    expect(res.body).toMatchObject({ message: 'missing_permission', missing: ['store:update'] });
    await t.http().get(`/v1/stores/${store.id}/members`).set(auth()).expect(403);
    await t.http().get(`/v1/stores/${store.id}/audit-logs`).set(auth()).expect(403);
    await t.http().post(`/v1/stores/${store.id}/roles`).set(auth()).send({ name: 'Mine', permissions: ['store:update'] }).expect(403);
    await t.http().delete(`/v1/stores/${store.id}`).set(auth()).send({ confirmSlug: 'rbac-shop' }).expect(403);
  });

  it('permission changes take effect on the next request (no stale tokens)', async () => {
    const id = await memberId('staff@example.com');
    await t.http().patch(`/v1/stores/${store.id}/members/${id}`).set(owner.auth).send({ roleId: roles.manager }).expect(200);
    await t.http().get(`/v1/stores/${store.id}/members`).set(auth()).expect(200);
    await t.http().patch(`/v1/stores/${store.id}/members/${id}`).set(owner.auth).send({ roleId: roles.staff }).expect(200);
    await t.http().get(`/v1/stores/${store.id}/members`).set(auth()).expect(403);
  });

  it('removed members lose access immediately', async () => {
    const temp = await inviteAndJoin('temp@example.com', 'viewer');
    await t.http().get(`/v1/stores/${store.id}`).set(temp.auth).expect(200);
    await t.http().delete(`/v1/stores/${store.id}/members/${await memberId('temp@example.com')}`).set(owner.auth).expect(204);
    await t.http().get(`/v1/stores/${store.id}`).set(temp.auth).expect(404);
  });
});

describe('privilege escalation is blocked', () => {
  let admin: Session;
  beforeAll(async () => {
    admin = await inviteAndJoin('admin@example.com', 'admin');
  });

  it('admin cannot grant the owner role or make themselves owner', async () => {
    const staffId = await memberId('staff@example.com');
    const r1 = await t.http().patch(`/v1/stores/${store.id}/members/${staffId}`).set(admin.auth).send({ roleId: roles.owner }).expect(403);
    expect(r1.body.message).toBe('role_escalation_denied');
    const selfId = await memberId('admin@example.com');
    await t.http().patch(`/v1/stores/${store.id}/members/${selfId}`).set(admin.auth).send({ roleId: roles.owner }).expect(403);
    await t.http().post(`/v1/stores/${store.id}/invitations`).set(admin.auth).send({ email: 'friend@example.com', roleId: roles.owner }).expect(403);
  });

  it('admin cannot demote or remove the owner', async () => {
    const ownerId = await memberId('owner@example.com');
    await t.http().patch(`/v1/stores/${store.id}/members/${ownerId}`).set(admin.auth).send({ roleId: roles.viewer }).expect(403);
    await t.http().delete(`/v1/stores/${store.id}/members/${ownerId}`).set(admin.auth).expect(403);
  });

  it('admin cannot create a custom role with permissions they lack', async () => {
    const res = await t.http().post(`/v1/stores/${store.id}/roles`).set(admin.auth).send({ name: 'Billing', permissions: ['billing:manage'] }).expect(403);
    expect(res.body.message).toBe('role_escalation_denied');
    const ok = await t.http().post(`/v1/stores/${store.id}/roles`).set(admin.auth).send({ name: 'Catalog', permissions: ['products:read', 'products:write'] }).expect(201);
    expect(ok.body.permissions).toEqual(['products:read', 'products:write']);
  });

  it('rejects unknown permission strings and edits to system roles', async () => {
    const res = await t.http().post(`/v1/stores/${store.id}/roles`).set(owner.auth).send({ name: 'Weird', permissions: ['root:all'] }).expect(400);
    expect(res.body.unknown).toEqual(['root:all']);
    await t.http().put(`/v1/stores/${store.id}/roles/${roles.staff}`).set(owner.auth).send({ name: 'Staff', permissions: ['store:read', 'billing:manage'] }).expect(403);
    await t.http().delete(`/v1/stores/${store.id}/roles/${roles.viewer}`).set(owner.auth).expect(403);
  });

  it('custom roles work end to end and cannot be deleted while in use', async () => {
    const created = await t.http().post(`/v1/stores/${store.id}/roles`).set(owner.auth).send({ name: 'Auditor', permissions: ['store:read', 'audit:read'] }).expect(201);
    const auditor = await inviteAndJoin('auditor@example.com', created.body.id);
    await t.http().get(`/v1/stores/${store.id}/audit-logs`).set(auditor.auth).expect(200);
    await t.http().get(`/v1/stores/${store.id}/members`).set(auditor.auth).expect(403);
    await t.http().delete(`/v1/stores/${store.id}/roles/${created.body.id}`).set(owner.auth).expect(409);
  });
});

describe('ownership safety', () => {
  it('the last owner cannot leave or be demoted; a second owner unlocks it', async () => {
    const r = await t.http().post(`/v1/stores/${store.id}/leave`).set(owner.auth).expect(409);
    expect(r.body.message).toBe('last_owner');
    const co = await inviteAndJoin('co-owner@example.com', 'owner');
    await t.http().post(`/v1/stores/${store.id}/leave`).set(co.auth).expect(204);
    await t.http().get(`/v1/stores/${store.id}`).set(co.auth).expect(404);
  });

  it('members cannot change their own role', async () => {
    const res = await t.http().patch(`/v1/stores/${store.id}/members/${await memberId('owner@example.com')}`).set(owner.auth).send({ roleId: roles.admin }).expect(403);
    expect(res.body.message).toBe('cannot_change_own_role');
  });
});

describe('audit trail', () => {
  it('records who did what, newest first, with cursor pagination', async () => {
    const page1 = await t.http().get(`/v1/stores/${store.id}/audit-logs?limit=5`).set(owner.auth).expect(200);
    expect(page1.body.items).toHaveLength(5);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await t.http().get(`/v1/stores/${store.id}/audit-logs?limit=5&cursor=${page1.body.nextCursor}`).set(owner.auth).expect(200);
    const ids1 = page1.body.items.map((i: { id: string }) => i.id);
    expect(page2.body.items.some((i: { id: string }) => ids1.includes(i.id))).toBe(false);

    const all = await t.http().get(`/v1/stores/${store.id}/audit-logs?limit=100`).set(owner.auth).expect(200);
    const actions = new Set(all.body.items.map((i: { action: string }) => i.action));
    for (const a of ['store.created', 'member.invited', 'member.joined', 'member.role_changed', 'member.removed', 'member.invitation_revoked', 'role.created', 'member.left']) {
      expect(actions).toContain(a);
    }
    const changed = all.body.items.find((i: { action: string }) => i.action === 'member.role_changed');
    expect(changed.metadata).toMatchObject({ from: expect.any(String), to: expect.any(String) });
    expect(changed.ip).toBeTruthy();
  });

  it('filters by action', async () => {
    const res = await t.http().get(`/v1/stores/${store.id}/audit-logs?action=role.created`).set(owner.auth).expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((i: { action: string }) => i.action === 'role.created')).toBe(true);
  });
});
