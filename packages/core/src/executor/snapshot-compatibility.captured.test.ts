import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { freezeSandboxSource } from '../heal.js';
import { snapshotSelectedSource } from '../verification/source.js';
import { ContreeExecutor, buildSnapshotCommandForTest, listSnapshotFiles } from './contree.js';

const exec = promisify(execFile);
const captured = JSON.parse(await readFile(new URL('./__fixtures__/captured/fleet-snapshot-compatibility/input.json', import.meta.url), 'utf8')) as {
  fixturePath: string; fixtureContent: string; npmrc: string;
};

describe('captured snapshot compatibility', { timeout: 30_000 }, () => {
  it('preserves fixture dependency paths and safe npm configuration through source freezing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-captured-snapshot-'));
    try {
      await exec('git', ['init', '--quiet', root]);
      await mkdir(dirname(join(root, captured.fixturePath)), { recursive: true });
      await writeFile(join(root, captured.fixturePath), captured.fixtureContent);
      await writeFile(join(root, '.npmrc'), captured.npmrc);
      await writeFile(join(root, 'package.json'), '{"name":"snapshot-fixture"}\n');
      await exec('git', ['-C', root, 'add', '--force', captured.fixturePath, '.npmrc', 'package.json']);
      expect((await listSnapshotFiles(root, 'repository')).sort()).toEqual(['.npmrc', 'package.json', captured.fixturePath].sort());
      expect((await listSnapshotFiles(root, 'dependency-inputs')).sort()).toEqual(['.npmrc', 'package.json']);
      const frozen = await freezeSandboxSource(root);
      try {
        expect(await readFile(join(frozen.dir, captured.fixturePath), 'utf8')).toBe(captured.fixtureContent);
        expect(await readFile(join(frozen.dir, '.npmrc'), 'utf8')).toBe(captured.npmrc);
        expect((await listSnapshotFiles(frozen.dir, 'repository')).sort()).toEqual(['.npmrc', 'package.json', captured.fixturePath].sort());
        expect((await listSnapshotFiles(frozen.dir, 'dependency-inputs')).sort()).toEqual(['.npmrc', 'package.json']);
      } finally { await frozen.cleanup(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(['node_modules/dummy/index.js', 'packages/app/node_modules/dummy/index.js', '__fixtures__/.pnpm/dummy/index.js'])(
    'continues refusing actual installed dependency paths: %s', async (path) => {
      const root = await mkdtemp(join(tmpdir(), 'sutura-dependency-refusal-'));
      try {
        await exec('git', ['init', '--quiet', root]);
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), 'installed dependency');
        await exec('git', ['-C', root, 'add', '--force', path]);
        await expect(listSnapshotFiles(root, 'repository')).rejects.toThrow(/installed dependency path/u);
      } finally { await rm(root, { recursive: true, force: true }); }
    },
  );

  it('does not allow fixture paths to expose private files or escaping symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-fixture-private-'));
    const outside = await mkdtemp(join(tmpdir(), 'sutura-fixture-outside-'));
    try {
      const privatePath = '__fixtures__/repo/node_modules/dummy/.env';
      await mkdir(dirname(join(root, privatePath)), { recursive: true });
      await writeFile(join(root, privatePath), 'TOKEN=never-copy');
      await expect(snapshotSelectedSource(root, [privatePath], async () => {})).rejects.toThrow(/private path/u);
      await writeFile(join(outside, 'index.js'), 'external');
      await exec('git', ['init', '--quiet', root]);
      await symlink(join(outside, 'index.js'), join(root, '__fixtures__/repo/node_modules/dummy/index.js'));
      await exec('git', ['-C', root, 'add', '--force', '.']);
      await expect(listSnapshotFiles(root, 'repository')).rejects.toThrow(/absolute symlink/u);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('refuses a fixture path with traversal into an installed dependency', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-fixture-traversal-'));
    try {
      await mkdir(join(root, 'node_modules', 'dummy'), { recursive: true });
      await writeFile(join(root, 'node_modules', 'dummy', 'index.js'), 'installed');
      await expect(snapshotSelectedSource(root, ['__fixtures__/../node_modules/dummy/index.js'], async () => {}))
        .rejects.toThrow(/private path/u);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(['registry=https://untrusted.example.test', 'ignore-scripts=false', 'legacy-peer-deps=not-a-boolean'])(
    'rejects unsupported npm configuration without labelling it credentials: %s', async (content) => {
      const root = await mkdtemp(join(tmpdir(), 'sutura-config-refusal-'));
      try {
        await writeFile(join(root, '.npmrc'), `${content}\n`);
        await expect(listSnapshotFiles(root, 'repository')).rejects.toThrow(/unsupported.*\.npmrc|\.npmrc.*unsupported/u);
      } finally { await rm(root, { recursive: true, force: true }); }
    },
  );

  it.each(['//registry.example.test/:_authToken=private-value', '_auth=private-value', '# //registry.example.test/:_authToken=private-value', '#_authToken=private-value', ';_authToken=private-value'])(
    'refuses credentials through direct source freezing without exposing values: %s', async (content) => {
      const root = await mkdtemp(join(tmpdir(), 'sutura-freeze-credentials-'));
      try {
        await writeFile(join(root, '.npmrc'), content);
        await expect(snapshotSelectedSource(root, ['.npmrc'], async () => {})).rejects.toThrow(/\.npmrc credentials/u);
        await expect(listSnapshotFiles(root, 'dependency-inputs')).rejects.not.toThrow(/private-value/u);
      } finally { await rm(root, { recursive: true, force: true }); }
    },
  );

  it('archives validated npm configuration even if the original changes when tar starts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-npmrc-archive-race-'));
    try {
      const bin = join(root, 'bin'); await mkdir(bin);
      const npmrc = join(root, '.npmrc');
      await writeFile(npmrc, 'legacy-peer-deps=true\n');
      await writeFile(join(root, 'package.json'), '{}\n');
      const wrapper = join(bin, 'tar');
      await writeFile(wrapper, '#!/bin/sh\nif [ "$1" = "-cf" ]; then printf "_authToken=private-raced-value\\n" > "$SUTURA_TEST_NPMRC"; fi\nexec /usr/bin/tar "$@"\n');
      await chmod(wrapper, 0o755);
      vi.stubEnv('SUTURA_TEST_NPMRC', npmrc);
      vi.stubEnv('PATH', `${bin}:${process.env.PATH ?? ''}`);
      let uploaded: Uint8Array | undefined;
      const fetch: typeof globalThis.fetch = async (url, init) => {
        if (String(url).endsWith('/files')) {
          const body = new Uint8Array(await new Response(init?.body).arrayBuffer());
          uploaded ??= body;
          return Response.json({ uuid: 'file' }, { status: 201 });
        }
        if (String(url).endsWith('/instances')) return Response.json({}, {
          status: 201, headers: { Location: '/sandboxes/v1/operations/test' },
        });
        return Response.json({ status: 'SUCCESS', result_image_uuid: 'snapshot', metadata: { result: {
          state: { exit_code: 0 }, stdout: { value: '', encoding: 'ascii' },
          stderr: { value: '', encoding: 'ascii' }, resources: {},
        } } });
      };
      await new ContreeExecutor({ token: 'test-token', project: 'test-project', fetch, pollIntervalMs: 0 })
        .snapshot(root, 'base', { profile: 'dependency-inputs', mode: 'replace' });
      const archive = join(root, 'uploaded.tar'); await writeFile(archive, uploaded!);
      expect((await exec('/usr/bin/tar', ['-xOf', archive, '.npmrc'])).stdout).toBe('legacy-peer-deps=true\n');
      expect(await readFile(npmrc, 'utf8')).toBe('_authToken=private-raced-value\n');
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('removes only its uploaded archive after successful snapshot extraction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-snapshot-storage-'));
    try {
      const source = join(root, 'source'); const workspace = join(root, 'workspace');
      await mkdir(source); await writeFile(join(source, 'package.json'), '{}\n');
      const archive = join(root, 'snapshot.tar'); const manifest = join(root, 'manifest');
      await exec('tar', ['-cf', archive, 'package.json'], { cwd: source });
      await writeFile(manifest, 'package.json\0');
      const command = buildSnapshotCommandForTest({ profile: 'dependency-inputs', mode: 'replace' }, {
        cwd: workspace, snapshotPath: archive, manifestPath: manifest, dependencyManifestPath: manifest,
      });
      await exec('sh', ['-c', command]);
      expect(await readFile(join(workspace, 'package.json'), 'utf8')).toBe('{}\n');
      expect(await readFile(manifest, 'utf8')).toBe('package.json\0');
      await expect(readFile(archive)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
