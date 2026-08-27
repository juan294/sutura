/// <reference types="node" />

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readdir, readlink, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

import pLimit, { type LimitFunction } from 'p-limit';

import { isSensitiveRepositoryPath } from '../security/repository-path.js';
import {
  SNAPSHOT_CWD,
  type Executor,
  type ImageId,
  type RunMetrics,
  type RunOptions,
  type RunResult,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.tokenfactory.nebius.com/sandboxes/v1/';
const DEFAULT_MAX_OPS = 40;
const DEFAULT_POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 5_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_CANCEL_TIMEOUT_MS = 5_000;
const SNAPSHOT_PATH = '/tmp/sutura-snapshot.tar';
const MAX_PROCESS_STDERR_BYTES = 64 * 1_024;
const MAX_SNAPSHOT_FILES = 10_000;
const MAX_SNAPSHOT_SOURCE_BYTES = 256 * 1_024 * 1_024;
const MAX_SNAPSHOT_ARCHIVE_BYTES = 300 * 1_024 * 1_024;

interface StreamResponse {
  value?: unknown;
  encoding?: unknown;
  truncated?: unknown;
}

interface InstanceResources {
  cost?: unknown;
  elapsed_time?: unknown;
  max_rss?: unknown;
  system_cpu_time?: unknown;
  user_cpu_time?: unknown;
}

interface InstanceResultResponse {
  state?: {
    exit_code?: unknown;
  };
  stdout?: StreamResponse;
  stderr?: StreamResponse;
  resources?: InstanceResources;
}

interface OperationResponse {
  status?: unknown;
  error?: unknown;
  result_image_uuid?: unknown;
  metadata?: {
    result?: InstanceResultResponse | null;
  };
  result?: {
    image?: unknown;
  };
}

interface FileUploadResponse {
  uuid?: unknown;
}

interface SpawnBody {
  image: ImageId;
  command: string;
  shell: true;
  networking: { enabled: true };
  env?: Readonly<Record<string, string>>;
  timeout?: number;
  cwd?: string;
  files?: Record<
    string,
    { uuid: string; uid: number; gid: number; mode: string }
  >;
}

export interface ContreeExecutorConfig {
  token: string;
  project: string;
  baseUrl?: string;
  maxOps?: number;
  fetch?: typeof globalThis.fetch;
  pollIntervalMs?: number;
  operationTimeoutMs?: number;
  cancelTimeoutMs?: number;
}

export class ContreeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'ContreeError';
  }
}

export class ContreeExecutor implements Executor {
  private readonly baseUrl: URL;
  private readonly fetch: typeof globalThis.fetch;
  private readonly instanceLimit: LimitFunction;
  private readonly pollIntervalMs: number;
  private readonly operationTimeoutMs: number;
  private readonly cancelTimeoutMs: number;

  constructor(private readonly config: ContreeExecutorConfig) {
    if (!config.token.trim()) throw new ContreeError('ConTree token is required');
    if (!config.project.trim()) {
      throw new ContreeError('ConTree project is required');
    }

    const maxOps = config.maxOps ?? DEFAULT_MAX_OPS;
    if (!Number.isSafeInteger(maxOps) || maxOps <= 0) {
      throw new ContreeError('ConTree maxOps must be a positive integer');
    }

    this.baseUrl = new URL(ensureTrailingSlash(config.baseUrl ?? DEFAULT_BASE_URL));
    this.fetch = config.fetch ?? globalThis.fetch;
    this.instanceLimit = pLimit(maxOps);
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.operationTimeoutMs =
      config.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
    this.cancelTimeoutMs = config.cancelTimeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS;
  }

  async importImage(ref: string): Promise<ImageId> {
    const response = await this.request('images/import', {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({ registry: { url: registryUrl(ref) } }),
    });
    const operation = await this.poll(this.operationLocation(response));
    return operationImageId(operation);
  }

  async snapshot(dir: string, base: ImageId): Promise<ImageId> {
    const archive = await createSnapshotArchive(dir);
    let fileId: string;
    try {
      const body = Readable.toWeb(createReadStream(archive.path));
      const upload = await this.requestJson<FileUploadResponse>('files', {
        method: 'POST',
        headers: this.headers('application/octet-stream'),
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
      fileId = requiredString(upload.uuid, 'file upload uuid');
    } finally {
      await archive.cleanup();
    }

    const result = await this.instanceLimit(() =>
      this.spawn({
        image: base,
        command:
          `rm -rf ${SNAPSHOT_CWD} && mkdir -p ${SNAPSHOT_CWD} && ` +
          `tar -xf ${SNAPSHOT_PATH} -C ${SNAPSHOT_CWD}`,
        shell: true,
        networking: { enabled: true },
        files: {
          [SNAPSHOT_PATH]: {
            uuid: fileId,
            uid: 0,
            gid: 0,
            mode: '0600',
          },
        },
      }),
    );
    if (result.exitCode !== 0) {
      throw new ContreeError(
        `ConTree snapshot extraction failed with exit code ${result.exitCode}: ${result.stderr}`,
      );
    }
    return result.imageId;
  }

  async run(
    parent: ImageId,
    cmd: string,
    opts: RunOptions = {},
  ): Promise<RunResult> {
    const body: SpawnBody = {
      image: parent,
      command: cmd,
      shell: true,
      networking: { enabled: true },
    };
    if (opts.env !== undefined) body.env = opts.env;
    if (opts.timeoutSec !== undefined) body.timeout = opts.timeoutSec;
    if (opts.cwd !== undefined) body.cwd = opts.cwd;

    return this.instanceLimit(() => this.spawn(body));
  }

  async runMany(
    parent: ImageId,
    cmds: string[],
    opts?: RunOptions,
  ): Promise<RunResult[]> {
    return Promise.all(cmds.map((cmd) => this.run(parent, cmd, opts)));
  }

  private async spawn(body: SpawnBody): Promise<RunResult> {
    const response = await this.request('instances', {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
    });
    const operation = await this.poll(this.operationLocation(response));
    const result = operation.metadata?.result;
    if (!result) {
      throw new ContreeError(
        'ConTree operation succeeded without metadata.result',
      );
    }

    return {
      imageId: operationImageId(operation),
      exitCode: requiredNumber(result.state?.exit_code, 'exit code'),
      stdout: decodeStream(result.stdout, 'stdout'),
      stderr: decodeStream(result.stderr, 'stderr'),
      truncated:
        result.stdout?.truncated === true || result.stderr?.truncated === true,
      metrics: mapMetrics(result.resources),
    };
  }

  private async poll(location: string): Promise<OperationResponse> {
    const operationUrl = this.resolveOperationLocation(location);
    const deadline = Date.now() + this.operationTimeoutMs;
    let pollIntervalMs = this.pollIntervalMs;

    try {
      while (Date.now() < deadline) {
        const remainingMs = Math.max(1, deadline - Date.now());
        const operation = await this.requestJson<OperationResponse>(
          operationUrl,
          {
            method: 'GET',
            headers: this.headers(),
          },
          remainingMs,
        );

        if (operation.status === 'SUCCESS') return operation;
        if (operation.status === 'FAILED' || operation.status === 'CANCELLED') {
          const detail =
            typeof operation.error === 'string' && operation.error
              ? `: ${operation.error}`
              : '';
          throw new ContreeError(
            `ConTree operation ended with ${String(operation.status)}${detail}`,
          );
        }

        const sleepRemainingMs = Math.max(0, deadline - Date.now());
        if (sleepRemainingMs === 0) break;
        await delay(Math.min(pollIntervalMs, sleepRemainingMs));
        pollIntervalMs = Math.min(pollIntervalMs * 2, MAX_POLL_INTERVAL_MS);
      }
    } catch (error) {
      if (!(error instanceof RequestTimeoutError)) throw error;
    }

    return this.throwOperationTimeout(operationUrl);
  }

  private async cancel(operationUrl: string): Promise<void> {
    await this.withTimeout(this.cancelTimeoutMs, async (signal) => {
      const response = await this.fetch(operationUrl, {
        method: 'DELETE',
        headers: this.headers(),
        signal,
      });
      if (!response.ok && response.status !== 409) {
        await this.throwResponseError(response, 'cancel operation');
      }
    });
  }

  private async throwOperationTimeout(operationUrl: string): Promise<never> {
    let cancellation = '';
    try {
      await this.cancel(operationUrl);
    } catch (error) {
      cancellation = `; cancellation attempt failed: ${errorMessage(error)}`;
    }
    throw new ContreeError(
      `ConTree operation timed out after ${this.operationTimeoutMs}ms${cancellation}`,
    );
  }

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs = this.operationTimeoutMs,
  ): Promise<Response> {
    return this.consumeRequest(path, init, async (response) => response, timeoutMs);
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit,
    timeoutMs = this.operationTimeoutMs,
  ): Promise<T> {
    return this.consumeRequest(
      path,
      init,
      async (response) => (await response.json()) as T,
      timeoutMs,
    );
  }

  private async consumeRequest<T>(
    path: string,
    init: RequestInit,
    consume: (response: Response) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const url = isAbsoluteUrl(path) ? path : new URL(path, this.baseUrl).toString();
    return this.withTimeout(timeoutMs, async (signal) => {
      const response = await this.fetch(url, { ...init, signal });
      if (!response.ok) {
        await this.throwResponseError(response, `${init.method} ${url}`);
      }
      return consume(response);
    });
  }

  private async withTimeout<T>(
    timeoutMs: number,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutError = new RequestTimeoutError(timeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, timeoutMs);
    });
    try {
      return await Promise.race([action(controller.signal), timeout]);
    } catch (error) {
      if (controller.signal.aborted) {
        throw timeoutError;
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async throwResponseError(
    response: Response,
    action: string,
  ): Promise<never> {
    const body = await response.text();
    throw new ContreeError(
      `ConTree ${action} failed with HTTP ${response.status}: ${body}`,
      response.status,
      body,
    );
  }

  private operationLocation(response: Response): string {
    const location = response.headers.get('location');
    if (!location) {
      throw new ContreeError('ConTree response omitted the Location header');
    }
    return location;
  }

  private resolveOperationLocation(location: string): string {
    if (isAbsoluteUrl(location)) {
      const operationUrl = new URL(location);
      if (operationUrl.origin !== this.baseUrl.origin) {
        throw new ContreeError(
          'ConTree operation Location must use the configured origin',
        );
      }
      return operationUrl.toString();
    }

    const expectedPrefix = this.baseUrl.pathname.replace(/\/v1\/$/, '');
    if (location.startsWith(`${expectedPrefix}/v1/`)) {
      return new URL(location, this.baseUrl.origin).toString();
    }
    if (location.startsWith('/v1/')) {
      return new URL(`${expectedPrefix}${location}`, this.baseUrl.origin).toString();
    }
    return new URL(location.replace(/^\//, ''), this.baseUrl).toString();
  }

  private headers(contentType?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.token}`,
      Project: this.config.project,
    };
    if (contentType) headers['Content-Type'] = contentType;
    return headers;
  }

  private jsonHeaders(): Record<string, string> {
    return this.headers('application/json');
  }
}

class RequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`request timed out after ${timeoutMs}ms`);
    this.name = 'RequestTimeoutError';
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//u.test(value);
}

function registryUrl(ref: string): string {
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(ref)) return ref;

  const firstSegment = ref.split('/')[0] ?? '';
  const hasRegistry =
    ref.includes('/') &&
    (firstSegment === 'localhost' || /[.:]/u.test(firstSegment));
  if (hasRegistry) return `docker://${ref}`;
  if (ref.includes('/')) return `docker://docker.io/${ref}`;
  return `docker://docker.io/library/${ref}`;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ContreeError(`ConTree response omitted ${label}`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ContreeError(`ConTree response omitted ${label}`);
  }
  return value;
}

function operationImageId(operation: OperationResponse): ImageId {
  if (
    typeof operation.result_image_uuid === 'string' &&
    operation.result_image_uuid.length > 0
  ) {
    return operation.result_image_uuid;
  }
  return requiredString(operation.result?.image, 'result image uuid');
}

function decodeStream(stream: StreamResponse | undefined, label: string): string {
  if (!stream) return '';
  if (typeof stream.value !== 'string') {
    throw new ContreeError(`ConTree response omitted ${label} value`);
  }
  const value = stream.value;
  if (stream.encoding === 'ascii') return value;
  if (stream.encoding === 'base64') return Buffer.from(value, 'base64').toString('utf8');
  throw new ContreeError(`ConTree ${label} has unsupported encoding`);
}

function mapMetrics(resources: InstanceResources | undefined): RunMetrics {
  if (!resources) return {};
  const metrics: RunMetrics = {};
  if (typeof resources.cost === 'number') metrics.cost = resources.cost;
  if (typeof resources.elapsed_time === 'number') {
    metrics.elapsedTimeSec = resources.elapsed_time;
  }
  if (typeof resources.max_rss === 'number') metrics.maxRssKb = resources.max_rss;
  if (typeof resources.system_cpu_time === 'number') {
    metrics.systemCpuTimeSec = resources.system_cpu_time;
  }
  if (typeof resources.user_cpu_time === 'number') {
    metrics.userCpuTimeSec = resources.user_cpu_time;
  }
  return metrics;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function listNonGitFiles(dir: string): Promise<string[]> {
  const root = await realpath(dir);
  const files: string[] = [];
  const directories = [''];
  let directoryIndex = 0;
  let sourceBytes = 0;
  while (directoryIndex < directories.length) {
    const directory = directories[directoryIndex] as string;
    directoryIndex += 1;
    const entries = await readdir(join(root, directory), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (isSensitiveRepositoryPath(path, { includeDependencies: true })) continue;
      const absolute = join(root, path);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        const link = await readlink(absolute);
        if (isAbsolute(link)) {
          throw new ContreeError(
            `ConTree snapshot refuses absolute symlink: ${path}`,
          );
        }
        const lexicalTarget = resolve(dirname(absolute), link);
        const lexicalRelative = relative(root, lexicalTarget).split(sep).join('/');
        if (
          lexicalRelative.startsWith('../') ||
          lexicalRelative === '..' ||
          isSensitiveRepositoryPath(lexicalRelative, { includeDependencies: true })
        ) {
          throw new ContreeError(
            `ConTree snapshot refuses escaping or sensitive symlink: ${path}`,
          );
        }
        let canonicalTarget: string;
        try {
          canonicalTarget = await realpath(absolute);
        } catch {
          throw new ContreeError(
            `ConTree snapshot refuses dangling or cyclic symlink: ${path}`,
          );
        }
        const canonicalRelative = relative(root, canonicalTarget).split(sep).join('/');
        if (
          canonicalRelative.startsWith('../') ||
          canonicalRelative === '..' ||
          isSensitiveRepositoryPath(canonicalRelative, { includeDependencies: true })
        ) {
          throw new ContreeError(
            `ConTree snapshot refuses escaping or sensitive symlink: ${path}`,
          );
        }
        const targetMetadata = await lstat(canonicalTarget);
        if (!targetMetadata.isFile() && !targetMetadata.isDirectory()) {
          throw new ContreeError(
            `ConTree snapshot refuses symlink to non-regular entry: ${path}`,
          );
        }
        if (files.length >= MAX_SNAPSHOT_FILES) {
          throw new ContreeError(
            `ConTree snapshot exceeds ${MAX_SNAPSHOT_FILES} files`,
          );
        }
        files.push(path);
      } else if (metadata.isDirectory()) {
        directories.push(path);
      } else if (metadata.isFile()) {
        if (files.length >= MAX_SNAPSHOT_FILES) {
          throw new ContreeError(
            `ConTree snapshot exceeds ${MAX_SNAPSHOT_FILES} files`,
          );
        }
        sourceBytes += metadata.size;
        if (sourceBytes > MAX_SNAPSHOT_SOURCE_BYTES) {
          throw new ContreeError(
            `ConTree snapshot exceeds ${MAX_SNAPSHOT_SOURCE_BYTES} source bytes`,
          );
        }
        files.push(path);
      } else {
        throw new ContreeError(
          `ConTree snapshot refuses non-regular entry: ${path}`,
        );
      }
    }
  }
  return files;
}

async function listSnapshotFiles(dir: string): Promise<string[]> {
  try {
    const listed = await runProcess('git', [
      '-C',
      dir,
      'ls-files',
      '-co',
      '--exclude-standard',
      '-z',
    ]);
    const deleted = await runProcess('git', [
      '-C',
      dir,
      'ls-files',
      '--deleted',
      '-z',
    ]);
    const deletedPaths = new Set(
      deleted.stdout.toString('utf8').split('\0').filter(Boolean),
    );
    const files = listed.stdout
      .toString('utf8')
      .split('\0')
      .filter(
        (path) =>
          path.length > 0 &&
          !deletedPaths.has(path) &&
          !isSensitiveRepositoryPath(path),
      );
    await validateSnapshotFiles(dir, files);
    return files;
  } catch (error) {
    if (error instanceof Error && /not a git repository/iu.test(error.message)) {
      return listNonGitFiles(dir);
    }
    throw error;
  }
}

async function validateSnapshotFiles(
  dir: string,
  files: readonly string[],
): Promise<void> {
  if (files.length > MAX_SNAPSHOT_FILES) {
    throw new ContreeError(
      `ConTree snapshot exceeds ${MAX_SNAPSHOT_FILES} files`,
    );
  }
  let sourceBytes = 0;
  for (const path of files) {
    const metadata = await lstat(join(dir, path));
    if (!metadata.isFile()) continue;
    sourceBytes += metadata.size;
    if (sourceBytes > MAX_SNAPSHOT_SOURCE_BYTES) {
      throw new ContreeError(
        `ConTree snapshot exceeds ${MAX_SNAPSHOT_SOURCE_BYTES} source bytes`,
      );
    }
  }
}

interface SnapshotArchive {
  path: string;
  cleanup(): Promise<void>;
}

async function createSnapshotArchive(dir: string): Promise<SnapshotArchive> {
  const files = await listSnapshotFiles(dir);
  const input = Buffer.from(files.map((path) => `${path}\0`).join(''));
  const archiveDir = await mkdtemp(join(tmpdir(), 'sutura-contree-'));
  const archivePath = join(archiveDir, 'snapshot.tar');
  try {
    await runProcess(
      'tar',
      ['-cf', archivePath, '--no-recursion', '--null', '-T', '-'],
      dir,
      input,
      { ...process.env, COPYFILE_DISABLE: '1' },
    );
    const archive = await stat(archivePath);
    if (archive.size > MAX_SNAPSHOT_ARCHIVE_BYTES) {
      throw new ContreeError(
        `ConTree snapshot archive exceeds ${MAX_SNAPSHOT_ARCHIVE_BYTES} bytes`,
      );
    }
    return {
      path: archivePath,
      cleanup: () => rm(archiveDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(archiveDir, { recursive: true, force: true });
    throw error;
  }
}

async function runProcess(
  command: string,
  args: string[],
  cwd?: string,
  input?: Buffer,
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...(cwd ? { cwd } : {}),
      ...(env ? { env } : {}),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stderrBytes = 0;
    let stderrTruncated = false;

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      const remaining = MAX_PROCESS_STDERR_BYTES - stderrBytes;
      if (remaining <= 0) {
        stderrTruncated = true;
        return;
      }
      const kept = chunk.subarray(0, remaining);
      stderr.push(kept);
      stderrBytes += kept.length;
      if (kept.length < chunk.length) stderrTruncated = true;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const result = {
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(
          stderrTruncated
            ? [...stderr, Buffer.from('\n[stderr truncated]\n')]
            : stderr,
        ),
      };
      if (code === 0) resolve(result);
      else {
        reject(
          new ContreeError(
            `${command} failed with exit code ${String(code)}: ${result.stderr.toString('utf8')}`,
          ),
        );
      }
    });
    child.stdin.end(input);
  });
}
