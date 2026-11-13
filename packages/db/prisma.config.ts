import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Migrations run as the schema-owner role (DATABASE_OWNER_URL). The API runs
// as the restricted application role (DATABASE_URL) so RLS always applies.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_OWNER_URL ?? '',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
