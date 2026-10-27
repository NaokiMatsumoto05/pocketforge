import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  normalizeServerUrl,
  AI_PROVIDERS,
  type AIProvider,
  type Project,
  type Job,
} from '@pocketforge/core';
import { unzipSync, strFromU8 } from 'fflate';

// Reads only explicitly supplied test-account credentials. AI keys stay on the backend.
try {
  process.loadEnvFile('.env.iphone-test');
} catch {}
const env = process.env;
const raw = env.PF_TEST_API_URL || 'http://127.0.0.1:4310';
const local = ['http://127.0.0.1:4310', 'http://localhost:4310'].includes(raw);
const origin = local ? raw : normalizeServerUrl(raw);
const output = resolve(env.PF_TEST_REPORT || '../../work/live-ai-result.json');
const report: Record<string, any> = {
  at: new Date().toISOString(),
  client: 'desktop-http-script',
  realIPhoneTest: false,
  server: origin,
  status: 'not_started',
  checks: [],
};
let token = '';
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(origin + '/api' + path, {
    method,
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(30000),
    headers: {
      'Content-Type': 'application/json',
      'X-Client': 'mobile',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`PocketForge HTTP ${response.status}: ${method} ${path}`);
  return response;
}
const json = async (path: string, method = 'GET', body?: unknown) =>
  (await request(path, method, body)).json();
const login = async () => {
  const auth = await json('/auth/login', 'POST', {
    name: env.PF_TEST_USER,
    password: env.PF_TEST_PASSWORD,
  });
  assert.ok(typeof auth.token === 'string' && auth.token.length > 10, 'Bearer login failed');
  token = auth.token;
};
try {
  assert.ok(
    env.PF_TEST_USER && env.PF_TEST_PASSWORD,
    '.env.iphone-test に専用の検証用アカウントを設定してください。',
  );
  const health = await json('/health');
  assert.equal(health.service, 'pocketforge');
  await login();
  const connections = (await json('/integrations')) as {
    provider: string;
    configured: boolean;
    model: string;
  }[];
  const selected = connections.find(
    (c) =>
      c.configured &&
      AI_PROVIDERS.includes(c.provider as AIProvider) &&
      (!env.PF_TEST_PROVIDER || c.provider === env.PF_TEST_PROVIDER),
  );
  if (!selected) {
    report.status = 'needs_api_key';
    throw new Error(
      '利用可能なAI接続がありません。アプリの「接続・設定」で1社のAPIキーとモデルIDを登録してください。',
    );
  }
  report.provider = selected.provider;
  report.model = selected.model;
  const p: Project = await json('/projects', 'POST', {
    name: 'AI実接続テスト ' + new Date().toISOString().slice(0, 16),
    description: '実サービス疎通・生成・編集・保存の検証専用。自動削除しません。',
  });
  report.projectId = p.id;
  const root = '/projects/' + p.id;
  async function instruct(prompt: string) {
    const started: Job = await json(root + '/ai', 'POST', {
      prompt,
      provider: selected!.provider,
      allowCommands: false,
    });
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      const jobs: Job[] = await json(root + '/jobs');
      const job = jobs.find((j) => j.id === started.id);
      if (job?.status === 'failed')
        throw new Error(`AI job failed (${job.id}). アプリのジョブ履歴で詳細を確認してください。`);
      if (job?.status === 'complete') return job;
      await delay(2000);
    }
    throw new Error(
      'AI応答の待機上限に達しました。ジョブはサーバー側で継続している可能性があります。',
    );
  }
  const marker = randomUUID();
  const first = await instruct(
    'ファイルを変更せず、POCKETFORGE_CONNECTION_OK とだけ応答してください。コマンドは実行しないでください。',
  );
  assert.ok(
    first.result.includes('POCKETFORGE_CONNECTION_OK'),
    'Expected connection marker missing',
  );
  assert.deepEqual(
    (await json(root)).files,
    p.files,
    'Connection-only prompt changed project files',
  );
  report.checks.push('real_provider_response');
  console.log('1/3 実際のAI応答を確認');
  const path = 'src/connection-check.ts';
  const content = `export const connectionCheck = ${JSON.stringify(marker)};\nexport const revision = 1;\n`;
  await instruct(
    `${path} を新規作成してください。内容は次のJSON文字列をデコードした文字列と完全に一致させ、末尾改行も保存してください。他のファイルは変更せず、コマンドも実行しないでください。\n${JSON.stringify(content)}`,
  );
  const created: Project = await json(root);
  assert.equal(created.files[path], content);
  assert.ok(created.revision > p.revision);
  report.checks.push('ai_file_creation');
  console.log('2/3 ファイル生成と保存を確認');
  const edited = content.replace('revision = 1', 'revision = 2');
  await instruct(
    `${path} を読み、revision = 1 を revision = 2 に変更して保存してください。それ以外の文字や他のファイルは変更せず、コマンドも実行しないでください。`,
  );
  await json('/auth/logout', 'POST');
  token = '';
  await login();
  const saved: Project = await json(root);
  assert.equal(saved.files[path], edited);
  assert.ok(saved.revision > created.revision);
  const remaining = { ...saved.files };
  delete remaining[path];
  assert.deepEqual(remaining, p.files, 'Unrelated files changed');
  const history = await json(root + '/history');
  assert.ok(history.length >= 3, 'Saved history missing');
  const ticket = await json(root + '/export', 'POST', {});
  const archive = await request(ticket.path.replace(/^\/api/, ''));
  assert.equal(strFromU8(unzipSync(new Uint8Array(await archive.arrayBuffer()))[path]), edited);
  report.checks.push(
    'ai_file_edit',
    'reauthenticated_readback',
    'saved_history',
    'exported_file_content',
  );
  report.revisions = [p.revision, created.revision, saved.revision];
  report.status = 'passed';
  console.log('3/3 編集・再ログイン後の保存・履歴・ZIP内容を確認');
} catch (error) {
  if (report.status !== 'needs_api_key') report.status = 'failed';
  // Never persist raw API response bodies, credentials or tokens.
  report.error = error instanceof Error ? error.message.slice(0, 1000) : 'Verification failed';
  console.error(report.error);
  process.exitCode = report.status === 'needs_api_key' ? 2 : 1;
} finally {
  if (token) await json('/auth/logout', 'POST').catch(() => {});
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log('検証記録: ' + output);
}
