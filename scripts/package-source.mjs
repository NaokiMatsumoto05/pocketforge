import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, unzipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const excluded = new Set([
  'node_modules',
  '.git',
  '.expo',
  'dist',
  'work',
  'coverage',
  'ios',
  'android',
  '.DS_Store',
  'vault.key',
]);
const skip = (name) =>
  excluded.has(name) ||
  name.startsWith('.data') ||
  name.includes('.sqlite') ||
  name.endsWith('.log') ||
  (name.startsWith('.env') && !name.endsWith('.example'));
const files = {};
function collect(dir, prefix = '') {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip(entry.name) || entry.isSymbolicLink()) continue;
    const path = prefix + entry.name;
    if (entry.isDirectory()) collect(join(dir, entry.name), path + '/');
    else if (entry.isFile()) files['pocketforge/' + path] = readFileSync(join(dir, entry.name));
  }
}
collect(root);
const archive = zipSync(files, { level: 6 });
const names = Object.keys(unzipSync(archive));
if (names.some((path) => path.split('/').some(skip)))
  throw new Error('Archive includes excluded data');
for (const path of [
  'AGENTS.md',
  'docs/PROGRESS.md',
  'docs/IPHONE_TEST.md',
  'apps/mobile/app.json',
]) {
  if (!names.includes('pocketforge/' + path)) throw new Error('Archive missing ' + path);
}
const output = join(dirname(root.replace(/\/$/, '')), 'pocketforge-source.zip');
writeFileSync(output, archive);
console.log(`Saved ${names.length} source files; private data excluded: ${output}`);
