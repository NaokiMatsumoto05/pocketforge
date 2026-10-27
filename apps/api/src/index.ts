import { resolve } from 'node:path';
import { buildApp } from './app.ts';
import { serverConfig } from './config.ts';
try {
  process.loadEnvFile('.env');
} catch {}
const config = serverConfig(process.env);
const { app } = await buildApp({
  dataDir: resolve(process.env.DATA_DIR || '.data'),
  vaultKey: process.env.VAULT_KEY,
  databaseUrl: process.env.DATABASE_URL,
  production: config.production,
  origins: config.origins,
  allowRegistration: config.allowRegistration,
  trustProxy: config.trustProxy,
  staticDir: resolve('apps/mobile/dist'),
});
await app.listen({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT) || 4310 });
console.log(`PocketForge ready: ${config.publicOrigin || 'http://localhost:4310'}`);
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    void app.close().then(() => process.exit(0));
  });
