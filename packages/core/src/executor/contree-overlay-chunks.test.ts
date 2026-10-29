/// <reference types="node" />

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildSandboxRepositoryInitializationCommandForTest } from '../heal.js';
import {
  ContreeError,
  ContreeExecutor,
  buildSnapshotCommandForTest,
} from './contree.js';

const execFileAsync = promisify(execFile);

const REPOSITORY_OVERLAY = { profile: 'repository', mode: 'overlay' } as const;
const DISK_FULL = "RemoteCallError('OSError', '28', 'No space left on device (os error 28)')";
const SNAPSHOT_PATH = '/tmp/sutura-snapshot.tar';
const MANIFEST_PATH = '/tmp/sutura-repository-overlay.manifest';
const DEPENDENCY_MANIFEST_PATH = '/tmp/sutura-dependency-inputs.manifest';
const MEMBERS_PATH = '/tmp/sutura-overlay-chunk.members';
const BUDGET = 200 * 1_024;
const FILE_BYTES = 40 * 1_024;

type FileEntry = { uuid: string; uid: number; gid: number; mode: string };
interface InstanceBody {
  image: string;
  command: string;
  shell: true;
  networking: { enabled: boolean };
  files: Record<string, FileEntry>;
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A scripted provider: records every request in order and answers like the real API. */
function providerFake(options: { failInstance?: number; rejectUpload?: number; uploadDelayMs?: number; onRequest?: (target: string) => void } = {}) {
  const uploads = new Map<string, Buffer>();
  const instances: InstanceBody[] = [];
  const requests: string[] = [];
  let uploadCount = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const target = String(url);
    options.onRequest?.(target);
    if (target.endsWith('/files')) {
      uploadCount += 1;
      requests.push('files');
      if (options.rejectUpload === uploadCount) return jsonResponse({ error: 'rejected' }, 400);
      if (options.uploadDelayMs) await new Promise((resolve) => setTimeout(resolve, options.uploadDelayMs));
      const bytes = Buffer.from(await new Response(init?.body).arrayBuffer());
      const uuid = `file-${uploadCount}`;
      uploads.set(uuid, bytes);
      return jsonResponse({ uuid, sha256: 'x', size: bytes.length }, 201);
    }
    if (target.endsWith('/instances')) {
      requests.push('instances');
      instances.push(JSON.parse(String(init?.body)) as InstanceBody);
      const id = `op-${instances.length}`;
      return jsonResponse({ uuid: id }, 201, { Location: `/sandboxes/v1/operations/${id}` });
    }
    requests.push('operation');
    const id = target.split('/').at(-1) as string;
    const ordinal = Number(id.slice('op-'.length));
    if (options.failInstance === ordinal) return jsonResponse({ status: 'FAILED', error: DISK_FULL });
    return jsonResponse({
      uuid: id,
      kind: 'instance',
      status: 'SUCCESS',
      result_image_uuid: `image-${ordinal}`,
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
  const upload = (entry: FileEntry | undefined): Buffer => {
    const bytes = entry && uploads.get(entry.uuid);
    if (!bytes) throw new Error('instance references an upload the provider never received');
    return bytes;
  };
  return { fetch, uploads, instances, requests, upload };
}

function executor(fetch: typeof globalThis.fetch, overrides: Record<string, unknown> = {}) {
  return new ContreeExecutor({
    token: 'iam-token',
    project: 'project-id',
    fetch,
    pollIntervalMs: 0,
    operationTimeoutMs: 1_000,
    ...overrides,
  });
}

const created: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  created.push(path);
  return path;
}

/** Forty-KiB files in separate directories; optionally one safe .npmrc in the last directory. */
async function sourceTree(fileCount = 12, npmrc = false): Promise<{ dir: string; files: string[] }> {
  const dir = await temporaryDirectory('sutura-chunk-source-');
  const files = ['package.json'];
  await writeFile(join(dir, 'package.json'), '{"name":"new"}\n');
  for (let index = 0; index < fileCount; index += 1) {
    const path = `d${String(index).padStart(2, '0')}/file.txt`;
    await mkdir(join(dir, dirname(path)), { recursive: true });
    await writeFile(join(dir, path), `${path}\n`.padEnd(FILE_BYTES, String(index % 10)));
    files.push(path);
  }
  if (npmrc) {
    await mkdir(join(dir, 'zz'));
    await writeFile(join(dir, 'zz', '.npmrc'), 'legacy-peer-deps=true\n');
    files.push('zz/.npmrc');
  }
  return { dir, files };
}

function nulSplit(bytes: Buffer): string[] {
  return bytes.toString('utf8').split('\0').filter((entry) => entry !== '');
}

describe('chunked repository overlay', { timeout: 30_000 }, () => {
  it('O-IDENTITY: a tree that fits one chunk sends the same requests as before chunking', async () => {
    const { dir } = await sourceTree(3);
    const provider = providerFake();

    const image = await executor(provider.fetch).snapshot(dir, 'base-image', REPOSITORY_OVERLAY);

    expect(image).toBe('image-1');
    expect(provider.requests).toEqual(['files', 'files', 'instances', 'operation']);
    const [body] = provider.instances as [InstanceBody];
    expect(body.files).toEqual({
      [SNAPSHOT_PATH]: { uuid: 'file-1', uid: 0, gid: 0, mode: '0600' },
      [MANIFEST_PATH]: { uuid: 'file-2', uid: 0, gid: 0, mode: '0600' },
    });
    expect(Object.keys(body.files)).toEqual([SNAPSHOT_PATH, MANIFEST_PATH]);
    expect(nulSplit(provider.upload(body.files[MANIFEST_PATH]))).toHaveLength(4);
    expect(body.command).toBe(buildSnapshotCommandForTest(REPOSITORY_OVERLAY, {
      cwd: '/workspace',
      snapshotPath: SNAPSHOT_PATH,
      manifestPath: MANIFEST_PATH,
      dependencyManifestPath: DEPENDENCY_MANIFEST_PATH,
    }));
    expect(body.command).not.toContain(MEMBERS_PATH);
    expect(body).toMatchObject({ image: 'base-image', shell: true, networking: { enabled: false } });
  });

  it('O-SIZE, O-PEAK and O-CHAIN: splits into bounded sequential instances on the previous image', async () => {
    const { dir, files } = await sourceTree();
    const provider = providerFake();

    const image = await executor(provider.fetch, { overlayChunkBytes: BUDGET })
      .snapshot(dir, 'base-image', REPOSITORY_OVERLAY);

    const count = provider.instances.length;
    expect(count).toBeGreaterThanOrEqual(3);
    expect(image).toBe(`image-${count}`);
    expect(provider.instances.map(({ image: parent }) => parent))
      .toEqual(['base-image', ...Array.from({ length: count - 1 }, (_, index) => `image-${index + 1}`)]);

    const manifestHolders = provider.instances.filter(({ files: map }) => MANIFEST_PATH in map);
    expect(manifestHolders).toEqual([provider.instances[0]]);
    const fullManifest = nulSplit(provider.upload(provider.instances[0]?.files[MANIFEST_PATH]));
    expect(fullManifest.sort()).toEqual([...files].sort());

    const members: string[] = [];
    for (const body of provider.instances) {
      const tar = provider.upload(body.files[SNAPSHOT_PATH]);
      const chunk = nulSplit(provider.upload(body.files[MEMBERS_PATH]));
      members.push(...chunk);
      expect(tar.length).toBeLessThanOrEqual(BUDGET);
      let extracted = 0;
      for (const path of chunk) extracted += (await stat(join(dir, path))).size;
      expect(extracted).toBeLessThan(tar.length);
      expect(tar.length + extracted).toBeLessThanOrEqual(2 * BUDGET);
    }
    expect(members.sort()).toEqual([...files].sort());
    expect(new Set(members).size).toBe(members.length);
  });

  const roundTrip = (npmrc: boolean) => async () => {
    const { dir, files } = await sourceTree(12, npmrc);
    const provider = providerFake();
    await executor(provider.fetch, { overlayChunkBytes: BUDGET })
      .snapshot(dir, 'base-image', REPOSITORY_OVERLAY);

    expect(provider.instances[0]?.command).toBe(buildSnapshotCommandForTest(REPOSITORY_OVERLAY, {
      cwd: '/workspace',
      snapshotPath: SNAPSHOT_PATH,
      manifestPath: MANIFEST_PATH,
      dependencyManifestPath: DEPENDENCY_MANIFEST_PATH,
      membersPath: MEMBERS_PATH,
    }));

    const sandbox = await temporaryDirectory('sutura-chunk-sandbox-');
    const root = join(sandbox, 'workspace');
    await mkdir(join(root, 'node_modules', 'dependency'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"name":"old"}\n');
    await writeFile(join(root, 'node_modules', 'dependency', 'output.js'), 'prepared\n');
    await writeFile(join(sandbox, 'dependency.manifest'), Buffer.from('package.json\0'));
    const paths = {
      cwd: root,
      snapshotPath: join(sandbox, 'overlay.tar'),
      manifestPath: join(sandbox, 'overlay.manifest'),
      dependencyManifestPath: join(sandbox, 'dependency.manifest'),
      membersPath: join(sandbox, 'overlay.members'),
    };
    for (const body of provider.instances) {
      await writeFile(paths.snapshotPath, provider.upload(body.files[SNAPSHOT_PATH]));
      await writeFile(paths.membersPath, provider.upload(body.files[MEMBERS_PATH]));
      const manifest = body.files[MANIFEST_PATH];
      if (manifest) await writeFile(paths.manifestPath, provider.upload(manifest));
      await execFileAsync('sh', ['-c', buildSnapshotCommandForTest(REPOSITORY_OVERLAY, paths)]);
    }

    for (const path of files) {
      expect(await readFile(join(root, path), 'utf8')).toBe(await readFile(join(dir, path), 'utf8'));
    }
    expect(await readFile(join(root, 'node_modules', 'dependency', 'output.js'), 'utf8')).toBe('prepared\n');
    await expect(readFile(paths.snapshotPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(paths.membersPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(nulSplit(await readFile(paths.manifestPath)).sort()).toEqual([...files].sort());

    await execFileAsync('sh', ['-c', buildSandboxRepositoryInitializationCommandForTest({
      manifestPath: paths.manifestPath,
      templatePath: join(sandbox, 'git-template'),
    })], { cwd: root });
    const tracked = (await execFileAsync('git', ['ls-files'], { cwd: root })).stdout
      .split('\n').filter(Boolean);
    expect(tracked.sort()).toEqual([...files].sort());
  };
  const roundTripName = 'O-WORKSPACE and O-BASELINE: extracting every chunk reproduces the tree and the Git baseline';
  it(roundTripName, roundTrip(false));
  // bsdtar (macOS) drops the stdin list when a second -T list follows, so the
  // configuration-file branch is only meaningful with GNU tar.
  it.skipIf(process.platform === 'darwin')(`${roundTripName} (configuration file in the last chunk)`, roundTrip(true));

  describe('O-REFUSE: validation still guards every chunk', () => {
    async function firstTwoChunks() {
      const { dir } = await sourceTree();
      const provider = providerFake();
      await executor(provider.fetch, { overlayChunkBytes: BUDGET })
        .snapshot(dir, 'base-image', REPOSITORY_OVERLAY);
      const sandbox = await temporaryDirectory('sutura-chunk-refuse-');
      const root = join(sandbox, 'workspace');
      await mkdir(root, { recursive: true });
      await writeFile(join(sandbox, 'dependency.manifest'), Buffer.from('package.json\0'));
      const paths = {
        cwd: root,
        snapshotPath: join(sandbox, 'overlay.tar'),
        manifestPath: join(sandbox, 'overlay.manifest'),
        dependencyManifestPath: join(sandbox, 'dependency.manifest'),
        membersPath: join(sandbox, 'overlay.members'),
      };
      const apply = async (index: number) => {
        const body = provider.instances[index] as InstanceBody;
        await writeFile(paths.snapshotPath, provider.upload(body.files[SNAPSHOT_PATH]));
        await writeFile(paths.membersPath, provider.upload(body.files[MEMBERS_PATH]));
        const manifest = body.files[MANIFEST_PATH];
        if (manifest) await writeFile(paths.manifestPath, provider.upload(manifest));
        return execFileAsync('sh', ['-c', buildSnapshotCommandForTest(REPOSITORY_OVERLAY, paths)]);
      };
      const secondChunk = nulSplit(provider.upload(provider.instances[1]?.files[MEMBERS_PATH]));
      return { sandbox, root, apply, secondChunk };
    }

    it.each(['symlink-parent', 'symlink-destination', 'collision'] as const)(
      'refuses a %s in chunk 2 and extracts none of its files',
      async (scenario) => {
        const { sandbox, root, apply, secondChunk } = await firstTwoChunks();
        await apply(0);
        const [target] = secondChunk as [string];
        if (scenario === 'symlink-parent') {
          const outside = join(sandbox, 'outside');
          await mkdir(outside);
          await symlink(outside, join(root, dirname(target)));
        } else if (scenario === 'symlink-destination') {
          const outside = join(sandbox, 'outside');
          await mkdir(outside);
          await writeFile(join(outside, 'file.txt'), 'outside\n');
          await mkdir(join(root, dirname(target)), { recursive: true });
          await symlink(join(outside, 'file.txt'), join(root, target));
        } else {
          await mkdir(join(root, dirname(target)), { recursive: true });
          await writeFile(join(root, target), 'prepared collision\n');
        }

        const error = await apply(1).catch((cause: unknown) => cause) as { stderr?: string };

        expect(error.stderr).toMatch(/refuses (?:symlink parent|symlink destination|preparation path collision)/u);
        for (const path of secondChunk.filter((entry) => entry !== target)) {
          await expect(readFile(join(root, path))).rejects.toMatchObject({ code: 'ENOENT' });
        }
      },
    );
  });

  it('O-GUARD: refuses a file that cannot fit in a chunk before any upload', async () => {
    const { dir } = await sourceTree(2);
    await mkdir(join(dir, 'big'));
    await writeFile(join(dir, 'big', 'blob.bin'), Buffer.alloc(500_000, 1));
    const provider = providerFake();

    await expect(executor(provider.fetch, { overlayChunkBytes: BUDGET })
      .snapshot(dir, 'base-image', REPOSITORY_OVERLAY))
      .rejects.toThrow(/big\/blob\.bin \(500000 bytes\).*cannot be split/u);
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('refuses a file between one and two chunks before uploading', async () => {
    const { dir } = await sourceTree(2);
    await mkdir(join(dir, 'big'));
    await writeFile(join(dir, 'big', 'blob.bin'), Buffer.alloc(300_000, 1));
    const provider = providerFake();
    await expect(executor(provider.fetch, { overlayChunkBytes: BUDGET })
      .snapshot(dir, 'base-image', REPOSITORY_OVERLAY)).rejects.toThrow(/big\/blob\.bin.*cannot be split/u);
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('checks actual tar size even for an empty single-archive overlay', async () => {
    const dir = await temporaryDirectory('sutura-empty-overlay-');
    const provider = providerFake();
    await expect(executor(provider.fetch, { overlayChunkBytes: 512 })
      .snapshot(dir, 'base-image', REPOSITORY_OVERLAY)).rejects.toThrow(/archive bytes.*512-byte chunk limit/u);
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('starts no instance when uploads consume the cumulative allowance', async () => {
    const { dir } = await sourceTree();
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const provider = providerFake({ onRequest: target => { if (target.endsWith('/files')) now += 40; } });
    await expect(executor(provider.fetch, { overlayChunkBytes: BUDGET, operationTimeoutMs: 100 })
      .snapshot(dir, 'base-image', REPOSITORY_OVERLAY)).rejects.toThrow(/overlay.*exceeded 100 ms/u);
    expect(provider.instances).toHaveLength(0);
  });

  it('does not renew the cumulative allowance after instance creation or polling', async () => {
    const { dir } = await sourceTree();
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const provider = providerFake({ onRequest: target => {
      if (target.endsWith('/instances')) now += 90;
      else if (target.includes('/operations/')) now += 20;
    } });
    await expect(executor(provider.fetch, { overlayChunkBytes: BUDGET, operationTimeoutMs: 100 })
      .snapshot(dir, 'base-image', REPOSITORY_OVERLAY)).rejects.toThrow(/timed out/u);
    expect(provider.instances).toHaveLength(1);
  });

  it('does not start a queued instance after its cumulative deadline', async () => {
    const { dir } = await sourceTree();
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const firstStarted = new Promise<void>(resolve => { started = resolve; });
    let uploaded!: () => void;
    const uploadsComplete = new Promise<void>(resolve => { uploaded = resolve; });
    let uploads = 0;
    const provider = providerFake({ onRequest: target => {
      if (target.endsWith('/files') && ++uploads === 3) uploaded();
    } });
    const fetch: typeof globalThis.fetch = async (url, init) => {
      const response = await provider.fetch(url, init);
      if (String(url).endsWith('/instances') && provider.instances.length === 1) {
        started();
        await held;
      }
      return response;
    };
    const client = executor(fetch, { maxOps: 1, overlayChunkBytes: BUDGET, operationTimeoutMs: 100 });
    const first = client.run('base-image', 'true');
    await firstStarted;
    const snapshot = client.snapshot(dir, 'base-image', REPOSITORY_OVERLAY);
    await uploadsComplete;
    await new Promise<void>(resolve => setImmediate(resolve));
    now = 101;
    release();
    await first;
    await expect(snapshot).rejects.toThrow(/overlay.*exceeded 100 ms/u);
    expect(provider.instances).toHaveLength(1);
  });

  it('O-ERROR: names the failing chunk, keeps the typed ENOSPC metadata and stops the chain', async () => {
    const { dir } = await sourceTree();
    const provider = providerFake({ failInstance: 2 });

    const error = await executor(provider.fetch, { overlayChunkBytes: BUDGET })
      .snapshot(dir, 'base-image', REPOSITORY_OVERLAY)
      .catch((cause: unknown) => cause) as ContreeError;

    expect(error).toBeInstanceOf(ContreeError);
    expect(error).toMatchObject({
      code: 'provider-disk-exhausted',
      stage: 'provider-operation',
      providerTerminal: 'failed',
      details: { providerOperationId: 'op-2' },
    });
    expect(error.message).toContain(DISK_FULL);
    expect(error.message).toMatch(/\(repository overlay chunk 2 of \d+, \d+ archive bytes\)$/u);
    expect(provider.instances).toHaveLength(2);
  });

  it('removes every temporary archive when an upload fails between chunks', async () => {
    const { dir } = await sourceTree();
    const scratch = await temporaryDirectory('sutura-chunk-tmpdir-');
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = scratch;
    try {
      // Uploads: manifest, tar 1, members 1, tar 2 (rejected).
      const provider = providerFake({ rejectUpload: 4 });
      await expect(executor(provider.fetch, { overlayChunkBytes: BUDGET })
        .snapshot(dir, 'base-image', REPOSITORY_OVERLAY))
        .rejects.toThrow(/\(repository overlay chunk 2 of \d+/u);
      expect(await readdir(scratch)).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
    }
  });

  it.each([0, -5, 1.5, Number.NaN])('rejects overlayChunkBytes %s', (value) => {
    expect(() => executor(vi.fn<typeof globalThis.fetch>(), { overlayChunkBytes: value }))
      .toThrow(/overlayChunkBytes must be a positive integer/u);
  });
});
