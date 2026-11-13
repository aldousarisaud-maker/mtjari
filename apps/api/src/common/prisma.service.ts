import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createPrismaClient, withTenant, type DbContext, type PrismaClient, type TxClient } from '@mtjari/db';
import { ENV, type Env } from '../config/env';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = createPrismaClient(env.DATABASE_URL, { max: env.DATABASE_POOL_MAX });
  }

  async onModuleInit(): Promise<void> {
    await this.assertRestrictedRole();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /** Run tenant-scoped work with RLS context. */
  tx<T>(ctx: DbContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return withTenant(this.client, ctx, fn);
  }

  /**
   * Refuse to start if the API is connected with a role that would bypass
   * Row-Level Security (superuser, BYPASSRLS, or table owner).
   */
  private async assertRestrictedRole(): Promise<void> {
    const rows = await this.client.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; owns: bigint }[]>`
      SELECT r.rolsuper, r.rolbypassrls,
        (SELECT count(*) FROM pg_tables t WHERE t.schemaname = 'public' AND t.tableowner = current_user) AS owns
      FROM pg_roles r WHERE r.rolname = current_user`;
    const r = rows[0];
    if (!r || r.rolsuper || r.rolbypassrls || r.owns > 0n) {
      throw new Error(
        'Refusing to start: DATABASE_URL must use the restricted application role (no superuser, no BYPASSRLS, not table owner).',
      );
    }
    this.logger.log('Database role check passed (RLS enforced)');
  }
}
