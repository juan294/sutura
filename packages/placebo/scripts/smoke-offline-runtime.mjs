import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const platform = `${process.platform}-${process.arch}`;
const archive = join(packageRoot, 'vendor', `placebo-test-runtime-${platform}-node_modules.tgz`);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'placebo-offline-smoke-'));
const fixture = join(temporaryRoot, 'fixture');
const emptyStore = join(temporaryRoot, 'empty-store');

try {
  await cp(join(packageRoot, 'corpus', 'repair-off-by-one', 'fixture'), fixture, { recursive: true });
  await execute('tar', ['-xzf', archive, '-C', fixture]);
  const modulesFile = join(fixture, 'node_modules', '.modules.yaml');
  const modules = JSON.parse(await readFile(modulesFile, 'utf8'));
  modules.storeDir = join(emptyStore, 'v11');
  await writeFile(modulesFile, `${JSON.stringify(modules, null, 2)}\n`);
  await execute('pnpm', [
    'install', '--ignore-workspace', '--offline', '--frozen-lockfile',
    '--ignore-scripts', '--trust-lockfile', '--store-dir', emptyStore,
  ], { cwd: fixture, env: { PATH: process.env.PATH, CI: '1' } });
  await execute('pnpm', ['test'], { cwd: fixture, env: { PATH: process.env.PATH, CI: '1' } });
  process.stdout.write(`offline runtime smoke passed on ${platform}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
