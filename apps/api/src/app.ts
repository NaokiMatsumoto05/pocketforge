import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createTwoFilesPatch } from 'diff';
import {
  AI_PROVIDERS,
  INTEGRATION_PROVIDERS,
  isAIProvider,
  designSchema,
  generateDesign,
  readDesign,
  filePath,
  type Files,
} from '@pocketforge/core';
import { Store, AppError } from './store.ts';
import { E2BRuntime, type Runtime } from './sandbox.ts';
import { runAgent, createProvider } from './agent.ts';
export type AppOptions = {
  dataDir: string;
  databaseUrl?: string;
  vaultKey?: string;
  origins?: string[];
  production?: boolean;
  allowRegistration?: boolean;
  staticDir?: string;
  runtime?: (s: Store) => Runtime;
  trustProxy?: string | number;
};
export async function buildApp(options: AppOptions) {
  const app = Fastify({
    logger: false,
    bodyLimit: 6 * 1024 * 1024,
    trustProxy:
      typeof options.trustProxy === 'number'
        ? (_address, hop) => hop < (options.trustProxy as number)
        : (options.trustProxy ?? false),
  });
  const store = await Store.open(options.dataDir, options.vaultKey, true, options.databaseUrl);
  const runtime =
    options.runtime?.(store) ??
    new E2BRuntime(
      store,
      Number(process.env.SANDBOX_TIMEOUT_MS) || 600000,
      process.env.E2B_TEMPLATE || 'base',
    );
  const origins = options.origins ?? [
    'http://localhost:4310',
    'http://127.0.0.1:4310',
    'http://localhost:8081',
  ];
  const locks = new Map<string, string>();
  const downloads = new Map<
    string,
    {
      owner: string;
      id: string;
      expires: number;
    }
  >();
  await app.register(cookie);
  await app.register(cors, { origin: origins, credentials: true });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", ...origins],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: options.production ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      if (options.production && req.url.split('?')[0] !== '/api/health' && req.protocol !== 'https')
        throw new AppError(403, 'HTTPSで接続してください。');
      if (req.headers.origin && !origins.includes(req.headers.origin))
        throw new AppError(403, 'この接続元は許可されていません。');
      if (req.headers['sec-fetch-site'] === 'cross-site')
        throw new AppError(403, 'クロスサイト要求は許可されていません。');
    }
  });
  app.setErrorHandler((e, req, reply) => {
    const error = e as any;
    const status =
      e instanceof z.ZodError
        ? 400
        : error.statusCode >= 400 && error.statusCode <= 599
          ? error.statusCode
          : 500;
    reply.status(status).send({
      error:
        e instanceof z.ZodError
          ? e.issues[0]?.message
          : status === 500
            ? '処理に失敗しました。保存状態を確認して再試行してください。'
            : error.message,
    });
  });
  const token = (req: any) =>
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : req.headers['x-client'] === 'mobile'
        ? ''
        : req.cookies.pf_session) || '';
  const user = async (req: any) => {
    const u = await store.authenticate(token(req));
    if (!u) throw new AppError(401, 'ログインしてください。');
    return u;
  };
  const id = (req: any) => z.uuid().parse(req.params.id);
  const writable = (pid: string) => {
    if (locks.has(pid))
      throw new AppError(409, 'AIまたはクラウドが作業中です。完了後に保存してください。');
  };
  const revision = z.number().int().positive();
  const pending = new Set<Promise<void>>();
  async function mutate<T>(pid: string, work: () => Promise<T>): Promise<T> {
    writable(pid);
    locks.set(pid, 'saving');
    try {
      return await work();
    } finally {
      locks.delete(pid);
    }
  }
  async function launch(owner: string, pid: string, kind: string, fn: () => Promise<string>) {
    await store.project(owner, pid);
    writable(pid);
    locks.set(pid, 'starting');
    try {
      const redact = await store.redactor(owner);
      const job = await store.createJob(pid, kind);
      locks.set(pid, job.id);
      const task = (async () => {
        try {
          await store.finishJob(job, 'complete', redact(await fn()));
        } catch (e) {
          const msg = redact(e instanceof Error ? e.message : String(e));
          await store.finishJob(job, 'failed', msg);
          await store.event(pid, 'error', msg);
        }
      })()
        .catch(() => {
          console.error('Background job could not be persisted.');
        })
        .finally(() => {
          locks.delete(pid);
          pending.delete(task);
        });
      pending.add(task);
      return job;
    } catch (e) {
      locks.delete(pid);
      throw e;
    }
  }
  app.get('/api/health', async () => ({
    service: 'pocketforge',
    status: 'ok',
    version: '0.1.0',
    storage: store.db.kind,
    runtime: 'e2b',
    mode: options.production ? 'production' : 'local',
    registrationAllowed: options.allowRegistration !== false,
  }));
  const credentials = z.object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[\p{L}\p{N}_ -]+$/u),
    password: z.string().min(10).max(128),
  });
  for (const mode of ['register', 'login'] as const)
    app.post(
      `/api/auth/${mode}`,
      { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const { name, password } = credentials.parse(req.body);
        if (mode === 'register' && options.allowRegistration === false)
          throw new AppError(403, '新規登録は停止しています。');
        const u =
          mode === 'register'
            ? await store.createUser(name, password)
            : await store.login(name, password);
        const t = await store.session(u.id);
        if (req.headers['x-client'] !== 'mobile')
          reply.setCookie('pf_session', t, {
            httpOnly: true,
            sameSite: 'strict',
            secure: !!options.production,
            path: '/',
            maxAge: 604800,
          });
        return { user: u, ...(req.headers['x-client'] === 'mobile' ? { token: t } : {}) };
      },
    );
  app.get('/api/auth/me', async (req) => ({ user: await user(req) }));
  app.post('/api/auth/logout', async (req, reply) => {
    await store.logout(token(req));
    reply.clearCookie('pf_session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/integrations', async (req) => await store.connections((await user(req)).id));
  app.put('/api/integrations/:provider', async (req) => {
    const u = await user(req),
      provider = z.enum(INTEGRATION_PROVIDERS).parse((req.params as any).provider);
    const b = z
      .object({
        key: z.string().trim().min(8).max(2048),
        model: z.string().trim().max(100).default(''),
      })
      .parse(req.body);
    if (isAIProvider(provider) && !b.model)
      throw new AppError(400, '利用するモデルIDを入力してください。');
    await store.setSecret(u.id, provider, b.key, b.model);
    return { ok: true };
  });
  app.delete('/api/integrations/:provider', async (req) => {
    const provider = z.enum(INTEGRATION_PROVIDERS).parse((req.params as any).provider);
    await store.deleteSecret((await user(req)).id, provider);
    return { ok: true };
  });
  app.get('/api/projects', async (req) => await store.list((await user(req)).id));
  app.post('/api/projects', async (req) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(60),
        description: z.string().trim().max(400).default(''),
      })
      .parse(req.body);
    return await store.create((await user(req)).id, b.name, b.description);
  });
  app.get('/api/projects/:id', async (req) => {
    const p = await store.project((await user(req)).id, id(req));
    return {
      ...p,
      sandboxState:
        p.sandboxState === 'running' && (p.sandboxExpiresAt ?? 0) < Date.now()
          ? 'paused'
          : p.sandboxState,
      busy: locks.has(p.id),
    };
  });
  app.put('/api/projects/:id/file', async (req) => {
    const uid = (await user(req)).id,
      pid = id(req);
    return mutate(pid, async () => {
      const b = z.object({ path: filePath, content: z.string(), revision }).parse(req.body);
      const p = await store.project(uid, pid);
      return await store.save(
        uid,
        pid,
        { ...p.files, [b.path]: b.content },
        b.revision,
        `編集: ${b.path}`,
      );
    });
  });
  app.delete('/api/projects/:id/file', async (req) => {
    const uid = (await user(req)).id,
      pid = id(req);
    return mutate(pid, async () => {
      const b = z.object({ path: filePath, revision }).parse(req.body);
      const p = await store.project(uid, pid),
        files = { ...p.files };
      if (!(b.path in files)) throw new AppError(404, 'ファイルが見つかりません。');
      delete files[b.path];
      return await store.save(uid, pid, files, b.revision, `削除: ${b.path}`);
    });
  });
  app.post('/api/projects/:id/rename', async (req) => {
    const uid = (await user(req)).id,
      pid = id(req);
    return mutate(pid, async () => {
      const b = z.object({ from: filePath, to: filePath, revision }).parse(req.body);
      const p = await store.project(uid, pid);
      const moving = Object.keys(p.files).filter((x) => x === b.from || x.startsWith(b.from + '/'));
      if (!moving.length) throw new AppError(404, '対象が見つかりません。');
      const files = { ...p.files };
      for (const old of moving) {
        const next = b.to + old.slice(b.from.length);
        filePath.parse(next);
        if (next in files && !moving.includes(next))
          throw new AppError(409, '同名ファイルがあります。');
        delete files[old];
      }
      for (const old of moving) files[b.to + old.slice(b.from.length)] = p.files[old];
      return await store.save(uid, pid, files, b.revision, `名前変更: ${b.from} → ${b.to}`);
    });
  });
  app.put('/api/projects/:id/design', async (req) => {
    const uid = (await user(req)).id,
      pid = id(req);
    return mutate(pid, async () => {
      const b = z.object({ design: designSchema, revision }).parse(req.body);
      const p = await store.project(uid, pid);
      if (!readDesign(p.files)?.supported)
        throw new AppError(
          409,
          'コンポーネントが手動編集されています。履歴から対応する状態に戻すとデザイン編集を再開できます。',
        );
      return await store.save(
        uid,
        pid,
        {
          ...p.files,
          'design.json': JSON.stringify(b.design, null, 2) + '\n',
          'src/HomeScreen.tsx': generateDesign(b.design),
        },
        b.revision,
        'デザインを更新',
      );
    });
  });
  app.get(
    '/api/projects/:id/history',
    async (req) => await store.history((await user(req)).id, id(req)),
  );
  app.get('/api/projects/:id/diff/:snapshot', async (req) => {
    const uid = (await user(req)).id,
      pid = id(req),
      p = await store.project(uid, pid);
    const old = await store.historical(uid, pid, z.uuid().parse((req.params as any).snapshot));
    return {
      diff: [...new Set([...Object.keys(old), ...Object.keys(p.files)])]
        .filter((path) => old[path] !== p.files[path])
        .map((path) => createTwoFilesPatch(path, path, old[path] ?? '', p.files[path] ?? ''))
        .join('\n'),
    };
  });
  app.post('/api/projects/:id/restore', async (req) => {
    const uid = (await user(req)).id,
      pid = id(req);
    return mutate(pid, async () => {
      const b = z.object({ snapshotId: z.uuid(), revision }).parse(req.body);
      return await store.save(
        uid,
        pid,
        await store.historical(uid, pid, b.snapshotId),
        b.revision,
        '以前の状態から復元',
      );
    });
  });
  app.get(
    '/api/projects/:id/events',
    async (req) =>
      await store.events(
        (await user(req)).id,
        id(req),
        z.coerce
          .number()
          .int()
          .nonnegative()
          .parse((req.query as any).after ?? 0),
      ),
  );
  app.get('/api/projects/:id/jobs', async (req) => await store.jobs((await user(req)).id, id(req)));
  app.post('/api/projects/:id/export', async (req) => {
    const uid = (await user(req)).id,
      pid = id(req);
    await store.project(uid, pid);
    for (const [key, value] of downloads) if (value.expires < Date.now()) downloads.delete(key);
    const key = randomBytes(24).toString('base64url');
    downloads.set(key, { owner: uid, id: pid, expires: Date.now() + 60000 });
    return { path: `/api/download/${key}` };
  });
  app.get('/api/download/:ticket', async (req, reply) => {
    const key = (req.params as any).ticket,
      entry = downloads.get(key);
    if (!entry || entry.expires < Date.now())
      throw new AppError(404, 'ダウンロードリンクの期限が切れました。');
    downloads.delete(key);
    const p = await store.project(entry.owner, entry.id);
    const archive = zipSync(
      Object.fromEntries(Object.entries(p.files).map(([path, c]) => [path, strToU8(c)])),
    );
    return reply
      .header('Content-Disposition', 'attachment; filename="pocketforge-project.zip"')
      .type('application/zip')
      .send(Buffer.from(archive));
  });
  for (const action of ['start', 'pause'] as const)
    app.post(`/api/projects/:id/runtime/${action}`, async (req) => {
      const uid = (await user(req)).id,
        pid = id(req);
      if (action === 'start') z.object({ confirmed: z.literal(true) }).parse(req.body);
      return launch(uid, pid, 'runtime', () => runtime[action](uid, pid));
    });
  app.post('/api/projects/:id/command', async (req) => {
    const uid = (await user(req)).id,
      pid = id(req);
    const b = z.object({ command: z.string().trim().min(1).max(4000) }).parse(req.body);
    return launch(uid, pid, 'command', () => runtime.run(uid, pid, b.command));
  });
  app.post('/api/projects/:id/ai', async (req) => {
    const uid = (await user(req)).id,
      pid = id(req);
    await store.project(uid, pid);
    const b = z
      .object({
        prompt: z.string().trim().min(1).max(12000),
        provider: z.enum(AI_PROVIDERS),
        allowCommands: z.boolean().default(false),
      })
      .parse(req.body);
    const c = await store.secret(uid, b.provider);
    if (!c) throw new AppError(503, '設定からAIのAPIキーとモデルを接続してください。');
    const provider = createProvider(b.provider, c.key, c.model);
    return launch(uid, pid, 'ai', () =>
      runAgent(store, runtime, uid, pid, b.prompt, provider, b.allowCommands),
    );
  });
  app.post('/api/projects/:id/build', async (req) => {
    const uid = (await user(req)).id,
      pid = id(req);
    const b = z
      .object({ platform: z.enum(['ios', 'android']), confirmed: z.literal(true) })
      .parse(req.body);
    return launch(uid, pid, 'build', () => runtime.build(uid, pid, b.platform));
  });
  app.post('/api/projects/:id/build-status', async (req) => {
    const uid = (await user(req)).id,
      pid = id(req);
    return launch(uid, pid, 'build-status', () => runtime.buildStatus(uid, pid));
  });
  if (options.staticDir && existsSync(join(options.staticDir, 'index.html'))) {
    await app.register(staticFiles, { root: options.staticDir });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.status(404).send({ error: 'APIが見つかりません。' })
        : reply.sendFile('index.html'),
    );
  }
  app.addHook('onClose', async () => {
    await Promise.allSettled(pending);
    await store.close();
  });
  return { app, store, locks };
}
