import { Sandbox } from 'e2b';
import { type Files } from '@pocketforge/core';
import { Store, AppError, validateFiles } from './store.ts';
const ROOT = '/home/user/project';
const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
// Executed only inside a per-project microVM, never by the API host.
const EXPORT = `import os,json,stat
root='${ROOT}'
out={}; size=0
for parent,dirs,files in os.walk(root,followlinks=False):
 dirs[:]=[d for d in dirs if d not in ['node_modules','.git','.expo','dist'] and not os.path.islink(os.path.join(parent,d))]
 for name in files:
  path=os.path.join(parent,name)
  if os.path.islink(path) or not stat.S_ISREG(os.stat(path).st_mode): continue
  if name=='.env' or (name.startswith('.env.') and name!='.env.example'): continue
  if os.path.getsize(path)>524288: raise Exception('File exceeds 512KB: '+name)
  try:
   with open(path,encoding='utf-8') as f: content=f.read()
  except UnicodeDecodeError: raise Exception('Binary files are not supported: '+name)
  size+=len(content.encode())
  if size>4194304 or len(out)>=250: raise Exception('Project quota exceeded')
  out[os.path.relpath(path,root)]=content
print(json.dumps(out))`;
export interface Runtime {
  start(owner: string, id: string): Promise<string>;
  pause(owner: string, id: string): Promise<string>;
  run(owner: string, id: string, command: string): Promise<string>;
  build(owner: string, id: string, platform: 'ios' | 'android'): Promise<string>;
  buildStatus(owner: string, id: string): Promise<string>;
}
export class E2BRuntime implements Runtime {
  private startingOwners = new Set<string>();
  constructor(
    private store: Store,
    private timeout = 600000,
    private template = 'base',
  ) {}
  async key(owner: string) {
    const v = await this.store.secret(owner, 'e2b');
    if (!v) throw new AppError(503, '設定からE2BのAPIキーを接続してください。');
    return v.key;
  }
  async existing(owner: string, id: string) {
    const p = await this.store.project(owner, id);
    if (!p.sandboxId || p.sandboxState !== 'running' || (p.sandboxExpiresAt ?? 0) < Date.now())
      throw new AppError(409, 'クラウド環境を先に起動してください。');
    const sb = await Sandbox.connect(p.sandboxId, { apiKey: await this.key(owner) });
    await sb.setTimeout(this.timeout);
    await this.store.updateRuntime(owner, id, { sandboxExpiresAt: Date.now() + this.timeout });
    return sb;
  }
  async push(sb: Sandbox, files: Files) {
    validateFiles(files);
    const data = Buffer.from(JSON.stringify(files)).toString('base64');
    const script = `import os,json,base64,shutil\nroot='${ROOT}'\nos.makedirs(root,exist_ok=True)\nfiles=json.loads(base64.b64decode('${data}'))\nfor parent,dirs,names in os.walk(root,followlinks=False):\n dirs[:]=[d for d in dirs if d not in ['node_modules','.git','.expo','dist']]\n for name in names:\n  p=os.path.join(parent,name); rel=os.path.relpath(p,root)\n  if rel not in files and not name.startswith('.env'): os.unlink(p)\nfor rel,content in files.items():\n p=os.path.join(root,rel)\n if os.path.islink(p): os.unlink(p)\n os.makedirs(os.path.dirname(p),exist_ok=True)\n with open(p,'w',encoding='utf-8') as f:f.write(content)\n`;
    await sb.commands.run('python3 -c ' + quote(script), { timeoutMs: 30000 });
  }
  async pull(owner: string, id: string, sb: Sandbox, label: string) {
    const result = await sb.commands.run('python3 -c ' + quote(EXPORT), { timeoutMs: 30000 });
    const files = JSON.parse(result.stdout) as Files;
    validateFiles(files);
    const p = await this.store.project(owner, id);
    return await this.store.save(owner, id, files, p.revision, label);
  }
  async start(owner: string, id: string) {
    if (this.startingOwners.has(owner)) throw new AppError(409, '別の環境を起動中です。');
    this.startingOwners.add(owner);
    try {
      return await this.startEnvironment(owner, id);
    } finally {
      this.startingOwners.delete(owner);
    }
  }
  private async startEnvironment(owner: string, id: string) {
    const p = await this.store.project(owner, id),
      apiKey = await this.key(owner);
    if (
      (await this.store.list(owner)).some(
        (other) =>
          other.id !== id &&
          other.sandboxState === 'running' &&
          (other.sandboxExpiresAt ?? 0) > Date.now(),
      )
    )
      throw new AppError(
        409,
        '同時に起動できる環境は1つです。他のプロジェクトを一時停止してください。',
      );
    let sb: Sandbox;
    if (p.sandboxId) sb = await Sandbox.connect(p.sandboxId, { apiKey, timeoutMs: this.timeout });
    else
      sb = await Sandbox.create(this.template, {
        apiKey,
        timeoutMs: this.timeout,
        lifecycle: { onTimeout: 'pause' },
        network: {
          allowPublicTraffic: false,
          denyOut: ['0.0.0.0/0'],
          allowOut: [
            'registry.npmjs.org',
            'expo.dev',
            '*.expo.dev',
            '*.expo.io',
            '*.exp.host',
            '*.googleapis.com',
            '*.amazonaws.com',
            'github.com',
            'codeload.github.com',
          ],
        },
        metadata: { projectId: id },
      });
    // Record the ID immediately so a failed upload can be resumed without leaking another VM.
    await this.store.updateRuntime(owner, id, {
      sandboxId: sb.sandboxId,
      sandboxState: 'running',
      sandboxExpiresAt: Date.now() + this.timeout,
    });
    try {
      await this.push(sb, p.files);
    } catch (e) {
      await sb.pause().catch(() => {});
      await this.store.updateRuntime(owner, id, { sandboxState: 'paused', sandboxExpiresAt: null });
      throw e;
    }
    await this.store.event(id, 'runtime', '隔離されたクラウド環境を起動しました。');
    return 'クラウド環境を起動しました。';
  }
  async pause(owner: string, id: string) {
    const sb = await this.existing(owner, id);
    await this.push(sb, (await this.store.project(owner, id)).files);
    await sb.pause();
    await this.store.updateRuntime(owner, id, { sandboxState: 'paused', sandboxExpiresAt: null });
    await this.store.event(
      id,
      'runtime',
      '環境を一時停止しました。ソースと環境は保存されています。',
    );
    return '保存して一時停止しました。';
  }
  async run(owner: string, id: string, command: string) {
    const sb = await this.existing(owner, id);
    await this.push(sb, (await this.store.project(owner, id)).files);
    await this.store.event(id, 'command', `$ ${await this.store.redact(owner, command)}`);
    let output = '',
      used = 0;
    const redact = await this.store.redactor(owner);
    let logs: Promise<void> = Promise.resolve();
    let logError: unknown;
    const log = (chunk: string) => {
      if (used >= 48000) return;
      const text = redact(chunk).slice(0, 48000 - used);
      used += text.length;
      output += text;
      logs = logs
        .then(() => this.store.event(id, 'stdout', text))
        .catch((e) => {
          logError = e;
        });
    };
    let code = 0,
      error: unknown;
    try {
      const r = await sb.commands.run('timeout -k 2s 60s /bin/bash -lc ' + quote(command), {
        cwd: ROOT,
        timeoutMs: 65000,
        onStdout: log,
        onStderr: log,
      });
      code = r.exitCode;
    } catch (e: any) {
      code = e.exitCode ?? 1;
      error = e;
      log(String(e.message ?? 'Command failed'));
    }
    await logs;
    try {
      await this.pull(owner, id, sb, 'ターミナルの変更を保存');
    } catch (e) {
      await this.store.event(
        id,
        'error',
        'ファイル同期に失敗しました。環境は保持されています。上限やファイル形式を確認して再実行してください。',
      );
      throw e;
    }
    if (logError)
      throw new AppError(
        503,
        'コマンドの出力を保存できませんでした。ファイルの保存状態を確認してください。',
      );
    if (error) throw new AppError(422, `終了コード ${code}\n${output}`);
    return `終了コード ${code}\n${output || '(出力なし)'}`;
  }
  async build(owner: string, id: string, platform: 'ios' | 'android') {
    const expo = await this.store.secret(owner, 'expo');
    if (!expo) throw new AppError(503, '設定からExpoアクセストークンを接続してください。');
    const sb = await this.existing(owner, id),
      p = await this.store.project(owner, id);
    let app: any;
    try {
      app = JSON.parse(p.files['app.json']);
    } catch {
      throw new AppError(400, 'app.jsonが必要です。');
    }
    if (!app.expo?.extra?.eas?.projectId)
      throw new AppError(
        400,
        'app.jsonにExpoプロジェクトの extra.eas.projectId を設定してください。',
      );
    if (platform === 'ios' && !app.expo?.ios?.bundleIdentifier)
      throw new AppError(400, 'ios.bundleIdentifierを設定してください。');
    if (platform === 'android' && !app.expo?.android?.package)
      throw new AppError(400, 'android.packageを設定してください。');
    await this.push(sb, p.files);
    const r = await sb.commands.run(
      `npx --yes eas-cli build --platform ${platform} --profile preview --non-interactive --no-wait --json`,
      { cwd: ROOT, envs: { EXPO_TOKEN: expo.key }, timeoutMs: 120000 },
    );
    await this.pull(owner, id, sb, 'EAS Build設定を保存');
    return await this.store.redact(owner, r.stdout + '\n' + r.stderr);
  }
  async buildStatus(owner: string, id: string) {
    const expo = await this.store.secret(owner, 'expo');
    if (!expo) throw new AppError(503, 'Expoを接続してください。');
    const sb = await this.existing(owner, id);
    await this.push(sb, (await this.store.project(owner, id)).files);
    const r = await sb.commands.run(
      'npx --yes eas-cli build:list --limit 5 --non-interactive --json',
      { cwd: ROOT, envs: { EXPO_TOKEN: expo.key }, timeoutMs: 60000 },
    );
    return await this.store.redact(owner, r.stdout);
  }
}
