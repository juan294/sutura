import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { verifyInstall } from './install-test-lib.mjs';

const execFileAsync = promisify(execFile);
const CANDIDATE_PATHS = Object.freeze(['.']);
const SHA_PATTERN = /^[a-f0-9]{40}$/iu;

async function executeDefault(command, args, options) {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return stdout;
}

async function currentCommit(root, execute) {
  const run = execute ?? executeDefault;
  return (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).trim();
}

export async function assertCandidateCheckout(root, actionCommit, execute) {
  if (!SHA_PATTERN.test(actionCommit)) {
    throw new Error('Candidate Action SHA must be an exact 40-character commit');
  }
  const run = execute ?? executeDefault;
  const head = await currentCommit(root, run);
  if (head.toLowerCase() !== actionCommit.toLowerCase()) {
    throw new Error(`Candidate Action SHA ${actionCommit} differs from HEAD ${head}`);
  }
  try {
    await run('git', ['diff', '--quiet', actionCommit, '--', ...CANDIDATE_PATHS], { cwd: root });
    await run('git', ['diff', '--cached', '--quiet', actionCommit, '--', ...CANDIDATE_PATHS], { cwd: root });
  } catch {
    throw new Error('Candidate package or Action source differs from the candidate commit');
  }
  const untracked = await run('git', [
    'ls-files', '--others', '--exclude-standard', '--', ...CANDIDATE_PATHS,
  ], { cwd: root });
  if (untracked.trim()) throw new Error('Candidate package or Action source contains untracked files');
}

export async function runCandidateInstall(actionCommit, dependencies) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const commit = actionCommit ?? await currentCommit(root, dependencies?.execute);
  await assertCandidateCheckout(root, commit, dependencies?.execute);
  return verifyInstall({ mode: 'candidate', root, actionCommit: commit, dependencies });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runCandidateInstall(process.argv[2]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
