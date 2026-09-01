import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const RELEASE_VERSION = '0.2.1';
const SHA_PATTERN = /^[a-f0-9]{40}$/iu;
const execFileAsync = promisify(execFile);

function exactSha(value, label) {
  if (!SHA_PATTERN.test(value ?? '')) throw new Error(`${label} must be an exact 40-character commit`);
  return value.toLowerCase();
}

export function packedFilename(output) {
  const parsed = JSON.parse(output);
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && typeof parsed.filename === 'string'
      ? [parsed]
      : parsed && typeof parsed === 'object'
        ? Object.values(parsed)
        : [];
  const record = records.length === 1 ? records[0] : undefined;
  if (!record || typeof record.filename !== 'string' || record.filename.length === 0) {
    throw new Error('npm pack did not return one filename');
  }
  return record.filename;
}

async function execute(command, args, options = {}) {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 1024 * 1024,
    timeout: 10 * 60_000,
  });
  return stdout;
}

async function packDefault(source, destination) {
  const output = await execute('npm', [
    'pack', source, '--json', '--pack-destination', destination,
  ]);
  return join(destination, packedFilename(output));
}

async function installDefault(tarball, consumer) {
  await execute('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', tarball,
  ], { cwd: consumer });
}

async function invokeDefault(binary, args, consumer, environment) {
  return execute(binary, args, { cwd: consumer, env: environment });
}

async function publicCommitDefault(version, cwd) {
  const tag = `v${version}`;
  const output = await execute('git', [
    'ls-remote', 'https://github.com/juan294/sutura.git',
    `refs/tags/${tag}`, `refs/tags/${tag}^{}`,
  ], { cwd });
  const lines = output.trim().split(/\r?\n/u).filter(Boolean);
  const direct = [];
  const peeled = [];
  for (const line of lines) {
    const match = /^([^\t]+)\t([^\t]+)$/u.exec(line);
    if (!match) throw new Error(`Public Action tag ${tag} returned malformed data`);
    const [, commit = '', ref = ''] = match;
    if (ref === `refs/tags/${tag}`) direct.push(exactSha(commit, `Public Action tag ${tag}`));
    else if (ref === `refs/tags/${tag}^{}`) peeled.push(exactSha(commit, `Public Action tag ${tag}`));
    else throw new Error(`Public Action tag ${tag} returned an unexpected ref`);
  }
  if (direct.length !== 1 || peeled.length > 1) {
    throw new Error(`Public Action tag ${tag} did not resolve uniquely`);
  }
  return peeled[0] ?? direct[0];
}

async function createDoctorShim(directory) {
  const path = join(directory, 'gh');
  await writeFile(path, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'secret' && args[1] === 'list') process.stdout.write('NEBIUS_API_KEY\\nCONTREE_TOKEN\\n');
else if (args[0] === 'variable' && args[1] === 'list') process.stdout.write('CONTREE_PROJECT\\n');
else { process.stderr.write('unsupported read-only gh smoke command\\n'); process.exitCode = 2; }
`);
  await chmod(path, 0o755);
}

function cleanEnvironment(shimDirectory) {
  const environment = { ...process.env, PATH: `${shimDirectory}:${process.env.PATH ?? ''}` };
  for (const name of ['NEBIUS_API_KEY', 'CONTREE_TOKEN', 'CONTREE_PROJECT', 'TAVILY_API_KEY']) {
    delete environment[name];
  }
  return environment;
}

async function installedContentHash(packageRoot) {
  const hash = createHash('sha256');
  let totalBytes = 0;
  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Installed CLI contains symbolic link: ${relative}`);
      if (entry.isDirectory()) await visit(path, relative);
      else if (entry.isFile()) {
        const metadata = await stat(path);
        if (metadata.size > 20 * 1024 * 1024 - totalBytes) {
          throw new Error('Installed CLI exceeds 20971520 bytes');
        }
        const bytes = await readFile(path);
        totalBytes += bytes.byteLength;
        hash.update(relative).update('\0').update(bytes).update('\0');
      } else throw new Error(`Installed CLI contains unsupported entry: ${relative}`);
    }
  }
  await visit(packageRoot);
  return hash.digest('hex');
}

export async function verifyInstall(options) {
  if (options.mode !== 'candidate' && options.mode !== 'public') {
    throw new Error('Install mode must be candidate or public');
  }
  const dependencies = options.dependencies ?? {};
  const pack = dependencies.pack ?? packDefault;
  const install = dependencies.install ?? installDefault;
  const invoke = dependencies.invoke ?? invokeDefault;
  const resolvePublicCommit = dependencies.resolvePublicCommit ?? publicCommitDefault;
  const now = options.now ?? (() => performance.now());
  const actionCommit = options.mode === 'candidate'
    ? exactSha(options.actionCommit, 'Candidate Action SHA')
    : exactSha(await resolvePublicCommit(RELEASE_VERSION, options.root), 'Public Action SHA');
  const temporary = await mkdtemp(join(tmpdir(), `sutura-${options.mode}-install-`));
  try {
    const packageDirectory = join(temporary, 'package');
    const consumer = join(temporary, 'consumer');
    const shimDirectory = join(temporary, 'bin');
    await mkdir(packageDirectory);
    await mkdir(join(consumer, '.github', 'workflows'), { recursive: true });
    await mkdir(shimDirectory);
    await writeFile(join(consumer, 'package.json'), '{"name":"sutura-install-smoke","private":true}\n');
    await writeFile(join(consumer, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\n');
    await createDoctorShim(shimDirectory);

    const source = options.mode === 'candidate'
      ? join(options.root, 'packages', 'cli')
      : `sutura@${RELEASE_VERSION}`;
    const tarball = await pack(source, packageDirectory);
    const packageIntegrity = createHash('sha256').update(await readFile(tarball)).digest('hex');
    await install(tarball, consumer);
    const installedRoot = join(consumer, 'node_modules', 'sutura');
    const installed = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'));
    if (installed.name !== 'sutura' || installed.version !== RELEASE_VERSION) {
      throw new Error(`Installed package is not sutura@${RELEASE_VERSION}`);
    }
    if (installed.dependencies && Object.keys(installed.dependencies).length > 0) {
      throw new Error('Installed CLI contains runtime dependencies');
    }
    const installedLicense = await readFile(join(installedRoot, 'LICENSE'));
    const repositoryLicense = await readFile(join(options.root, 'LICENSE'));
    if (!installedLicense.equals(repositoryLicense)) {
      throw new Error('Installed CLI license differs from the repository license');
    }
    const packageContentHash = await installedContentHash(installedRoot);

    const binary = join(consumer, 'node_modules', '.bin', 'sutura');
    const environment = cleanEnvironment(shimDirectory);
    const actionArgs = options.mode === 'candidate' ? ['--action-sha', actionCommit] : [];
    const startedAt = now();
    await invoke(binary, [
      'init', '--workflow', 'CI', '--repo', 'sutura/install-smoke', ...actionArgs,
    ], consumer, environment);
    const setupDurationMs = Math.max(0, now() - startedAt);
    const workflow = await readFile(join(consumer, '.github', 'workflows', 'sutura.yml'), 'utf8');
    if (!workflow.includes(`uses: juan294/sutura@${actionCommit}`)) {
      throw new Error('Generated workflow does not use release commit');
    }
    const doctor = await invoke(binary, [
      'doctor', '--repo', 'sutura/install-smoke', ...actionArgs,
    ], consumer, environment);
    if (doctor.split(/\r?\n/u).some((line) => line.startsWith('[FAIL]'))) {
      throw new Error('Installed CLI doctor reported a failure');
    }
    if ((await invoke(binary, ['--version'], consumer, environment)).trim() !== RELEASE_VERSION) {
      throw new Error('Installed CLI returned the wrong version');
    }

    return {
      schemaVersion: 'sutura-install-evidence-v1',
      mode: options.mode,
      packageVersion: RELEASE_VERSION,
      packageSource: source,
      packageIntegrity,
      packageContentHash,
      actionCommit,
      setupDurationMs,
      outcome: 'passed',
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
