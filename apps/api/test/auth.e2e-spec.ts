import { authenticator } from 'otplib';
import { PASSWORD, createTestApp, login, ownerQuery, resetDb, signUp, type TestApp } from './helpers';

let t: TestApp;

beforeAll(async () => {
  await resetDb();
  t = await createTestApp();
});
afterAll(() => t.close());

describe('registration and email verification', () => {
  it('registers, emails a verification link, verifies, logs in and reads /me', async () => {
    const res = await t.http().post('/v1/auth/register').send({ email: 'Sara@Example.com', password: PASSWORD, name: 'Sara' }).expect(201);
    expect(res.body).toEqual({ status: 'verification_sent' });

    const mail = t.mail.lastTo('sara@example.com');
    expect(mail.subject).toContain('تأكيد'); // Arabic is the default locale
    expect(mail.html).toContain('dir="rtl"');

    const before = await login(t, 'sara@example.com');
    let me = await t.http().get('/v1/me').set(before.auth).expect(200);
    expect(me.body.user).toMatchObject({ email: 'sara@example.com', emailVerified: false });
    expect(me.body.user).not.toHaveProperty('passwordHash');

    await t.http().post('/v1/auth/verify-email').send({ token: t.mail.tokenFor('sara@example.com') }).expect(200);
    me = await t.http().get('/v1/me').set(before.auth).expect(200);
    expect(me.body.user.emailVerified).toBe(true);
    expect(me.body.stores).toEqual([]);
  });

  it('verification tokens are single use and stored only as hashes', async () => {
    await t.http().post('/v1/auth/register').send({ email: 'once@example.com', password: PASSWORD, name: 'O' }).expect(201);
    const token = t.mail.tokenFor('once@example.com');
    const stored = await ownerQuery<{ token_hash: string }>("SELECT token_hash FROM email_tokens et JOIN users u ON u.id = et.user_id WHERE u.email = 'once@example.com'");
    expect(stored[0]!.token_hash).not.toEqual(token);
    await t.http().post('/v1/auth/verify-email').send({ token }).expect(200);
    await t.http().post('/v1/auth/verify-email').send({ token }).expect(400);
  });

  it('does not reveal whether an email is already registered', async () => {
    await signUp(t, 'taken@example.com');
    const sentBefore = t.mail.sent.length;
    const res = await t.http().post('/v1/auth/register').send({ email: 'taken@example.com', password: 'another-password-1', name: 'X' }).expect(201);
    expect(res.body).toEqual({ status: 'verification_sent' });
    expect(t.mail.sent.length).toBe(sentBefore + 1);
    expect(t.mail.lastTo('taken@example.com').text).not.toMatch(/token=/);
    // The original password still works; the account was not overwritten.
    await login(t, 'taken@example.com');
  });

  it('rejects weak passwords and malformed input', async () => {
    const res = await t.http().post('/v1/auth/register').send({ email: 'weak@example.com', password: 'short', name: 'W' }).expect(400);
    expect(res.body.error).toBe('validation_failed');
    await t.http().post('/v1/auth/register').send({ email: 'not-an-email', password: PASSWORD, name: 'W' }).expect(400);
  });

  it('blocks store creation until the email is verified', async () => {
    const s = await signUp(t, 'unverified@example.com', { verify: false });
    const res = await t.http().post('/v1/stores').set(s.auth).send({ name: 'Shop', slug: 'unverified-shop' }).expect(403);
    expect(res.body.message).toBe('email_not_verified');
  });
});

describe('login protection', () => {
  it('returns the same error for unknown email and wrong password', async () => {
    await signUp(t, 'login@example.com');
    const a = await t.http().post('/v1/auth/login').send({ email: 'nobody@example.com', password: PASSWORD }).expect(401);
    const b = await t.http().post('/v1/auth/login').send({ email: 'login@example.com', password: 'wrong-password!' }).expect(401);
    expect(a.body.message).toBe('invalid_credentials');
    expect(b.body.message).toBe('invalid_credentials');
  });

  it('locks the account after repeated failures', async () => {
    const lockApp = await createTestApp({ LOGIN_MAX_FAILURES: '3' });
    try {
      await signUp(lockApp, 'lock@example.com');
      for (let i = 0; i < 3; i++) {
        await lockApp.http().post('/v1/auth/login').send({ email: 'lock@example.com', password: 'wrong-password!' }).expect(401);
      }
      const res = await lockApp.http().post('/v1/auth/login').send({ email: 'lock@example.com', password: PASSWORD }).expect(429);
      expect(res.body.message).toBe('too_many_attempts');
      const logs = await ownerQuery<{ action: string }>("SELECT action FROM audit_logs a JOIN users u ON u.id = a.actor_user_id WHERE u.email = 'lock@example.com' ORDER BY a.created_at");
      expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['auth.login.failed', 'auth.login.lockout', 'auth.login.locked']));
    } finally {
      await lockApp.close();
    }
  });

  it('rate-limits auth endpoints per IP', async () => {
    const limited = await createTestApp({ AUTH_THROTTLE_LIMIT: '3' });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) {
        codes.push((await limited.http().post('/v1/auth/login').send({ email: 'x@example.com', password: 'whatever-123' })).status);
      }
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
      expect(codes.slice(3)).toEqual([429, 429]);
      // Non-auth routes use the (higher) default limit.
      await limited.http().get('/v1/health').expect(200);
    } finally {
      await limited.close();
    }
  });

  it('rejects missing, malformed and forged access tokens', async () => {
    await t.http().get('/v1/me').expect(401);
    await t.http().get('/v1/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    const forged = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' +
      Buffer.from(JSON.stringify({ sub: '00000000-0000-4000-8000-000000000000', sid: '00000000-0000-4000-8000-000000000000' })).toString('base64url') + '.';
    await t.http().get('/v1/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and detects reuse (revokes the whole family)', async () => {
    const s = await signUp(t, 'rotate@example.com');
    const r1 = await t.http().post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toEqual(s.refreshToken);

    // Old access token stays valid until it expires (family not revoked yet).
    await t.http().get('/v1/me').set(s.auth).expect(200);

    // Replaying the first refresh token = theft signal.
    const replay = await t.http().post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    expect(replay.body.message).toBe('refresh_token_reused');

    // Every token in the family is now dead, including the legitimate new one.
    await t.http().post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
    await t.http().get('/v1/me').set({ Authorization: `Bearer ${r1.body.accessToken}` }).expect(401);
  });

  it('only one of two concurrent refreshes with the same token succeeds', async () => {
    const s = await signUp(t, 'race@example.com');
    const results = await Promise.all([
      t.http().post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }),
      t.http().post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('logout revokes the session immediately', async () => {
    const s = await signUp(t, 'logout@example.com');
    await t.http().post('/v1/auth/logout').set(s.auth).expect(204);
    await t.http().get('/v1/me').set(s.auth).expect(401);
    await t.http().post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
  });

  it('logout-all revokes every device', async () => {
    const a = await signUp(t, 'devices@example.com');
    const b = await login(t, 'devices@example.com');
    const res = await t.http().post('/v1/auth/logout-all').set(a.auth).expect(200);
    expect(res.body.revoked).toBe(2);
    await t.http().get('/v1/me').set(b.auth).expect(401);
  });
});

describe('password reset', () => {
  it('resets via emailed link, revokes sessions, and the link is single use', async () => {
    const s = await signUp(t, 'reset@example.com');
    await t.http().post('/v1/auth/forgot-password').send({ email: 'reset@example.com' }).expect(200);
    const token = t.mail.tokenFor('reset@example.com');
    await t.http().post('/v1/auth/reset-password').send({ token, password: 'brand-new-password' }).expect(200);
    await t.http().post('/v1/auth/reset-password').send({ token, password: 'brand-new-password-2' }).expect(400);
    await t.http().get('/v1/me').set(s.auth).expect(401);
    await t.http().post('/v1/auth/login').send({ email: 'reset@example.com', password: PASSWORD }).expect(401);
    await t.http().post('/v1/auth/login').send({ email: 'reset@example.com', password: 'brand-new-password' }).expect(200);
  });

  it('answers identically for unknown emails and sends nothing', async () => {
    const before = t.mail.sent.length;
    const res = await t.http().post('/v1/auth/forgot-password').send({ email: 'ghost@example.com' }).expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(t.mail.sent.length).toBe(before);
  });
});

describe('MFA (TOTP)', () => {
  it('enables MFA, requires a code at login, and accepts single-use recovery codes', async () => {
    const s = await signUp(t, 'mfa@example.com');
    const setup = await t.http().post('/v1/auth/mfa/setup').set(s.auth).expect(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);

    const stored = await ownerQuery<{ mfa_secret_enc: string }>("SELECT mfa_secret_enc FROM users WHERE email = 'mfa@example.com'");
    expect(stored[0]!.mfa_secret_enc).not.toContain(setup.body.secret); // encrypted at rest

    await t.http().post('/v1/auth/mfa/enable').set(s.auth).send({ code: '000000' }).expect(400);
    const enabled = await t.http().post('/v1/auth/mfa/enable').set(s.auth).send({ code: authenticator.generate(setup.body.secret) }).expect(200);
    expect(enabled.body.recoveryCodes).toHaveLength(10);

    const noCode = await t.http().post('/v1/auth/login').send({ email: 'mfa@example.com', password: PASSWORD }).expect(401);
    expect(noCode.body.error).toBe('mfa_required');
    await t.http().post('/v1/auth/login').send({ email: 'mfa@example.com', password: PASSWORD, mfaCode: '123456' }).expect(401);
    await t.http().post('/v1/auth/login').send({ email: 'mfa@example.com', password: PASSWORD, mfaCode: authenticator.generate(setup.body.secret) }).expect(200);

    const recovery = enabled.body.recoveryCodes[0];
    await t.http().post('/v1/auth/login').send({ email: 'mfa@example.com', password: PASSWORD, recoveryCode: recovery }).expect(200);
    await t.http().post('/v1/auth/login').send({ email: 'mfa@example.com', password: PASSWORD, recoveryCode: recovery }).expect(401);

    const after = await login(t, 'mfa@example.com', { mfaCode: authenticator.generate(setup.body.secret) });
    await t.http().post('/v1/auth/mfa/disable').set(after.auth).send({ code: authenticator.generate(setup.body.secret), password: 'wrong-password!' }).expect(401);
    await t.http().post('/v1/auth/mfa/disable').set(after.auth).send({ code: authenticator.generate(setup.body.secret), password: PASSWORD }).expect(200);
    await login(t, 'mfa@example.com');
  });
});

describe('secrets never land in the audit log', () => {
  it('stores no passwords or tokens in audit metadata', async () => {
    const rows = await ownerQuery<{ m: string }>('SELECT metadata::text AS m FROM audit_logs');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.m).not.toContain(PASSWORD);
      expect(r.m).not.toMatch(/refreshToken|passwordHash/);
    }
  });
});
