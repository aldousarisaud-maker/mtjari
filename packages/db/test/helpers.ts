import 'dotenv/config';
import { Client } from 'pg';
import { createPrismaClient } from '../src';

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set to run DB tests (see .env.example)`);
  return v;
}

export const appClient = () => createPrismaClient(requireEnv('TEST_DATABASE_URL'), { max: 4 });

/** Owner connection: used ONLY by tests to reset state. */
export async function truncateAll(): Promise<void> {
  const pg = new Client({ connectionString: requireEnv('TEST_DATABASE_OWNER_URL') });
  await pg.connect();
  try {
    await pg.query(
      'TRUNCATE audit_logs, invitations, memberships, roles, store_domains, stores, email_tokens, sessions, users RESTART IDENTITY CASCADE',
    );
  } finally {
    await pg.end();
  }
}
