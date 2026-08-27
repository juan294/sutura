/// <reference types="node" />

import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContreeError, ContreeExecutor } from './contree.js';

const execFileAsync = promisify(execFile);

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'),
  );
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function neverClosingResponse(status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"status":"EXECUTING"}'));
    },
  });
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function config(fetch: typeof globalThis.fetch, overrides = {}) {
  return {
    token: 'iam-token',
    project: 'project-id',
    fetch,
    pollIntervalMs: 0,
    operationTimeoutMs: 1_000,
    ...overrides,
  };
}

async function listTar(buffer: Uint8Array): Promise<string[]> {
  const child = spawn('tar', ['-tf', '-']);
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
  child.stdin.end(buffer);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (exitCode !== 0) {
    throw new Error(Buffer.concat(errors).toString('utf8'));
  }

  return Buffer.concat(output).toString('utf8').trim().split('\n');
}

async function readTarEntry(
  buffer: Uint8Array,
  entry: string,
): Promise<string> {
  const child = spawn('tar', ['-xOf', '-', entry]);
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
  child.stdin.end(buffer);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (exitCode !== 0) {
    throw new Error(Buffer.concat(errors).toString('utf8'));
  }
  return Buffer.concat(output).toString('utf8');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ContreeExecutor', () => {
  it('maps run options to the documented request and decodes the result fixture', async () => {
    const pending = await fixture('operation-pending.json');
    const success = await fixture('operation-success.json');
    const responses = [
      jsonResponse({ uuid: 'operation-1' }, 201, {
        Location: '/sandboxes/v1/operations/operation-1',
      }),
      jsonResponse(pending),
      jsonResponse(success),
    ];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      const response = responses.shift();
      if (!response) throw new Error('unexpected request');
      return response;
    });
    const executor = new ContreeExecutor(config(fetch));

    const result = await executor.run('image-parent', 'echo $GREETING', {
      cwd: '/repo',
      env: { GREETING: 'hello' },
      timeoutSec: 15,
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://api.tokenfactory.nebius.com/sandboxes/v1/instances',
    );
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer iam-token',
        Project: 'project-id',
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      image: 'image-parent',
      command: 'echo $GREETING',
      shell: true,
      env: { GREETING: 'hello' },
      timeout: 15,
      cwd: '/repo',
      networking: { enabled: true },
    });
    expect(result).toEqual({
      imageId: 'image-child',
      exitCode: 0,
      stdout: 'hello\n',
      stderr: 'warning\n',
      truncated: true,
      metrics: {
        cost: 0.0025,
        elapsedTimeSec: 1.25,
        maxRssKb: 4096,
        systemCpuTimeSec: 0.1,
        userCpuTimeSec: 0.2,
      },
    });
  });

  it('imports a registry image through an asynchronous operation', async () => {
    const success = await fixture('image-import-success.json');
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ uuid: 'import-operation' }, 201, {
          Location: '/v1/operations/import-operation',
        }),
      )
      .mockResolvedValueOnce(jsonResponse(success));
    const executor = new ContreeExecutor(config(fetch));

    await expect(executor.importImage('node:22-slim')).resolves.toBe(
      'image-imported',
    );

    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://api.tokenfactory.nebius.com/sandboxes/v1/images/import',
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      registry: { url: 'docker://docker.io/library/node:22-slim' },
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      'https://api.tokenfactory.nebius.com/sandboxes/v1/operations/import-operation',
    );
  });

  it('surfaces the response body for non-success status codes', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('project is not authorized', { status: 403 }));
    const executor = new ContreeExecutor(config(fetch));

    await expect(executor.run('parent', 'true')).rejects.toEqual(
      expect.objectContaining<Partial<ContreeError>>({
        name: 'ContreeError',
        status: 403,
        body: 'project is not authorized',
      }),
    );
  });

  it('cancels the operation when polling reaches the client timeout', async () => {
    vi.useFakeTimers();
    const pending = await fixture('operation-pending.json');
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ uuid: 'operation-1' }, 201, {
          Location: '/sandboxes/v1/operations/operation-1',
        });
      }
      if (init?.method === 'DELETE') {
        return new Response(null, { status: 202 });
      }
      return jsonResponse(pending);
    });
    const executor = new ContreeExecutor(
      config(fetch, { pollIntervalMs: 10, operationTimeoutMs: 15 }),
    );

    const run = executor.run('parent', 'sleep forever');
    const rejection = expect(run).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(30);

    await rejection;
    expect(fetch).toHaveBeenCalledWith(
      'https://api.tokenfactory.nebius.com/sandboxes/v1/operations/operation-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('aborts a hung poll and separately bounds a hung cancellation request', async () => {
    vi.useFakeTimers();
    let pollAborted = false;
    let cancellationSignal: AbortSignal | null | undefined;
    const waitForAbort = (signal: AbortSignal | null | undefined) =>
      new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          pollAborted = true;
          reject(signal.reason);
        });
      });
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ uuid: 'operation-1' }, 201, {
          Location: '/sandboxes/v1/operations/operation-1',
        });
      }
      if (init?.method === 'DELETE') {
        cancellationSignal = init.signal;
        return neverClosingResponse(500);
      }
      return waitForAbort(init?.signal);
    });
    const executor = new ContreeExecutor(
      config(fetch, {
        pollIntervalMs: 0,
        operationTimeoutMs: 20,
        cancelTimeoutMs: 10,
      }),
    );

    const run = executor.run('parent', 'hang');
    const rejection = expect(run).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(20);
    expect(pollAborted).toBe(true);

    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    expect(cancellationSignal?.aborted).toBe(true);
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(
      true,
    );
  });

  it('keeps the deadline active while consuming a stalled poll JSON body', async () => {
    vi.useFakeTimers();
    let pollSignal: AbortSignal | null | undefined;
    let cancelled = false;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ uuid: 'operation-1' }, 201, {
          Location: '/sandboxes/v1/operations/operation-1',
        });
      }
      if (init?.method === 'DELETE') {
        cancelled = true;
        return new Response(null, { status: 202 });
      }
      pollSignal = init?.signal;
      return neverClosingResponse();
    });
    const executor = new ContreeExecutor(
      config(fetch, { operationTimeoutMs: 20, cancelTimeoutMs: 10 }),
    );

    const run = executor.run('parent', 'hang-on-json');
    const rejection = expect(run).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(20);

    expect(pollSignal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
    await rejection;
  });

  it('bounds a stalled non-success response body before cancelling', async () => {
    vi.useFakeTimers();
    let errorSignal: AbortSignal | null | undefined;
    let cancelled = false;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ uuid: 'operation-1' }, 201, {
          Location: '/sandboxes/v1/operations/operation-1',
        });
      }
      if (init?.method === 'DELETE') {
        cancelled = true;
        return new Response(null, { status: 202 });
      }
      errorSignal = init?.signal;
      return neverClosingResponse(500);
    });
    const executor = new ContreeExecutor(
      config(fetch, { operationTimeoutMs: 20, cancelTimeoutMs: 10 }),
    );

    const run = executor.run('parent', 'hang-on-error-text');
    const rejection = expect(run).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(20);

    expect(errorSignal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
    await rejection;
  });

  it('backs off between non-terminal operation polls', async () => {
    vi.useFakeTimers();
    const pending = await fixture('operation-pending.json');
    const success = await fixture('operation-success.json');
    const responses = [
      jsonResponse({ uuid: 'operation-1' }, 201, {
        Location: '/sandboxes/v1/operations/operation-1',
      }),
      jsonResponse(pending),
      jsonResponse(pending),
      jsonResponse(success),
    ];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      const response = responses.shift();
      if (!response) throw new Error('unexpected request');
      return response;
    });
    const executor = new ContreeExecutor(
      config(fetch, { pollIntervalMs: 10, operationTimeoutMs: 100 }),
    );

    const run = executor.run('parent', 'true');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(fetch).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(10);
    expect(fetch).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(10);
    await expect(run).resolves.toEqual(expect.objectContaining({ exitCode: 0 }));
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('recomputes the remaining deadline after a slow poll response', async () => {
    vi.useFakeTimers();
    const pending = await fixture('operation-pending.json');
    let cancelled = false;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ uuid: 'operation-1' }, 201, {
          Location: '/sandboxes/v1/operations/operation-1',
        });
      }
      if (init?.method === 'DELETE') {
        cancelled = true;
        return new Response(null, { status: 202 });
      }
      return new Promise<Response>((resolve) => {
        setTimeout(() => resolve(jsonResponse(pending)), 8);
      });
    });
    const executor = new ContreeExecutor(
      config(fetch, { pollIntervalMs: 10, operationTimeoutMs: 15 }),
    );

    const run = executor.run('parent', 'true');
    const rejection = expect(run).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(15);

    expect(cancelled).toBe(true);
    await rejection;
  });

  it('limits all concurrent instance operations to maxOps', async () => {
    let operation = 0;
    let inFlight = 0;
    let highWater = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (init?.method === 'POST') {
        operation += 1;
        inFlight += 1;
        highWater = Math.max(highWater, inFlight);
        return jsonResponse({ uuid: `operation-${operation}` }, 201, {
          Location: `/sandboxes/v1/operations/operation-${operation}`,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      const id = String(url).split('/').at(-1);
      return jsonResponse({
        uuid: id,
        kind: 'instance',
        status: 'SUCCESS',
        result_image_uuid: `image-${id}`,
        metadata: {
          result: {
            state: { exit_code: 0 },
            stdout: { value: '', encoding: 'ascii', truncated: false },
            stderr: { value: '', encoding: 'ascii', truncated: false },
            resources: {},
          },
        },
      });
    });
    const executor = new ContreeExecutor(config(fetch, { maxOps: 2 }));

    const results = await executor.runMany(
      'parent',
      Array.from({ length: 5 }, (_, index) => `command-${index}`),
    );

    expect(results).toHaveLength(5);
    expect(highWater).toBe(2);
  });

  it('uploads the current safe worktree and replaces the destination snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-snapshot-'));
    try {
      await execFileAsync('git', ['init', '--quiet', dir]);
      await execFileAsync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
      await execFileAsync('git', ['-C', dir, 'config', 'user.name', 'Test User']);
      await writeFile(join(dir, '.gitignore'), 'ignored.txt\n');
      await writeFile(join(dir, 'included.txt'), 'original');
      await writeFile(join(dir, 'deleted.txt'), 'remove me');
      await writeFile(join(dir, 'ignored.txt'), 'ignore me');
      await writeFile(join(dir, '.env'), 'TOKEN=secret');
      await writeFile(join(dir, 'private.pem'), 'secret key');
      await mkdir(join(dir, 'node_modules', 'unsafe'), { recursive: true });
      await writeFile(join(dir, 'node_modules', 'unsafe', 'index.js'), 'secret');
      await execFileAsync('git', [
        '-C',
        dir,
        'add',
        '-f',
        '.gitignore',
        'included.txt',
        'deleted.txt',
        '.env',
        'private.pem',
        'node_modules/unsafe/index.js',
      ]);
      await execFileAsync('git', ['-C', dir, 'commit', '--quiet', '-m', 'baseline']);
      await writeFile(join(dir, 'included.txt'), 'modified');
      await writeFile(join(dir, 'untracked.txt'), 'new file');
      await rm(join(dir, 'deleted.txt'));
      if (process.platform === 'darwin') {
        await execFileAsync('xattr', [
          '-w',
          'com.apple.ResourceFork',
          'metadata',
          join(dir, 'included.txt'),
        ]);
      }

      let uploaded: Uint8Array | undefined;
      const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
        if (String(url).endsWith('/files')) {
          expect(init?.body).toBeInstanceOf(ReadableStream);
          uploaded = new Uint8Array(await new Response(init?.body).arrayBuffer());
          return jsonResponse({ uuid: 'file-uuid', sha256: 'abc', size: 123 }, 201);
        }
        if (String(url).endsWith('/instances')) {
          const body = JSON.parse(String(init?.body));
          expect(body).toMatchObject({
            image: 'base-image',
            command:
              "rm -rf /workspace && mkdir -p /workspace && tar -xf /tmp/sutura-snapshot.tar -C /workspace",
            files: {
              '/tmp/sutura-snapshot.tar': {
                uuid: 'file-uuid',
                uid: 0,
                gid: 0,
                mode: '0600',
              },
            },
          });
          return jsonResponse({ uuid: 'snapshot-operation' }, 201, {
            Location: '/sandboxes/v1/operations/snapshot-operation',
          });
        }
        return jsonResponse({
          uuid: 'snapshot-operation',
          kind: 'instance',
          status: 'SUCCESS',
          result_image_uuid: 'snapshot-image',
          metadata: {
            result: {
              state: { exit_code: 0 },
              stdout: { value: '', encoding: 'ascii', truncated: false },
              stderr: { value: '', encoding: 'ascii', truncated: false },
              resources: {},
            },
          },
        });
      });
      const executor = new ContreeExecutor(config(fetch));

      await expect(executor.snapshot(dir, 'base-image')).resolves.toBe(
        'snapshot-image',
      );
      expect(uploaded).toBeDefined();
      const entries = await listTar(uploaded ?? new Uint8Array());
      expect(entries).toContain('included.txt');
      expect(entries).toContain('untracked.txt');
      expect(entries).toContain('.gitignore');
      expect(entries).not.toContain('deleted.txt');
      expect(entries).not.toContain('ignored.txt');
      expect(entries).not.toContain('.env');
      expect(entries).not.toContain('private.pem');
      expect(entries.every((entry) => !entry.includes('node_modules'))).toBe(
        true,
      );
      expect(
        entries.every((entry) =>
          entry.split('/').every((segment) => !segment.startsWith('._')),
        ),
      ).toBe(true);
      const archiveText = Buffer.from(
        uploaded ?? new Uint8Array(),
      ).toString('latin1');
      expect(archiveText).not.toMatch(/(?:^|[/\0])\._[^/\0]+/u);
      expect(await readTarEntry(uploaded ?? new Uint8Array(), 'included.txt')).toBe(
        'modified',
      );
      expect(await readTarEntry(uploaded ?? new Uint8Array(), 'untracked.txt')).toBe(
        'new file',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
