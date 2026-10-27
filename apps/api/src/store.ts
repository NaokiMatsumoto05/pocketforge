import { DatabaseSync } from 'node:sqlite';
import { SQLiteDatabase, PostgresDatabase, type Database } from './database.ts';
import {
  randomUUID,
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  INTEGRATION_PROVIDERS,
  filePath,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_PROJECT_BYTES,
  templateFiles,
  type Files,
  type Project,
  type Job,
} from '@pocketforge/core';
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export function validateFiles(files: Files) {
  const entries = Object.entries(files);
  if (entries.length > MAX_FILES) throw new AppError(413, 'ファイル数の上限は250です。');
  let bytes = 0;
  for (const [p, c] of entries) {
    filePath.parse(p);
    if (typeof c !== 'string') throw new AppError(400, 'テキストファイルのみ対応しています。');
    const n = Buffer.byteLength(c);
    if (n > MAX_FILE_BYTES) throw new AppError(413, `${p} は512KBを超えています。`);
    bytes += n;
  }
  if (bytes > MAX_PROJECT_BYTES) throw new AppError(413, 'プロジェクトの上限は4MBです。');
}
export class Store {
  private constructor(
    public db: Database,
    private key: Buffer,
  ) {}
  static async open(dir: string, vaultKey?: string, recoverJobs = true, databaseUrl?: string) {
    if (vaultKey && !/^[a-fA-F0-9]{64}$/.test(vaultKey))
      throw new Error('VAULT_KEY must be 64 hex characters');
    if (databaseUrl && !vaultKey) throw new Error('PostgreSQL requires a fixed VAULT_KEY.');
    let key: Buffer;
    let db: Database;
    if (databaseUrl) {
      key = Buffer.from(vaultKey!, 'hex');
      db = await PostgresDatabase.open(databaseUrl);
    } else {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const keyFile = join(dir, 'vault.key');
      if (!vaultKey && !existsSync(keyFile))
        writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
      key = vaultKey ? Buffer.from(vaultKey, 'hex') : readFileSync(keyFile);
      const raw = new DatabaseSync(join(dir, 'pocketforge.sqlite'));
      raw.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,userId TEXT REFERENCES users(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,owner TEXT REFERENCES users(id),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,projectId TEXT REFERENCES projects(id),label TEXT,revision INTEGER,createdAt TEXT,files TEXT);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,projectId TEXT REFERENCES projects(id),kind TEXT,message TEXT,createdAt TEXT);
      CREATE TABLE IF NOT EXISTS integrations(owner TEXT REFERENCES users(id),provider TEXT,secret TEXT,model TEXT,PRIMARY KEY(owner,provider));
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,projectId TEXT REFERENCES projects(id),data TEXT);
    `);
      db = new SQLiteDatabase(raw);
    }
    const store = new Store(db, key);
    try {
      if (recoverJobs) {
        for (const row of await db.all('SELECT id,data FROM jobs')) {
          const job: Job = JSON.parse(row.data);
          if (job.status === 'running')
            await store.finishJob(
              job,
              'failed',
              'サーバーが再起動しました。保存済みファイルと履歴を確認してください。',
            );
        }
      }
      return store;
    } catch (e) {
      await db.close();
      throw e;
    }
  }
  private transaction<T>(work: (store: Store) => Promise<T>) {
    return this.db.transaction((db) => work(new Store(db, this.key)));
  }
  private async lockProject(owner: string, id: string) {
    if (this.db.kind === 'postgres')
      await this.db.get('SELECT id FROM projects WHERE id=? AND owner=? FOR UPDATE', id, owner);
  }
  close() {
    return this.db.close();
  }
  async createUser(name: string, password: string) {
    const id = randomUUID(),
      salt = randomBytes(16).toString('hex');
    const digest = scryptSync(password, salt, 64).toString('hex');
    try {
      await this.db.run('INSERT INTO users VALUES(?,?,?)', id, name, `${salt}:${digest}`);
    } catch (e: any) {
      if (e.code !== '23505' && e.errcode !== 2067) throw e;
      throw new AppError(409, 'このユーザー名は使用されています。');
    }
    return { id, name };
  }
  async login(name: string, password: string) {
    const u = (await this.db.get('SELECT * FROM users WHERE name=?', name)) as any;
    const [salt, digest] = (
      u?.password ?? '00000000000000000000000000000000:' + '0'.repeat(128)
    ).split(':');
    const actual = scryptSync(password, salt, 64);
    if (!u || !timingSafeEqual(actual, Buffer.from(digest, 'hex')))
      throw new AppError(401, 'ユーザー名またはパスワードが違います。');
    return { id: u.id as string, name: u.name as string };
  }
  async session(userId: string) {
    const token = randomBytes(32).toString('base64url');
    await this.db.run('DELETE FROM sessions WHERE expires<?', Date.now());
    await this.db.run(
      'INSERT INTO sessions VALUES(?,?,?)',
      this.hash(token),
      userId,
      Date.now() + 7 * 86400000,
    );
    return token;
  }
  hash(v: string) {
    return createHash('sha256').update(v).digest('hex');
  }
  async authenticate(token: string) {
    return (await this.db.get(
      'SELECT users.id,users.name FROM sessions JOIN users ON sessions."userId"=users.id WHERE hash=? AND expires>?',
      this.hash(token),
      Date.now(),
    )) as
      | {
          id: string;
          name: string;
        }
      | undefined;
  }
  async logout(token: string) {
    await this.db.run('DELETE FROM sessions WHERE hash=?', this.hash(token));
  }
  async list(owner: string) {
    return ((await this.db.all('SELECT data FROM projects WHERE owner=?', owner)) as any[])
      .map((r) => JSON.parse(r.data) as Project)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ files, ...p }) => ({ ...p, fileCount: Object.keys(files).length }));
  }
  async project(owner: string, id: string): Promise<Project> {
    const row = (await this.db.get(
      'SELECT data FROM projects WHERE id=? AND owner=?',
      id,
      owner,
    )) as any;
    if (!row) throw new AppError(404, 'プロジェクトが見つかりません。');
    return JSON.parse(row.data);
  }
  create(owner: string, name: string, description: string) {
    return this.transaction(async (tx) => {
      if (tx.db.kind === 'postgres')
        await tx.db.get('SELECT id FROM users WHERE id=? FOR UPDATE', owner);
      if ((await tx.list(owner)).length >= 30)
        throw new AppError(429, 'プロジェクトは30件までです。');
      const now = new Date().toISOString();
      const p: Project = {
        id: randomUUID(),
        name,
        description,
        files: templateFiles(name),
        revision: 1,
        createdAt: now,
        updatedAt: now,
        sandboxId: null,
        sandboxState: 'stopped',
        sandboxExpiresAt: null,
      };
      await tx.db.run('INSERT INTO projects VALUES(?,?,?)', p.id, owner, JSON.stringify(p));
      await tx.snapshot(p, 'プロジェクトを作成');
      await tx.event(p.id, 'create', 'Expoプロジェクトを作成しました。');
      return p;
    });
  }
  async snapshot(p: Project, label: string) {
    await this.db.run(
      'INSERT INTO snapshots VALUES(?,?,?,?,?,?)',
      randomUUID(),
      p.id,
      label.slice(0, 160),
      p.revision,
      new Date().toISOString(),
      JSON.stringify(p.files),
    );
  }
  save(owner: string, id: string, files: Files, revision: number, label: string) {
    validateFiles(files);
    return this.transaction(async (tx) => {
      await tx.lockProject(owner, id);
      const p = await tx.project(owner, id);
      if (p.revision !== revision)
        throw new AppError(
          409,
          '別の操作で更新されています。下書きは保持しました。最新の内容を読み直してください。',
        );
      if (JSON.stringify(p.files) === JSON.stringify(files)) return p;
      if ((await tx.history(owner, id)).length >= 1000)
        throw new AppError(
          413,
          '履歴の上限に達しました。エクスポートして新しいプロジェクトへ移してください。',
        );
      const usage = (await tx.db.get(
        tx.db.kind === 'postgres'
          ? 'SELECT COALESCE(SUM(octet_length(files)),0)::integer AS bytes FROM snapshots WHERE "projectId"=?'
          : 'SELECT COALESCE(SUM(length(CAST(files AS BLOB))),0) AS bytes FROM snapshots WHERE "projectId"=?',
        id,
      )) as {
        bytes: number;
      };
      if (usage.bytes + Buffer.byteLength(JSON.stringify(files)) > 64 * 1024 * 1024)
        throw new AppError(
          413,
          '履歴の容量上限64MBに達しました。エクスポート後に新しいプロジェクトを作成してください。',
        );
      p.files = files;
      p.revision++;
      p.updatedAt = new Date().toISOString();
      await tx.db.run('UPDATE projects SET data=? WHERE id=?', JSON.stringify(p), id);
      await tx.snapshot(p, label);
      await tx.event(id, 'change', label);
      return p;
    });
  }
  updateRuntime(
    owner: string,
    id: string,
    patch: Partial<Pick<Project, 'sandboxId' | 'sandboxState' | 'sandboxExpiresAt'>>,
  ) {
    return this.transaction(async (tx) => {
      await tx.lockProject(owner, id);
      const p = await tx.project(owner, id);
      Object.assign(p, patch);
      await tx.db.run('UPDATE projects SET data=? WHERE id=?', JSON.stringify(p), id);
      return p;
    });
  }
  async history(owner: string, id: string) {
    await this.project(owner, id);
    return await this.db.all(
      'SELECT id,label,revision,"createdAt" FROM snapshots WHERE "projectId"=? ORDER BY revision DESC',
      id,
    );
  }
  async historical(owner: string, id: string, snapshotId: string): Promise<Files> {
    await this.project(owner, id);
    const r = (await this.db.get(
      'SELECT files FROM snapshots WHERE "projectId"=? AND id=?',
      id,
      snapshotId,
    )) as any;
    if (!r) throw new AppError(404, '履歴が見つかりません。');
    return JSON.parse(r.files);
  }
  async event(projectId: string, kind: string, message: string) {
    await this.db.run(
      'INSERT INTO events("projectId",kind,message,"createdAt") VALUES(?,?,?,?)',
      projectId,
      kind,
      message.slice(0, 12000),
      new Date().toISOString(),
    );
  }
  async events(owner: string, id: string, after: number) {
    await this.project(owner, id);
    return (
      await this.db.all(
        'SELECT * FROM events WHERE "projectId"=? AND id>? ORDER BY id LIMIT 500',
        id,
        after,
      )
    ).map((row) => ({ ...row, id: Number(row.id) }));
  }
  async setSecret(owner: string, provider: string, secret: string, model: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const value = [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64')).join('.');
    await this.db.run(
      'INSERT INTO integrations VALUES(?,?,?,?) ON CONFLICT(owner,provider) DO UPDATE SET secret=excluded.secret,model=excluded.model',
      owner,
      provider,
      value,
      model,
    );
  }
  async deleteSecret(owner: string, provider: string) {
    await this.db.run('DELETE FROM integrations WHERE owner=? AND provider=?', owner, provider);
  }
  async secret(
    owner: string,
    provider: string,
  ): Promise<{
    key: string;
    model: string;
  } | null> {
    const r = (await this.db.get(
      'SELECT secret,model FROM integrations WHERE owner=? AND provider=?',
      owner,
      provider,
    )) as any;
    if (!r) return null;
    return { key: this.decrypt(r.secret), model: r.model };
  }

  async connections(owner: string) {
    const rows = await this.db.all('SELECT provider,model FROM integrations WHERE owner=?', owner);
    return INTEGRATION_PROVIDERS.map((provider) => {
      const r = rows.find((row) => row.provider === provider);
      return { provider, configured: !!r, model: r?.model ?? '' };
    });
  }
  async redactor(owner: string) {
    const rows = await this.db.all('SELECT secret FROM integrations WHERE owner=?', owner);
    const keys = rows.map((row) => this.decrypt(row.secret));
    return (text: string) => {
      for (const key of keys) if (key) text = text.split(key).join('[REDACTED]');
      return text;
    };
  }
  async redact(owner: string, text: string) {
    return (await this.redactor(owner))(text);
  }
  private decrypt(secret: string) {
    const [iv, tag, enc] = secret.split('.').map((s) => Buffer.from(s, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
  async createJob(projectId: string, kind: string): Promise<Job> {
    const job: Job = {
      id: randomUUID(),
      projectId,
      kind,
      status: 'running',
      result: '',
      createdAt: new Date().toISOString(),
    };
    await this.db.run(
      'INSERT INTO jobs(id,"projectId",data) VALUES(?,?,?)',
      job.id,
      projectId,
      JSON.stringify(job),
    );
    return job;
  }
  async finishJob(job: Job, status: Job['status'], result: string) {
    job.status = status;
    job.result = result.slice(0, 50000);
    await this.db.run('UPDATE jobs SET data=? WHERE id=?', JSON.stringify(job), job.id);
  }
  async jobs(owner: string, id: string) {
    await this.project(owner, id);
    return (
      (await this.db.all(
        this.db.kind === 'postgres'
          ? 'SELECT data FROM jobs WHERE "projectId"=? ORDER BY seq DESC LIMIT 30'
          : 'SELECT data FROM jobs WHERE "projectId"=? ORDER BY rowid DESC LIMIT 30',
        id,
      )) as any[]
    ).map((r) => JSON.parse(r.data) as Job);
  }
}
