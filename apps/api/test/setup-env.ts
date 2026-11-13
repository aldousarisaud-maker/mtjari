import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_DATABASE_OWNER_URL) {
  throw new Error('TEST_DATABASE_URL and TEST_DATABASE_OWNER_URL must be set (see .env.example)');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET ??= randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEYS ??= `t1:${randomBytes(32).toString('base64')}`;
process.env.MAIL_TRANSPORT = 'log';
process.env.THROTTLE_LIMIT ??= '10000';
process.env.AUTH_THROTTLE_LIMIT ??= '10000';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = mkdtempSync(join(tmpdir(), 'mtjari-media-'));
process.env.STORAGE_PUBLIC_URL = 'http://localhost:4000/media';
