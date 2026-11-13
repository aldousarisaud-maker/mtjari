import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/prisma/client';

export * from './generated/prisma/client';

export type TxClient = Prisma.TransactionClient;

export function createPrismaClient(connectionString: string, opts?: { max?: number }): PrismaClient {
  const adapter = new PrismaPg({ connectionString, max: opts?.max ?? 10 });
  return new PrismaClient({ adapter });
}

export interface DbContext {
  /** Tenant (store) whose rows may be read/written. Null = no tenant rows visible. */
  storeId?: string | null;
  /** Authenticated user; lets RLS expose the user's own memberships across stores. */
  userId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuidOrEmpty(value: string | null | undefined, label: string): string {
  if (value == null || value === '') return '';
  if (!UUID_RE.test(value)) throw new Error(`Invalid ${label} for DB context`);
  return value;
}

/**
 * Runs `fn` inside a transaction with the RLS context set via SET LOCAL
 * semantics (set_config(..., true)). The settings vanish at COMMIT/ROLLBACK,
 * so a pooled connection can never leak one tenant's context to another.
 *
 * Every tenant-scoped query in the API must go through this helper.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  ctx: DbContext,
  fn: (tx: TxClient) => Promise<T>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number },
): Promise<T> {
  const storeId = assertUuidOrEmpty(ctx.storeId, 'storeId');
  const userId = assertUuidOrEmpty(ctx.userId, 'userId');
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${storeId}, true), set_config('app.user_id', ${userId}, true)`;
      return fn(tx);
    },
    { timeout: options?.timeout ?? 15_000, isolationLevel: options?.isolationLevel },
  );
}

/** Security-definer lookups that are safe to run without a tenant context. */
export async function resolveStoreIdByHost(prisma: PrismaClient | TxClient, host: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string | null }[]>`SELECT resolve_store_by_host(${host.toLowerCase()}) AS id`;
  return rows[0]?.id ?? null;
}

export async function isSlugTaken(prisma: PrismaClient | TxClient, slug: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ taken: boolean }[]>`SELECT store_slug_taken(${slug}) AS taken`;
  return rows[0]?.taken ?? false;
}

export async function findInvitationStoreId(prisma: PrismaClient | TxClient, tokenHash: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string | null }[]>`SELECT find_invitation_store(${tokenHash}) AS id`;
  return rows[0]?.id ?? null;
}
