import { resolve } from 'node:path';
import { z } from 'zod';
import { Store } from '../apps/api/src/store.ts';
import { serverConfig } from '../apps/api/src/config.ts';
try {
  process.loadEnvFile('.env');
} catch {}
try {
  serverConfig(process.env);
  const { name, password } = z
    .object({
      name: z
        .string()
        .trim()
        .min(2)
        .max(40)
        .regex(/^[\p{L}\p{N}_ -]+$/u),
      password: z.string().min(10).max(128),
    })
    .parse({ name: process.env.BOOTSTRAP_NAME, password: process.env.BOOTSTRAP_PASSWORD });
  // Administrative account creation must not mark another server's jobs as interrupted.
  const store = await Store.open(
    resolve(process.env.DATA_DIR || '.data'),
    process.env.VAULT_KEY,
    false,
    process.env.DATABASE_URL,
  );
  try {
    await store.createUser(name, password);
    console.log('アカウントを作成しました。パスワードは表示しません。');
  } finally {
    await store.close();
  }
} catch {
  console.error(
    'アカウントを作成できません。環境設定・名前の重複・名前とパスワードの形式を確認してください。',
  );
  process.exitCode = 1;
}
