import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from './config/env';
import { PrismaService } from './common/prisma.service';
import { PrismaErrorsFilter } from './common/prisma-errors.filter';
import { MailModule } from './mail/mail.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { AppThrottlerGuard } from './auth/throttler.guard';
import { StoresModule } from './stores/stores.module';
import { MembersModule } from './members/members.module';
import { RolesModule } from './roles/roles.module';
import { HealthController } from './health/health.controller';

@Global()
@Module({})
class CoreModule {
  static forEnv(env: Env): DynamicModule {
    return {
      module: CoreModule,
      providers: [{ provide: ENV, useValue: env }, PrismaService],
      exports: [ENV, PrismaService],
    };
  }
}

export function buildAppModule(env: Env): DynamicModule {
  return {
    module: AppModule,
    imports: [
      CoreModule.forEnv(env),
      LoggerModule.forRoot({
        pinoHttp: {
          level: env.NODE_ENV === 'test' ? 'silent' : 'info',
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          // Secrets must never reach logs.
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.password', '*.refreshToken', '*.token', '*.secret'],
            censor: '[REDACTED]',
          },
          transport: env.LOG_PRETTY ? { target: 'pino-pretty' } : undefined,
        },
      }),
      ThrottlerModule.forRoot({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: env.THROTTLE_LIMIT },
          { name: 'auth', ttl: 60_000, limit: env.AUTH_THROTTLE_LIMIT },
        ],
      }),
      MailModule,
      AuditModule,
      AuthModule,
      StoresModule,
      MembersModule,
      RolesModule,
    ],
    controllers: [HealthController],
    providers: [
      { provide: APP_GUARD, useClass: AppThrottlerGuard },
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: APP_FILTER, useClass: PrismaErrorsFilter },
    ],
  };
}

@Module({})
export class AppModule {}
