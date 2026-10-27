import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { buildApp } from '../src/app.ts';
import { Store, validateFiles, AppError } from '../src/store.ts';
import { runAgent, type ModelProvider } from '../src/agent.ts';
import {
  AI_PROVIDERS,
  defaultDesign,
  generateDesign,
  templateFiles,
  type Files,
  type Project,
} from '@pocketforge/core';
import type { Runtime } from '../src/sandbox.ts';
test('authenticated project workflow, isolation, conflict, design, restore and export', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocketforge-test-'));
  const { app, store } = await buildApp({ dataDir: dir });
  try {
    const register = async (name: string) => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { name, password: 'test-passphrase-123' },
      });
      assert.equal(r.statusCode, 200, r.body);
      return r.cookies.find((c) => c.name === 'pf_session')!.value;
    };
    const a = await register('Alice'),
      b = await register('Bob');
    const call = (method: any, url: string, payload?: any, session = a) =>
      app.inject({ method, url, payload, cookies: { pf_session: session } });
    assert.equal((await app.inject('/api/projects')).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/projects',
          headers: { origin: 'https://evil.example' },
          cookies: { pf_session: a },
          payload: { name: 'bad' },
        })
      ).statusCode,
      403,
    );
    const created = await call('POST', '/api/projects', {
      name: 'Daily Bloom',
      description: 'Test project',
    });
    assert.equal(created.statusCode, 200, created.body);
    let p = created.json<Project>();
    assert.ok(p.files['App.tsx']);
    const path = '/api/projects/' + p.id;
    assert.equal((await call('GET', path, undefined, b)).statusCode, 404);
    assert.equal(
      (await call('PUT', path + '/file', { path: 'App.tsx', content: 'stolen', revision: 1 }, b))
        .statusCode,
      404,
    );
    for (const invalid of [
      '../outside.ts',
      '/etc/passwd',
      'src/../../bad',
      'src\\bad',
      '.git/config',
      '.env',
      '.env.production',
    ]) {
      assert.equal(
        (await call('PUT', path + '/file', { path: invalid, content: 'x', revision: p.revision }))
          .statusCode,
        400,
        invalid,
      );
    }
    const first = (await call('GET', path + '/history')).json()[0];
    let r = await call('PUT', path + '/file', {
      path: 'src/note.ts',
      content: 'export const count = 1;\n',
      revision: p.revision,
    });
    assert.equal(r.statusCode, 200);
    p = r.json();
    assert.equal(
      (await call('PUT', path + '/file', { path: 'src/note.ts', content: 'stale', revision: 1 }))
        .statusCode,
      409,
    );
    assert.equal(
      (await call('GET', path)).json().files['src/note.ts'],
      'export const count = 1;\n',
    );
    r = await call('PUT', path + '/design', {
      design: { ...defaultDesign, title: '今日をはじめよう' },
      revision: p.revision,
    });
    assert.equal(r.statusCode, 200, r.body);
    p = r.json();
    assert.match(p.files['src/HomeScreen.tsx'], /今日をはじめよう/);
    r = await call('PUT', path + '/file', {
      path: 'src/HomeScreen.tsx',
      content: '// manually changed',
      revision: p.revision,
    });
    p = r.json();
    assert.equal(
      (await call('PUT', path + '/design', { design: defaultDesign, revision: p.revision }))
        .statusCode,
      409,
    );
    assert.match((await call('GET', path + '/diff/' + first.id)).json().diff, /manually changed/);
    r = await call('POST', path + '/restore', { snapshotId: first.id, revision: p.revision });
    assert.equal(r.statusCode, 200);
    p = r.json();
    assert.equal(p.files['src/HomeScreen.tsx'], generateDesign(defaultDesign));
    assert.ok(p.revision > 1);
    assert.equal(
      (await call('POST', path + '/restore', { snapshotId: first.id, revision: p.revision }, b))
        .statusCode,
      404,
    );
    const ticket = (await call('POST', path + '/export', {})).json().path;
    const zip = await app.inject(ticket);
    assert.equal(zip.statusCode, 200);
    assert.equal(strFromU8(unzipSync(zip.rawPayload)['App.tsx']), p.files['App.tsx']);
    assert.equal((await app.inject(ticket)).statusCode, 404, 'download ticket is one use');
    assert.equal(
      (await call('POST', path + '/ai', { prompt: 'Create app', provider: 'openai' })).statusCode,
      503,
    );
    assert.equal(
      (await call('POST', path + '/runtime/start', {})).statusCode,
      400,
      'explicit resource confirmation required',
    );
    const j = (await call('POST', path + '/runtime/start', { confirmed: true })).json();
    assert.equal(j.status, 'running');
    await new Promise((r) => setTimeout(r, 20));
    const jobs = (await call('GET', path + '/jobs')).json();
    assert.equal(jobs[0].status, 'failed');
    assert.match(jobs[0].result, /E2B/);
    await call('PUT', '/api/integrations/openai', {
      key: 'private-key-never-return',
      model: 'test-model',
    });
    const integration = await call('GET', '/api/integrations');
    assert.ok(!integration.body.includes('private-key-never-return'));
    const row = (await store.db.get('SELECT secret FROM integrations')) as any;
    assert.ok(!row.secret.includes('private-key-never-return'));
    assert.equal(
      (await call('GET', '/api/integrations', undefined, b)).json()[0].configured,
      false,
    );
    await call('POST', '/api/auth/logout', {});
    assert.equal((await call('GET', path)).statusCode, 401);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('store survives restart and restores encrypted connections and files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocketforge-store-'));
  try {
    let store = await Store.open(dir);
    const user = await store.createUser('Persist', 'sufficient-password');
    let p = await store.create(user.id, 'Persistence', '');
    p = await store.save(
      user.id,
      p.id,
      { ...p.files, 'notes.md': 'persistent' },
      p.revision,
      'Edit',
    );
    await store.setSecret(user.id, 'e2b', 'test-secret-123', '');
    await store.close();
    store = await Store.open(dir);
    assert.equal((await store.project(user.id, p.id)).files['notes.md'], 'persistent');
    assert.equal((await store.secret(user.id, 'e2b'))?.key, 'test-secret-123');
    assert.equal((await store.history(user.id, p.id)).length, 2);
    await store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('all four AI connections validate, encrypt, isolate, redact and delete; new providers execute jobs', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pocketforge-connections-'));
  const { app, store } = await buildApp({ dataDir: dir });
  const endpoints: string[] = [];
  const seen = new Map<string, number>();
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    endpoints.push(url);
    const body = JSON.parse(String(init.body));
    const count = (seen.get(url) || 0) + 1;
    seen.set(url, count);
    const args = { path: 'ai-note.md', content: 'Written through ' + body.model };
    const gemini = url.includes('googleapis.com');
    return Response.json(
      gemini
        ? {
            status: count === 1 ? 'requires_action' : 'completed',
            steps:
              count === 1
                ? [{ type: 'function_call', id: 'g1', name: 'write_file', arguments: args }]
                : [{ type: 'model_output', content: [{ type: 'text', text: '保存しました。' }] }],
          }
        : {
            status: 'completed',
            output:
              count === 1
                ? [
                    {
                      type: 'function_call',
                      call_id: 'x1',
                      name: 'write_file',
                      arguments: JSON.stringify(args),
                    },
                  ]
                : [{ type: 'message', content: [{ type: 'output_text', text: '保存しました。' }] }],
          },
    );
  });
  try {
    const owner = await store.createUser('Connections', 'test-passphrase-123');
    const other = await store.createUser('Other', 'test-passphrase-123');
    const session = await store.session(owner.id);
    const call = (method: any, url: string, payload?: any) =>
      app.inject({ method, url, payload, cookies: { pf_session: session } });
    const project = await store.create(owner.id, 'Provider routing', '');
    for (const provider of AI_PROVIDERS) {
      const key = provider + '-test-private-key';
      assert.equal(
        (await call('POST', `/api/projects/${project.id}/ai`, { prompt: 'Inspect', provider }))
          .statusCode,
        503,
      );
      assert.equal(
        (await call('PUT', '/api/integrations/' + provider, { key, model: ' ' })).statusCode,
        400,
      );
      assert.equal(
        (await call('PUT', '/api/integrations/' + provider, { key, model: provider + '-model' }))
          .statusCode,
        200,
      );
      const connections = await call('GET', '/api/integrations');
      assert.equal(connections.json().find((c: any) => c.provider === provider).configured, true);
      assert.ok(!connections.body.includes(key));
      assert.equal(
        (await store.connections(other.id)).find((c) => c.provider === provider)?.configured,
        false,
      );
      assert.equal((await store.secret(owner.id, provider))?.key, key);
      assert.equal(await store.redact(owner.id, 'token: ' + key), 'token: [REDACTED]');
      assert.ok(
        !String(
          (
            await store.db.get(
              'SELECT secret FROM integrations WHERE owner=? AND provider=?',
              owner.id,
              provider,
            )
          )?.secret,
        ).includes(key),
      );
    }
    for (const provider of ['xai', 'gemini']) {
      const started = await call('POST', `/api/projects/${project.id}/ai`, {
        prompt: 'Write a note',
        provider,
      });
      assert.equal(started.statusCode, 200, started.body);
      for (
        let attempts = 0;
        attempts < 100 && (await store.jobs(owner.id, project.id))[0].status === 'running';
        attempts++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const job = (await store.jobs(owner.id, project.id))[0];
      assert.equal(job.status, 'complete', job.result);
      assert.equal(
        (await store.project(owner.id, project.id)).files['ai-note.md'],
        'Written through ' + provider + '-model',
      );
    }
    assert.deepEqual(
      [...new Set(endpoints)],
      [
        'https://api.x.ai/v1/responses',
        'https://generativelanguage.googleapis.com/v1/interactions',
      ],
    );
    for (const provider of AI_PROVIDERS) {
      assert.equal((await call('DELETE', '/api/integrations/' + provider)).statusCode, 200);
      assert.equal(await store.secret(owner.id, provider), null);
      assert.equal(
        (await store.connections(owner.id)).find((c) => c.provider === provider)?.configured,
        false,
      );
    }
    assert.equal(
      (await call('PUT', '/api/integrations/unknown', { key: 'test-private-key', model: 'model' }))
        .statusCode,
      400,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('file quotas reject excessive input and source templates are deterministic', () => {
  assert.throws(() => validateFiles({ 'large.txt': 'a'.repeat(524289) }), /512KB/);
  assert.throws(
    () =>
      validateFiles(Object.fromEntries(Array.from({ length: 251 }, (_, i) => ['file' + i, '']))),
    /250/,
  );
  const files = templateFiles('テスト');
  assert.equal(files['src/HomeScreen.tsx'], generateDesign(defaultDesign));
  assert.ok(JSON.parse(files['package.json']).dependencies.expo);
});
test('project job lock prevents manual writes while runtime command is active', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocketforge-lock-'));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const stub: Runtime = {
    start: async () => '',
    pause: async () => '',
    run: async () => {
      await gate;
      return 'done';
    },
    build: async () => '',
    buildStatus: async () => '',
  };
  const { app } = await buildApp({ dataDir: dir, runtime: () => stub });
  try {
    const auth = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Worker', password: 'test-passphrase-123' },
    });
    const session = auth.cookies[0].value;
    const call = (method: any, url: string, payload?: any) =>
      app.inject({ method, url, payload, cookies: { pf_session: session } });
    const p = (await call('POST', '/api/projects', { name: 'Lock' })).json();
    const root = '/api/projects/' + p.id;
    await call('POST', root + '/command', { command: 'test' });
    assert.equal(
      (await call('PUT', root + '/file', { path: 'App.tsx', content: 'conflict', revision: 1 }))
        .statusCode,
      409,
    );
    assert.equal((await call('POST', root + '/command', { command: 'duplicate' })).statusCode, 409);
    release();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await call('GET', root + '/jobs')).json()[0].status, 'complete');
  } finally {
    release();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('agent tools edit actual files and preserve changes from a failed command', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocketforge-agent-'));
  const store = await Store.open(dir);
  try {
    const user = await store.createUser('Agent', 'test-passphrase-123');
    const p = await store.create(user.id, 'Agent project', '');
    let step = 0;
    const provider: ModelProvider = {
      next: async () => {
        step++;
        return step === 1
          ? {
              text: '',
              raw: [],
              calls: [
                {
                  id: '1',
                  name: 'write_file',
                  arguments: { path: 'src/ai.ts', content: 'export const ready=true;' },
                },
                { id: '2', name: 'run_command', arguments: { command: 'test' } },
              ],
            }
          : { text: '変更を保存しました。', calls: [], raw: [] };
      },
      append: () => {},
    };
    const runtime: Runtime = {
      start: async () => '',
      pause: async () => '',
      build: async () => '',
      buildStatus: async () => '',
      run: async () => {
        const current = await store.project(user.id, p.id);
        await store.save(
          user.id,
          p.id,
          { ...current.files, 'src/command.ts': 'changed before failure' },
          current.revision,
          'command',
        );
        throw new AppError(422, 'test failed');
      },
    };
    await runAgent(store, runtime, user.id, p.id, 'Add source', provider, true);
    const actual = await store.project(user.id, p.id);
    assert.equal(actual.files['src/ai.ts'], 'export const ready=true;');
    assert.equal(actual.files['src/command.ts'], 'changed before failure');
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('AI edits remain in SQLite and history after the next provider request fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocketforge-ai-durable-'));
  let store = await Store.open(dir);
  try {
    const user = await store.createUser('Durable', 'test-passphrase-123');
    const p = await store.create(user.id, 'Durable AI', '');
    let step = 0;
    const provider: ModelProvider = {
      next: async () => {
        if (step++) throw new Error('Upstream unavailable');
        return {
          text: '',
          raw: [],
          calls: [
            {
              id: '1',
              name: 'write_file',
              arguments: { path: 'src/ai.ts', content: 'export const saved = true;\n' },
            },
          ],
        };
      },
      append: () => {},
    };
    await assert.rejects(
      runAgent(store, {} as Runtime, user.id, p.id, 'Save', provider),
      /Upstream unavailable/,
    );
    await store.close();
    store = await Store.open(dir);
    assert.equal(
      (await store.project(user.id, p.id)).files['src/ai.ts'],
      'export const saved = true;\n',
    );
    assert.equal((await store.history(user.id, p.id)).length, 2);
    assert.equal((await store.project(user.id, p.id)).revision, p.revision + 1);
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
