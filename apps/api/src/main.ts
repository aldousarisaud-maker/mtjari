import 'reflect-metadata';
import 'dotenv/config';
import { loadEnv } from './config/env';
import { createApp } from './bootstrap';

async function main() {
  const env = loadEnv();
  const app = await createApp(env);
  await app.listen(env.PORT, '0.0.0.0');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
