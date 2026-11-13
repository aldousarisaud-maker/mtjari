import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { authenticator } from 'otplib';
import { buildAppModule } from '../src/app.module';
import { loadEnv, type Env } from '../src/config/env';
import { MAIL_TRANSPORT, type MailTransport, type OutgoingMail } from '../src/mail/mail.service';
import helmet from 'helmet';

/** Captures outgoing mail so tests can follow real links (no shortcuts into the DB). */
export class CapturingTransport implements MailTransport {
  readonly sent: (OutgoingMail & { from: string })[] = [];
  async send(mail: OutgoingMail & { from: string }) {
    this.sent.push(mail);
  }
  lastTo(to: string) {
    const m = [...this.sent].reverse().find((x) => x.to === to);
    if (!m) throw new Error(`no mail sent to ${to}`);
    return m;
  }
  tokenFor(to: string): string {
    const match = /token=([A-Za-z0-9_-]+)/.exec(this.lastTo(to).text);
    if (!match) throw new Error('no token link in mail');
    return match[1]!;
  }
}

export interface TestApp {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  mail: CapturingTransport;
  env: Env;
  close: () => Promise<void>;
}

export async function createTestApp(overrides: Partial<Record<string, string>> = {}): Promise<TestApp> {
  const env = loadEnv({ ...process.env, ...overrides });
  const mail = new CapturingTransport();
  const moduleRef = await Test.createTestingModule({ imports: [buildAppModule(env)] })
    .overrideProvider(MAIL_TRANSPORT)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication({ logger: process.env.TEST_LOGS ? ['error'] : false });
  app.use(helmet());
  await app.init();
  return { app, http: () => request(app.getHttpServer()), mail, env, close: () => app.close() };
}

export async function resetDb(): Promise<void> {
  const pg = new Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
  await pg.connect();
  try {
    await pg.query('TRUNCATE audit_logs, invitations, memberships, roles, store_domains, stores, email_tokens, sessions, users CASCADE');
  } finally {
    await pg.end();
  }
}

/** Owner-role read for assertions about things the API intentionally never exposes. */
export async function ownerQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const pg = new Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
  await pg.connect();
  try {
    return (await pg.query(sql, params)).rows as T[];
  } finally {
    await pg.end();
  }
}

export const PASSWORD = 'correct-horse-battery';

export interface Session {
  email: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  auth: { Authorization: string };
}

export async function signUp(t: TestApp, email: string, opts: { verify?: boolean; name?: string } = {}): Promise<Session> {
  await t.http().post('/v1/auth/register').send({ email, password: PASSWORD, name: opts.name ?? email.split('@')[0] }).expect(201);
  if (opts.verify !== false) {
    await t.http().post('/v1/auth/verify-email').send({ token: t.mail.tokenFor(email) }).expect(200);
  }
  return login(t, email);
}

export async function login(t: TestApp, email: string, extra: Record<string, string> = {}): Promise<Session> {
  const res = await t.http().post('/v1/auth/login').send({ email, password: PASSWORD, ...extra }).expect(200);
  return {
    email,
    userId: res.body.user.id,
    accessToken: res.body.tokens.accessToken,
    refreshToken: res.body.tokens.refreshToken,
    auth: { Authorization: `Bearer ${res.body.tokens.accessToken}` },
  };
}

export async function createStore(t: TestApp, s: Session, slug: string, name = slug): Promise<{ id: string; slug: string }> {
  const res = await t.http().post('/v1/stores').set(s.auth).send({ name, slug }).expect(201);
  return res.body;
}

export const totp = (secret: string) => authenticator.generate(secret);
