import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

import type {
  PublishFixInput,
  RepositoryPort,
  RepositorySourceExcerpt,
  SourceReadLimits,
  SourceReference,
} from '../orchestrate.js';
import { canonicalJson, firstJsonDifference } from './canonical-json.js';
import type { RecordedRepositoryCall } from './bundle.js';
import { ReplayMismatchError } from './replay-fetch.js';

interface RecordedCheckout {
  checkoutId: string;
  snapshot: {
    runtimeEvidencePaths: string[];
    files: Array<{ path: string; content: string }>;
  };
}

function recordedError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Object.keys(value).length !== 1) return null;
  const error = (value as { error?: unknown }).error;
  return typeof error === 'string' ? error : null;
}

function safeSnapshotPath(path: string): boolean {
  return path.length > 0 && path.length <= 500 && !isAbsolute(path) && !path.includes('\\') &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && part !== '.git');
}

function parseCheckout(value: unknown, sequence: number): RecordedCheckout {
  if (typeof value !== 'object' || value === null) {
    throw new ReplayMismatchError(sequence, '$.result', 'recorded checkout', value);
  }
  const candidate = value as Partial<RecordedCheckout>;
  if (!/^checkout-[1-9]\d*$/u.test(candidate.checkoutId ?? '') ||
      typeof candidate.snapshot !== 'object' || candidate.snapshot === null ||
      !Array.isArray(candidate.snapshot.runtimeEvidencePaths) ||
      !Array.isArray(candidate.snapshot.files)) {
    throw new ReplayMismatchError(sequence, '$.result', 'recorded checkout snapshot', value);
  }
  for (const path of candidate.snapshot.runtimeEvidencePaths) {
    if (typeof path !== 'string' || !safeSnapshotPath(path)) {
      throw new ReplayMismatchError(sequence, '$.result.snapshot path', 'safe relative path', path);
    }
  }
  for (const file of candidate.snapshot.files) {
    if (typeof file !== 'object' || file === null || typeof file.path !== 'string' ||
        typeof file.content !== 'string' || !safeSnapshotPath(file.path)) {
      throw new ReplayMismatchError(sequence, '$.result.snapshot path', 'safe text file', file);
    }
  }
  return candidate as RecordedCheckout;
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

export class RecordedRepository implements RepositoryPort {
  private readonly calls: RecordedRepositoryCall[];
  private readonly checkoutPaths = new Map<string, string>();
  private index = 0;
  private temporaryRoot: string | undefined;

  constructor(calls: readonly RecordedRepositoryCall[]) {
    this.calls = [...calls].toSorted((left, right) => left.sequence - right.sequence);
  }

  normalizeArgs(args: unknown[]): unknown[] {
    return this.normalize(args) as unknown[];
  }

  private normalize(value: unknown): unknown {
    if (value === undefined) return null;
    if (typeof value === 'string') {
      for (const [checkoutDir, checkoutId] of this.checkoutPaths) {
        if (value === checkoutDir) return checkoutId;
        if (value.startsWith(`${checkoutDir}${sep}`)) {
          return `${checkoutId}/${value.slice(checkoutDir.length + 1).split(sep).join('/')}`;
        }
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => this.normalize(item));
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, this.normalize(item)]),
    );
  }

  private next(method: keyof RepositoryPort, args: unknown[]): RecordedRepositoryCall {
    const call = this.calls[this.index];
    if (!call) throw new ReplayMismatchError(this.index + 1, '$', method, 'sequence exhausted');
    this.index += 1;
    if (call.method !== method) {
      throw new ReplayMismatchError(call.sequence, '$.method', call.method, method);
    }
    const normalized = this.normalizeArgs(args);
    if (canonicalJson(call.args) !== canonicalJson(normalized)) {
      const difference = firstJsonDifference(call.args, normalized);
      throw new ReplayMismatchError(
        call.sequence,
        difference?.path ?? '$.args',
        difference?.expected,
        difference?.actual,
      );
    }
    const error = recordedError(call.result);
    if (error) throw new Error(error);
    return call;
  }

  readPolicyAtSha(repo: string, sha: string): Promise<string | null> {
    const call = this.next('readPolicyAtSha', [repo, sha]);
    return Promise.resolve(call.result as string | null);
  }

  async checkoutHead(
    repo: string,
    sha: string,
    headRef?: string,
    prNumber?: number,
  ): Promise<string> {
    const call = this.next('checkoutHead', [repo, sha, headRef, prNumber]);
    const checkout = parseCheckout(call.result, call.sequence);
    this.temporaryRoot ??= await mkdtemp(join(tmpdir(), 'sutura-replay-'));
    const checkoutDir = resolve(this.temporaryRoot, checkout.checkoutId);
    if (!inside(this.temporaryRoot, checkoutDir)) {
      throw new ReplayMismatchError(call.sequence, '$.result.checkoutId', 'safe checkout id', checkout.checkoutId);
    }
    await mkdir(checkoutDir, { recursive: true, mode: 0o700 });
    const contents = new Map(checkout.snapshot.files.map((file) => [file.path, file.content]));
    const paths = new Set([...checkout.snapshot.runtimeEvidencePaths, ...contents.keys()]);
    for (const path of paths) {
      const target = resolve(checkoutDir, path);
      if (!inside(checkoutDir, target)) {
        throw new ReplayMismatchError(call.sequence, '$.result.snapshot path', 'inside checkout', path);
      }
      await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 });
      await writeFile(target, contents.get(path) ?? '', { encoding: 'utf8', mode: 0o600 });
    }
    this.checkoutPaths.set(checkoutDir, checkout.checkoutId);
    return checkoutDir;
  }

  readSourceExcerpts(
    checkoutDir: string,
    references: readonly SourceReference[],
    limits: Readonly<SourceReadLimits>,
  ): Promise<RepositorySourceExcerpt[]> {
    const call = this.next('readSourceExcerpts', [checkoutDir, references, limits]);
    return Promise.resolve(call.result as RepositorySourceExcerpt[]);
  }

  publishFix(input: PublishFixInput): Promise<void> {
    this.next('publishFix', [input]);
    return Promise.resolve();
  }

  async cleanup(): Promise<void> {
    if (!this.temporaryRoot) return;
    const root = this.temporaryRoot;
    this.temporaryRoot = undefined;
    this.checkoutPaths.clear();
    await rm(root, { recursive: true, force: true });
  }
}
