import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.ts';
import { postgresOptions } from '../src/database.ts';
import { runAgent, type ModelProvider } from '../src/agent.ts';
import type { Runtime } from '../src/sandbox.ts';
import { serverConfig } from '../src/config.ts';

test('Postgres verifies TLS even when a connection URL requests weaker verification', () => {
  const options = postgresOptions('postgresql://user:secret@db.example.com/test?sslmode=no-verify');
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.ok(!options.connectionString.includes('sslmode'));
  assert.throws(() => postgresOptions('http://db.example.com'));
});

test('Render refuses ephemeral SQLite and uses its assigned HTTPS origin', () => {
  const env = {
    NODE_ENV: 'production',
    RENDER: 'true',
    VAULT_KEY: 'a'.repeat(64),
    RENDER_EXTERNAL_URL: 'https://pocketforge-test.onrender.com',
  };
  assert.throws(() => serverConfig(env), /DATABASE_URL/);
  const config = serverConfig({ ...env, DATABASE_URL: 'postgresql://example.invalid/test' });
  assert.equal(config.publicOrigin, env.RENDER_EXTERNAL_URL);
  assert.equal(config.allowRegistration, false);
});

const url = process.env.PF_TEST_DATABASE_URL;
test(
  'real Postgres: AI files, history, secrets, sessions, rollback, concurrent revisions and reconnect',
  { skip: !url },
  async () => {
    // Never run this integration suite against the application's normal database.
    assert.match(new URL(url!).pathname, /^\/pocketforge_test$/);
    const key = 'b'.repeat(64);
    let store = await Store.open('', key, false, url);
    const second = await Store.open('', key, false, url);
    try {
      const user = await store.createUser('Test_' + randomUUID(), 'test-password-only');
      assert.equal((await store.login(user.name, 'test-password-only')).id, user.id);
      const token = await store.session(user.id);
      let p = await store.create(user.id, 'Postgres integration', '');
      const outsider = await store.createUser('Other_' + randomUUID(), 'test-password-only');
      await assert.rejects(store.project(outsider.id, p.id), /見つかりません/);
      await store.setSecret(user.id, 'openai', 'integration-secret-only', 'test-model');
      const row = await store.db.get('SELECT secret FROM integrations WHERE owner=?', user.id);
      assert.ok(!row.secret.includes('integration-secret-only'));
      assert.equal(await store.redact(user.id, 'key=integration-secret-only'), 'key=[REDACTED]');
      let round = 0;
      const provider: ModelProvider = {
        async next() {
          if (round++ === 0)
            return {
              text: '',
              raw: [],
              calls: [
                {
                  id: 'write',
                  name: 'write_file',
                  arguments: { path: 'src/probe.ts', content: 'export const saved = true;\n' },
                },
              ],
            };
          throw new Error('simulated later provider outage');
        },
        append() {},
      };
      await assert.rejects(
        runAgent(store, {} as Runtime, user.id, p.id, 'Create a file', provider),
        /outage/,
      );
      p = await store.project(user.id, p.id);
      assert.equal(p.files['src/probe.ts'], 'export const saved = true;\n');
      assert.equal((await store.history(user.id, p.id)).length, 2);
      const competing = await Promise.allSettled([
        store.save(user.id, p.id, { ...p.files, 'race.txt': 'one' }, p.revision, 'one'),
        second.save(user.id, p.id, { ...p.files, 'race.txt': 'two' }, p.revision, 'two'),
      ]);
      assert.equal(competing.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(
        (competing.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.statusCode,
        409,
      );
      p = await store.project(user.id, p.id);
      // A failed history write must roll back the corresponding project update.
      await assert.rejects(
        store.db.transaction(async (tx) => {
          await tx.run('UPDATE projects SET data=? WHERE id=?', '{}', p.id);
          throw new Error('rollback probe');
        }),
        /rollback probe/,
      );
      assert.equal((await store.project(user.id, p.id)).revision, p.revision);
      await Promise.all([
        store.save(user.id, p.id, { ...p.files, 'final.txt': 'durable' }, p.revision, 'final'),
        second.updateRuntime(user.id, p.id, { sandboxState: 'paused' }),
      ]);
      const pending = await store.createJob(p.id, 'test');
      await store.close();
      store = await Store.open('', key, true, url);
      const restored = await store.project(user.id, p.id);
      assert.equal(restored.files['final.txt'], 'durable');
      assert.equal(restored.sandboxState, 'paused');
      assert.equal((await store.authenticate(token))?.id, user.id);
      assert.equal((await store.secret(user.id, 'openai'))?.key, 'integration-secret-only');
      assert.equal(
        (await store.jobs(user.id, p.id)).find((j) => j.id === pending.id)?.status,
        'failed',
      );
      assert.ok((await store.events(user.id, p.id, 0)).every((e) => typeof e.id === 'number'));
      await store.logout(token);
      assert.equal(await store.authenticate(token), undefined);
    } finally {
      await second.close();
      await store.close();
    }
  },
);
