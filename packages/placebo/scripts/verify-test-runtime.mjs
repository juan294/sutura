import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, readlink, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const notice = await readFile(join(packageDirectory, 'vendor', 'THIRD_PARTY_NOTICES.md'), 'utf8');
const noticeRows = new Map(
  [...notice.matchAll(/^\| `([^`]+)` \| ([^|]+) \| `([^`]+)` \|/gm)]
    .map((match) => [match[1], { license: match[2].trim(), path: match[3] }]),
);
const targets = {
  'darwin-arm64': {
    required: ['@rolldown+binding-darwin-arm64@1.2.5', 'lightningcss-darwin-arm64@1.33.0'],
    forbidden: ['@rolldown+binding-linux-', 'lightningcss-linux-'],
  },
  'linux-x64': {
    required: [
      '@rolldown+binding-linux-x64-gnu@1.2.5', '@rolldown+binding-linux-x64-musl@1.2.5',
      'lightningcss-linux-x64-gnu@1.33.0', 'lightningcss-linux-x64-musl@1.33.0',
    ],
    forbidden: ['@rolldown+binding-darwin-', 'lightningcss-darwin-'],
  },
};

for (const { license, path } of noticeRows.values()) {
  const vendorDirectory = join(packageDirectory, 'vendor');
  const licensePath = resolve(vendorDirectory, path);
  const fromVendor = relative(vendorDirectory, licensePath);
  if (fromVendor === '..' || fromVendor.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`${path}: notice path escapes vendor directory`);
  }
  await access(licensePath);
  const text = await readFile(licensePath, 'utf8');
  if (license === 'Apache-2.0' && !['Apache License', 'Version 2.0', 'Grant of Copyright License', 'Redistribution'].every((part) => text.includes(part))) {
    throw new Error(`${path}: incomplete Apache-2.0 text`);
  }
  if (license === 'MIT' && !['Permission is hereby granted', 'copyright notice and this permission notice', 'WITHOUT WARRANTY'].every((part) => text.includes(part))) {
    throw new Error(`${path}: incomplete MIT text`);
  }
  if (license === 'BSD-2-Clause' && !['Redistribution and use', 'Redistributions of source code', 'Redistributions in binary form'].every((part) => text.includes(part))) {
    throw new Error(`${path}: incomplete BSD-2-Clause text`);
  }
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolveRun(stdout) : reject(new Error(`${command} failed: ${stderr}`)));
  });
}

async function walk(directory, visit) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    await visit(path, entry);
    if (entry.isDirectory()) await walk(path, visit);
  }
}

for (const [target, expected] of Object.entries(targets)) {
  const archive = join(packageDirectory, 'vendor', `placebo-test-runtime-${target}-node_modules.tgz`);
  const listing = await run('tar', ['-tzf', archive], packageDirectory);
  const entries = listing.trim().split('\n');
  if (entries.some((entry) => entry.startsWith('/') || entry.split('/').includes('..'))) {
    throw new Error(`${target}: archive contains an unsafe path`);
  }
  for (const required of expected.required) {
    if (!entries.some((entry) => entry.includes(required))) throw new Error(`${target}: missing ${required}`);
  }
  for (const forbidden of expected.forbidden) {
    if (entries.some((entry) => entry.includes(forbidden))) throw new Error(`${target}: contains ${forbidden}`);
  }

  const temporary = await mkdtemp(join(tmpdir(), `placebo-verify-${target}-`));
  try {
    await run('tar', ['-xzf', archive, '-C', temporary], temporary);
    const nodeModules = await realpath(join(temporary, 'node_modules'));
    const modules = JSON.parse(await readFile(join(nodeModules, '.modules.yaml'), 'utf8'));
    if (modules.packageManager !== 'pnpm@11.22.0') throw new Error(`${target}: wrong package manager`);

    const packages = new Map();
    await walk(nodeModules, async (path, entry) => {
      if (entry.isSymbolicLink()) {
        const destination = resolve(dirname(path), await readlink(path));
        const fromRoot = relative(nodeModules, destination);
        if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
          throw new Error(`${target}: escaping symlink ${path}`);
        }
      }
      if (entry.name !== 'package.json' || !path.includes(`${join('node_modules', '.pnpm')}`)) return;
      const value = JSON.parse(await readFile(path, 'utf8'));
      if (typeof value.name === 'string' && typeof value.version === 'string') {
        packages.set(`${value.name}@${value.version}`, { directory: dirname(path), license: value.license });
      }
    });

    for (const [id, { directory, license }] of packages) {
      const files = await readdir(directory);
      const hasLicense = files.some((file) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(file));
      if (!hasLicense) {
        const row = noticeRows.get(id);
        if (!row) throw new Error(`${target}: unlicensed package ${id}`);
        if (typeof license !== 'string' || row.license !== license) {
          throw new Error(`${target}: license mismatch for ${id}: ${String(license)} != ${row.license}`);
        }
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

console.log('Vendored runtime archives and license coverage verified.');
