import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

loadDotenv({ path: resolve(__dirname, '../../.env'), quiet: true });

const dbUrl = process.env.TEST_DATABASE_URL;
if (!dbUrl) throw new Error('TEST_DATABASE_URL must be set (see .env.example)');

const API_PORT = 4100;
const WEB_PORT = 3100;

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: { baseURL: `http://localhost:${WEB_PORT}`, locale: 'ar-KW' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive/ },
  ],
  webServer: [
    { command: 'node mail-sink.mjs', url: 'http://127.0.0.1:2526/health', reuseExistingServer: false },
    // Test-only stand-in for Tap Payments (see fake-tap.mjs). The real Tap is never called from the test suite.
    { command: 'node fake-tap.mjs', url: 'http://127.0.0.1:2527/health', reuseExistingServer: false },
    // Test-only stand-in for MyFatoorah (see fake-myfatoorah.mjs).
    { command: 'node fake-myfatoorah.mjs', url: 'http://127.0.0.1:2528/health', reuseExistingServer: false },
    // Test-only stand-in for Hesabe (see fake-hesabe.mjs).
    { command: 'node fake-hesabe.mjs', url: 'http://127.0.0.1:2529/health', reuseExistingServer: false },
    {
      command: 'node ../api/dist/main.js',
      url: `http://127.0.0.1:${API_PORT}/v1/health`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL: dbUrl,
        // Fresh random secrets per run; nothing is hard-coded.
        JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
        ENCRYPTION_KEYS: `e2e:${randomBytes(32).toString('base64')}`,
        MAIL_TRANSPORT: 'smtp',
        SMTP_URL: 'smtp://127.0.0.1:2525',
        WEB_URL: `http://localhost:${WEB_PORT}`,
        // Shops are served on {slug}.localhost, which browsers resolve to this machine.
        ROOT_DOMAIN: 'localhost',
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        THROTTLE_LIMIT: '10000',
        AUTH_THROTTLE_LIMIT: '10000',
        STOREFRONT_THROTTLE_LIMIT: '100000',
        CHECKOUT_THROTTLE_LIMIT: '100000',
        TAP_API_URL: 'http://127.0.0.1:2527',
        MYFATOORAH_API_URL: 'http://127.0.0.1:2528',
        HESABE_API_URL: 'http://127.0.0.1:2529',
        API_PUBLIC_URL: `http://127.0.0.1:${API_PORT}`,
        // Uploaded images go to a throw-away folder and are served by the API.
        STORAGE_DRIVER: 'local',
        STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'mtjari-e2e-media-')),
        STORAGE_PUBLIC_URL: `http://127.0.0.1:${API_PORT}/media`,
      },
    },
    {
      command: `pnpm --filter @mtjari/web exec next start -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/ar`,
      reuseExistingServer: false,
      env: { API_URL: `http://127.0.0.1:${API_PORT}`, ROOT_DOMAIN: 'localhost', ALLOW_LOCAL_PAYMENT_PAGE: '1' },
    },
  ],
});
