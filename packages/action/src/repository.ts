import { constants as fsConstants } from 'node:fs';
import { lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

import {
  MAX_POLICY_BYTES,
  selectBoundedSourceWindow,
  SourceWindowError,
} from '@sutura/core';
import type {
  PublishFixInput,
  RepositoryPort,
  RepositorySourceExcerpt,
  SourceReadLimits,
  SourceReference,
} from '@sutura/core';

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^sutura\/fix-[1-9]\d*$/;
const PATH_PATTERN = /^[A-Za-z0-9_@./-]+$/;
const MAX_SCAN_BYTES = 1_000_000;
const SAFE_GIT_CONFIGURATION = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'commit.gpgSign=false',
] as const;

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: RunOptions,
) => Promise<string>;

export interface GitRepositoryOptions {
  token: string;
  workspaceRoot?: string;
  run?: CommandRunner;
}

export class RepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RepositoryError';
  }
}

function defaultRun(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString('utf8'));
      } else {
        reject(new RepositoryError(
          `${command} exited ${String(code)}: ${Buffer.concat(stderr).toString('utf8').slice(-2_000)}`,
        ));
      }
    });
    child.stdin.end(options.stdin);
  });
}

function contained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function validateLimits(limits: Readonly<SourceReadLimits>): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RepositoryError(`${name} must be a positive integer`);
    }
  }
}

function gitArgs(args: readonly string[]): string[] {
  return [...SAFE_GIT_CONFIGURATION, ...args];
}

function validateSourcePath(path: string): string[] {
  if (
    !path ||
    path.length > 240 ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.includes('//') ||
    !PATH_PATTERN.test(path)
  ) {
    throw new RepositoryError(`Unsafe source path: ${path}`);
  }
  const segments = path.replace(/^\.\//, '').split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment === '.git' || segment === 'node_modules')) {
    throw new RepositoryError(`Unsafe source path: ${path}`);
  }
  return segments;
}

function isOmittableSourceError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM';
}

export async function readBoundedPolicyFile(
  handle: Pick<FileHandle, 'read' | 'stat'>,
): Promise<string> {
  const file = await handle.stat();
  if (!file.isFile()) throw new RepositoryError('Repository policy must be a file');
  if (file.size > MAX_POLICY_BYTES) {
    throw new RepositoryError(`Repository policy exceeds ${MAX_POLICY_BYTES} bytes`);
  }
  const bytes = Buffer.alloc(file.size + 1);
  const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
  if (bytesRead > MAX_POLICY_BYTES || bytesRead !== file.size) {
    throw new RepositoryError('Repository policy changed during bounded read');
  }
  return bytes.subarray(0, bytesRead).toString('utf8');
}

export class GitRepository implements RepositoryPort {
  private readonly run: CommandRunner;
  private readonly workspaceRoot: string;

  constructor(private readonly options: GitRepositoryOptions) {
    if (!options.token.trim()) throw new RepositoryError('GitHub token is required');
    this.run = options.run ?? defaultRun;
    this.workspaceRoot = resolve(options.workspaceRoot ?? tmpdir());
  }

  private gitEnvironment(): NodeJS.ProcessEnv {
    const credential = Buffer.from(`x-access-token:${this.options.token}`, 'utf8').toString('base64');
    return {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraheader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${credential}`,
      GIT_TERMINAL_PROMPT: '0',
    };
  }

  async checkoutHead(
    repo: string,
    sha: string,
    headRef?: string,
    prNumber?: number,
  ): Promise<string> {
    if (!REPOSITORY_PATTERN.test(repo) || !SHA_PATTERN.test(sha)) {
      throw new RepositoryError('Repository or exact failing SHA is invalid');
    }
    if (headRef !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/.test(headRef)) {
      throw new RepositoryError('Pull request head ref is invalid');
    }
    if (prNumber !== undefined && (!Number.isSafeInteger(prNumber) || prNumber <= 0)) {
      throw new RepositoryError('Pull request number is invalid');
    }
    const checkoutDir = await mkdtemp(join(this.workspaceRoot, 'sutura-checkout-'));
    const env = this.gitEnvironment();
    await this.run('git', gitArgs(['init', '--quiet', checkoutDir]), { env });
    await this.run('git', gitArgs(['remote', 'add', 'origin', `https://github.com/${repo}.git`]), { cwd: checkoutDir, env });
    const refs = [
      sha,
      ...(headRef ? [`refs/heads/${headRef}`] : []),
      ...(prNumber ? [`refs/pull/${prNumber}/head`] : []),
    ];
    let fetched = false;
    for (const ref of refs) {
      try {
        await this.run('git', gitArgs(['fetch', '--quiet', '--depth=1', 'origin', ref]), { cwd: checkoutDir, env });
        const resolved = (await this.run('git', gitArgs(['rev-parse', 'FETCH_HEAD']), { cwd: checkoutDir, env })).trim();
        if (resolved.toLowerCase() === sha.toLowerCase()) {
          fetched = true;
          break;
        }
      } catch {
        // Try only the validated same-repository PR refs supplied by the core.
      }
    }
    if (!fetched) throw new RepositoryError('Could not fetch the exact failing SHA');
    await this.run('git', gitArgs(['checkout', '--quiet', '--detach', sha]), { cwd: checkoutDir, env });
    return checkoutDir;
  }

  async readSourceExcerpts(
    checkoutDir: string,
    references: readonly SourceReference[],
    limits: Readonly<SourceReadLimits>,
  ): Promise<RepositorySourceExcerpt[]> {
    validateLimits(limits);
    if (references.length > limits.maxFiles) {
      throw new RepositoryError('Source request exceeds the file limit');
    }
    const root = await realpath(checkoutDir);
    if (!contained(await realpath(this.workspaceRoot), root)) {
      throw new RepositoryError('Checkout is outside the configured workspace root');
    }
    const excerpts: RepositorySourceExcerpt[] = [];
    for (const reference of references) {
      if (
        reference.line !== undefined &&
        (!Number.isSafeInteger(reference.line) || reference.line <= 0)
      ) {
        throw new RepositoryError(`Unsafe source line for path: ${reference.path}`);
      }
      const segments = validateSourcePath(reference.path);
      try {
        let current = root;
        for (const segment of segments) {
          current = join(current, segment);
          const metadata = await lstat(current);
          if (metadata.isSymbolicLink()) {
            throw new RepositoryError(`Source path contains a symlink: ${reference.path}`);
          }
        }
        const resolved = await realpath(current);
        const handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        try {
          const metadata = await handle.stat();
          if (!metadata.isFile()) continue;
          const desiredEndLine = Math.max(reference.line ?? 1, 1) + Math.ceil(limits.maxLinesPerFile / 2);
          const scanLimit = Math.min(
            MAX_SCAN_BYTES,
            limits.maxBytesPerFile * limits.maxLinesPerFile * 4,
            metadata.size,
          );
          const chunks: Buffer[] = [];
          let bytesReadTotal = 0;
          let newlineCount = 0;
          while (bytesReadTotal < scanLimit && newlineCount < desiredEndLine) {
            const chunk = Buffer.alloc(Math.min(4_096, scanLimit - bytesReadTotal));
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, bytesReadTotal);
            if (bytesRead === 0) break;
            const value = chunk.subarray(0, bytesRead);
            chunks.push(value);
            bytesReadTotal += bytesRead;
            for (const byte of value) if (byte === 0x0a) newlineCount += 1;
          }
          const bytes = Buffer.concat(chunks);
          let bounded;
          try {
            bounded = selectBoundedSourceWindow({
              scanned: new TextDecoder().decode(bytes),
              scannedBytes: bytes.length,
              fileSize: metadata.size,
              ...(reference.line === undefined ? {} : { requestedLine: reference.line }),
              limits,
            });
          } catch (error) {
            if (error instanceof SourceWindowError) throw new RepositoryError(error.message);
            throw error;
          }
          excerpts.push({
            path: reference.path.replace(/^\.\//, ''),
            ...bounded,
          });
        } finally {
          await handle.close();
        }
      } catch (error) {
        if (isOmittableSourceError(error)) continue;
        throw error;
      }
    }
    return excerpts;
  }

  async readPolicyAtSha(repo: string, sha: string): Promise<string | null> {
    const checkoutDir = await this.checkoutHead(repo, sha);
    try {
      const root = await realpath(checkoutDir);
      const policyPath = join(root, '.sutura.json');
      let metadata;
      try {
        metadata = await lstat(policyPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      if (metadata.isSymbolicLink()) {
        throw new RepositoryError('Repository policy must not be a symlink');
      }
      const resolved = await realpath(policyPath);
      const handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      try {
        return await readBoundedPolicyFile(handle);
      } finally {
        await handle.close();
      }
    } finally {
      await rm(checkoutDir, { recursive: true, force: true });
    }
  }

  async publishFix(input: PublishFixInput): Promise<void> {
    if (!BRANCH_PATTERN.test(input.branch) || !SHA_PATTERN.test(input.headSha)) {
      throw new RepositoryError('Fix branch or exact failing SHA is invalid');
    }
    const env = this.gitEnvironment();
    const current = (await this.run('git', gitArgs(['rev-parse', 'HEAD']), { cwd: input.checkoutDir, env })).trim();
    if (current.toLowerCase() !== input.headSha.toLowerCase()) {
      throw new RepositoryError('Checkout is not at the exact failing SHA');
    }
    await this.run('git', gitArgs(['checkout', '--quiet', '-b', input.branch, input.headSha]), { cwd: input.checkoutDir, env });
    await this.run('git', gitArgs(['apply', '--check', '-']), { cwd: input.checkoutDir, env, stdin: input.diff });
    await this.run('git', gitArgs(['apply', '-']), { cwd: input.checkoutDir, env, stdin: input.diff });
    await this.run('git', gitArgs(['config', 'user.name', 'Sutura']), { cwd: input.checkoutDir, env });
    await this.run('git', gitArgs(['config', 'user.email', 'sutura@users.noreply.github.com']), { cwd: input.checkoutDir, env });
    await this.run('git', gitArgs(['add', '--all']), { cwd: input.checkoutDir, env });
    await this.run('git', gitArgs(['commit', '--file=-', '--no-gpg-sign']), { cwd: input.checkoutDir, env, stdin: input.message });
    const parent = (await this.run('git', gitArgs(['rev-parse', 'HEAD^']), { cwd: input.checkoutDir, env })).trim();
    if (parent.toLowerCase() !== input.headSha.toLowerCase()) {
      throw new RepositoryError('Fix commit is not based on the exact failing SHA');
    }
    await this.run('git', gitArgs(['push', 'origin', `HEAD:refs/heads/${input.branch}`]), { cwd: input.checkoutDir, env });
  }
}
