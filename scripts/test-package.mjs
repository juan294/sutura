import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'sutura-package-'));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function packedFilename(output) {
  const parsed = JSON.parse(output);
  if (Array.isArray(parsed)) return parsed[0]?.filename;
  if (parsed && typeof parsed === 'object') {
    if (typeof parsed.filename === 'string') return parsed.filename;
    const first = Object.values(parsed)[0];
    if (first && typeof first === 'object') return first.filename;
  }
  return undefined;
}

try {
  const output = run('npm', [
    'pack', join(root, 'packages', 'cli'), '--json', '--pack-destination', temporary,
  ]);
  const filename = packedFilename(output);
  if (!filename) throw new Error('npm pack did not return a filename');
  const tarball = join(temporary, filename);
  const consumer = join(temporary, 'consumer');
  mkdirSync(join(consumer, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(consumer, 'package.json'), '{"name":"consumer","private":true}\n');
  writeFileSync(join(consumer, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\n');
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: consumer });
  const binary = join(consumer, 'node_modules', '.bin', 'sutura');
  const environment = { ...process.env };
  for (const name of ['NEBIUS_API_KEY', 'CONTREE_TOKEN', 'CONTREE_PROJECT', 'TAVILY_API_KEY']) {
    delete environment[name];
  }
  run(binary, ['init', '--workflow', 'CI'], { cwd: consumer, env: environment });
  const workflow = readFileSync(join(consumer, '.github', 'workflows', 'sutura.yml'), 'utf8');
  if (!workflow.includes('uses: juan294/sutura@v0.1.1')) {
    throw new Error('installed CLI generated the wrong Action release reference');
  }
  if (run(binary, ['--version'], { cwd: consumer }).trim() !== '0.1.1') {
    throw new Error('installed CLI returned the wrong version');
  }
  const manifest = JSON.parse(readFileSync(join(consumer, 'node_modules', 'sutura', 'package.json'), 'utf8'));
  if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
    throw new Error('published CLI contains runtime dependencies');
  }
  const license = readFileSync(join(consumer, 'node_modules', 'sutura', 'LICENSE'), 'utf8');
  if (license !== readFileSync(join(root, 'LICENSE'), 'utf8')) {
    throw new Error('published CLI license differs from the repository license');
  }
  process.stdout.write('[PASS] Packed CLI installs and configures a clean repository.\n');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
