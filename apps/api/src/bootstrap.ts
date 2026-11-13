import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { resolve } from 'node:path';
import { Logger } from 'nestjs-pino';
import { buildAppModule } from './app.module';
import type { Env } from './config/env';

export async function createApp(env: Env): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(buildAppModule(env), { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  configureApp(app, env);
  app.enableShutdownHooks();
  return app;
}

/** HTTP-level configuration shared by the real server and the test harness. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  // Product images are public and loaded from the storefront/dashboard origin.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  if (env.STORAGE_DRIVER === 'local') {
    app.useStaticAssets(resolve(env.STORAGE_LOCAL_DIR), {
      prefix: '/media/', index: false, dotfiles: 'deny', immutable: true, maxAge: '365d',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    });
  }
  app.useBodyParser('json', { limit: '1mb' });
  app.enableCors({
    origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
  });
}
