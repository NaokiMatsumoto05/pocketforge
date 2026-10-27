import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// EAS must archive this monorepo, not just apps/mobile or the parent Documents folder.
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync('npx', ['--yes', 'eas-cli@25.3.0', ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL('../apps/mobile/', import.meta.url)),
  stdio: 'inherit',
  env: { ...process.env, EAS_NO_VCS: '1', EAS_PROJECT_ROOT: root },
});
if (result.error)
  console.error('EAS CLIを開始できません。Node.jsとネットワークを確認してください。');
process.exitCode = result.status ?? 1;
