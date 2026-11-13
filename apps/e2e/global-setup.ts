import { Client } from 'pg';

/** Start every browser run from an empty test database. */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_OWNER_URL;
  if (!url) throw new Error('TEST_DATABASE_OWNER_URL must be set');
  const pg = new Client({ connectionString: url });
  await pg.connect();
  await pg.query('TRUNCATE audit_logs, invitations, memberships, roles, store_domains, stores, email_tokens, sessions, users CASCADE');
  await pg.end();
}
