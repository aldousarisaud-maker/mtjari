/**
 * Development seed: one verified merchant with one store.
 * Uses the same code paths and RLS context as the API (runtime role).
 *
 *   SEED_EMAIL=me@example.com SEED_PASSWORD='a long password' pnpm db:seed
 *
 * No default password exists: if SEED_PASSWORD is not set, a random one is
 * generated and printed once.
 */
import 'dotenv/config';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { SYSTEM_ROLES } from '@mtjari/shared';
import { createPrismaClient, withTenant } from './index';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const email = (process.env.SEED_EMAIL ?? 'merchant@example.com').toLowerCase();
  const generated = !process.env.SEED_PASSWORD;
  const password = process.env.SEED_PASSWORD ?? randomBytes(12).toString('base64url');
  const slug = process.env.SEED_SLUG ?? 'demo-store';

  const prisma = createPrismaClient(url, { max: 2 });
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`Seed skipped: ${email} already exists.`);
      return;
    }
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const user = await prisma.user.create({ data: { email, name: 'Demo Merchant', passwordHash, emailVerifiedAt: new Date() } });
    const storeId = randomUUID();
    await withTenant(prisma, { storeId, userId: user.id }, async (tx) => {
      await tx.store.create({ data: { id: storeId, name: 'متجر تجريبي', slug, createdById: user.id } });
      let ownerRoleId = '';
      for (const r of Object.values(SYSTEM_ROLES)) {
        const role = await tx.role.create({ data: { storeId, key: r.key, name: r.name, permissions: [...r.permissions], isSystem: true } });
        if (r.key === SYSTEM_ROLES.OWNER.key) ownerRoleId = role.id;
      }
      await tx.membership.create({ data: { storeId, userId: user.id, roleId: ownerRoleId } });
      await tx.storeDomain.create({
        data: { storeId, hostname: `${slug}.${process.env.ROOT_DOMAIN ?? 'mtjari.cc'}`, type: 'SUBDOMAIN', status: 'ACTIVE', isPrimary: true, verifiedAt: new Date() },
      });
      await tx.auditLog.createMany({ data: [{ storeId, actorType: 'SYSTEM', action: 'store.created', entityType: 'store', entityId: storeId, metadata: { source: 'seed' } }] });
    });
    console.log(`Seeded ${email} with store "${slug}".`);
    if (generated) console.log(`Generated password (shown once): ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
