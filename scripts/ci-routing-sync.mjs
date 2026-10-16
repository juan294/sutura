// Explicit local distribution and read-only drift detection. No GitHub API,
// repository variable, provider, publication or installation side effect by default.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const files = ['ci-routing-v2.mjs', 'ci-routing-workflow-v2.mjs'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const owner = 'sutura';

function regularTarget(root, relative) {
  let path = root;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    let stat;
    try { stat = lstatSync(path); }
    catch (error) { if (error.code === 'ENOENT') return path; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`refusing symlink routing target: ${relative}`);
    if (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) throw new Error(`routing target is not a regular path: ${relative}`);
  }
  return path;
}

function replaceFile(path, bytes) {
  const temporary = `${path}.sutura-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

export function syncRouting({ root, install = false }) {
  root = realpathSync(root);
  for (const relative of ['.github/ci-cadence.json', '.github/sutura-routing.json', ...files.map(file => `scripts/${file}`)]) regularTarget(root, relative);
  const policyPath = join(root, '.github/ci-cadence.json');
  if (!existsSync(policyPath)) throw new Error('existing cadence policy required; standard CI repositories are outside this migration');
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  if (!policy || typeof policy.repository !== 'string') throw new Error('invalid cadence policy repository');
  const markerPath = join(root, '.github/sutura-routing.json');
  const marker = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) : undefined;
  if (marker && (marker.owner !== owner || marker.schemaVersion !== 2)) throw new Error('routing ownership marker is invalid');
  const entries = files.map(file => {
    const source = readFileSync(join(sourceDirectory, file));
    const path = join(root, 'scripts', file);
    const actual = existsSync(path) ? digest(readFileSync(path)) : null;
    return { file, path, source, expected: digest(source), actual };
  });
  const expectedMarker = { schemaVersion: 2, owner, files: Object.fromEntries(entries.map(entry => [`scripts/${entry.file}`, entry.expected])) };
  if (install) {
    // A first install may adopt identical bytes, but never overwrite unrelated
    // pre-existing code merely because it has the expected filename.
    if (!marker && entries.some(entry => entry.actual && entry.actual !== entry.expected)) throw new Error('refusing to overwrite unowned routing code');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    for (const entry of entries) replaceFile(entry.path, entry.source);
    replaceFile(markerPath, `${JSON.stringify(expectedMarker, null, 2)}\n`);
  }
  const differences = entries.filter(entry => !install && entry.actual !== entry.expected).map(({ file, expected, actual }) => ({ file, expected, actual }));
  if (!install && JSON.stringify(marker) !== JSON.stringify(expectedMarker)) differences.push({ file: '.github/sutura-routing.json', reason: 'ownership or pinned source fingerprint differs' });
  return { repository: policy.repository, ok: differences.length === 0, differences };
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), install = args.includes('--install');
  const roots = args.filter(arg => !arg.startsWith('--'));
  if (!roots.length || args.some(arg => arg.startsWith('--') && !['--check', '--install'].includes(arg)) || (install && args.includes('--check'))) {
    console.error('Usage: node scripts/ci-routing-sync.mjs --check ROOT... | --install ROOT...'); process.exitCode = 1;
  } else {
    for (const root of roots) {
      try { const result = syncRouting({ root: resolve(root), install }); console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1; }
      catch (error) { console.error(`${root}: ${error.message}`); process.exitCode = 1; }
    }
  }
}
