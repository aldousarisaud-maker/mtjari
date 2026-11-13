import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** Format: "v1:<base64 32 bytes>,v0:<base64 32 bytes>" — first entry encrypts, all decrypt. */
const keyring = z.string().transform((raw, ctx) => {
  const keys = new Map<string, Buffer>();
  let current = '';
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = part.indexOf(':');
    const id = part.slice(0, idx);
    const key = Buffer.from(part.slice(idx + 1), 'base64');
    if (idx < 1 || !/^[a-z0-9]+$/i.test(id) || key.length !== 32) {
      ctx.addIssue({ code: 'custom', message: 'ENCRYPTION_KEYS entries must be "<id>:<base64 of 32 bytes>"' });
      return z.NEVER;
    }
    if (!current) current = id;
    keys.set(id, key);
  }
  if (!current) {
    ctx.addIssue({ code: 'custom', message: 'ENCRYPTION_KEYS is empty' });
    return z.NEVER;
  }
  return { current, keys };
});

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('mtjari.cc'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  ENCRYPTION_KEYS: keyring,
  WEB_URL: z.string().url().default('http://localhost:3000'),
  ROOT_DOMAIN: z.string().default('mtjari.cc'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Mtjari <no-reply@mtjari.cc>'),
  MAIL_TRANSPORT: z.enum(['smtp', 'log']).default('smtp'),
  THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),
  AUTH_THROTTLE_LIMIT: z.coerce.number().int().min(1).default(10),
  STOREFRONT_THROTTLE_LIMIT: z.coerce.number().int().min(1).default(600),
  CHECKOUT_THROTTLE_LIMIT: z.coerce.number().int().min(1).default(20),
  // Public address of this API as payment providers reach it (webhooks). Without it, payments are confirmed when the shopper returns.
  API_PUBLIC_URL: z.string().url().optional(),
  TAP_API_URL: z.string().url().default('https://api.tap.company'),
  // Tests only: replaces MyFatoorah's per-country API addresses.
  MYFATOORAH_API_URL: z.string().url().optional(),
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).default(10),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
  MAX_STORES_PER_USER: z.coerce.number().int().min(1).default(5),
  LOG_PRETTY: bool.default(false),
  // Media storage: "local" writes to disk and the API serves /media; "s3" uses any S3-compatible bucket.
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./var/media'),
  STORAGE_PUBLIC_URL: z.string().url().default('http://localhost:4000/media'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(false),
}).superRefine((env, ctx) => {
  if (env.STORAGE_DRIVER === 's3' && !(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)) {
    ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when STORAGE_DRIVER=s3' });
  }
  if (env.NODE_ENV === 'production') {
    if (env.MAIL_TRANSPORT !== 'smtp' || !env.SMTP_URL) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'SMTP_URL is required in production' });
    }
  } else if (env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_URL) {
    ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'Set SMTP_URL (e.g. Mailpit) or MAIL_TRANSPORT=log' });
  }
});

export type Env = z.infer<typeof envSchema>;
export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Never print values: only the variable names and the problem.
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}
