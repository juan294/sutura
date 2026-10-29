import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RUNTIME_SUPPORT_CONTRACT, type TargetRuntimeContract } from '@sutura/core';
import { assessRepository } from './assess.js';
const roots: string[] = [];
const target: TargetRuntimeContract = { kind: 'packaged-runtime', packageVersion: '0.3.9', runtimeContractVersion: RUNTIME_SUPPORT_CONTRACT,
  packageTreeDigest: 'c'.repeat(64), resolvedFromPackageTreeDigest: 'c'.repeat(64) };
const options = { target, now: () => new Date('2026-10-25T12:00:00Z') };
async function repo(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sutura-assess-')); roots.push(root);
  for (const [path, content] of Object.entries(files)) { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), content); }
  return root;
}
const nodeFiles = { 'package.json': JSON.stringify({ name: 'test', engines: { node: '>=22' }, scripts: { test: 'vitest run' } }),
  'pnpm-lock.yaml': 'lockfileVersion: "9.0"\nimporters: { .: {} }\n', '.github/workflows/ci.yml': 'jobs:\n  unit:\n    steps: [{ run: pnpm test }]\n' };
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('provider-free repository assessment', () => {
  it('assesses locked Node metadata without writes or a fabricated full-tree identity', async () => {
    const root = await repo(nodeFiles), before = await readdir(root, { recursive: true });
    const result = await assessRepository(root, options);
    expect(result).toMatchObject({ schemaVersion: 'sutura-repository-assessment-v1', scopeKind: 'metadata-only', complete: true });
    expect(result.jobs[0]).toMatchObject({ support: 'candidate-supported', target, scope: { localMetadataDigest: result.scopeDigest }, readiness: { prepared: 'unmeasured', reproduced: 'unmeasured' } });
    expect(result.jobs[0]?.scope.localTreeDigest).toBeUndefined();
    expect(await readdir(root, { recursive: true })).toEqual(before);
  });
  it('assesses public frozen Python and keeps service jobs unsupported independently', async () => {
    const root = await repo({ 'pyproject.toml': '[project]\nname="fixture"\nrequires-python=">=3.13"\n', 'uv.lock': 'version=1\n[[package]]\nname="fixture"\nsource={editable="."}\n',
      '.github/workflows/ci.yml': 'jobs:\n  unit:\n    steps: [{ run: uv run pytest }]\n  integration:\n    services: { db: { image: postgres } }\n    steps: [{ run: uv run pytest }]\n' });
    expect((await assessRepository(root, options)).jobs.map(job => job.support)).toEqual(['candidate-supported', 'unsupported']);
  });
  it('finds exact workspace manifests and private dependency origins', async () => {
    const root = await repo({ ...nodeFiles, 'pnpm-workspace.yaml': 'packages: ["packages/*"]', 'packages/a/package.json': JSON.stringify({ name: '@test/a', scripts: { test: 'vitest run' }, dependencies: { private: 'git+ssh://git.invalid/private' } }) });
    expect((await assessRepository(root, options)).jobs[0]?.reason).toBe('dependency-origin-unsupported');
  });
  it('uses declared workspace manifests without inheriting unrelated nested project blockers', async () => {
    const root = await repo({ ...nodeFiles, 'pnpm-workspace.yaml': 'packages: ["packages/*"]',
      'package.json': JSON.stringify({ scripts: { test: 'pnpm --filter @test/a test' } }),
      'packages/a/package.json': JSON.stringify({ name: '@test/a', scripts: { test: 'vitest run' } }),
      'examples/private/package.json': JSON.stringify({ dependencies: { private: 'git+ssh://git.invalid/private' } }) });
    const result = await assessRepository(root, options);
    expect(result.jobs[0]?.support).toBe('candidate-supported');
    expect(result.inputs).toContainEqual({ path: 'packages/a/package.json', sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
  });
  it('leaves invalid encoding and malformed workflow metadata incomplete', async () => {
    const root = await repo(nodeFiles);
    await writeFile(join(root, 'pnpm-lock.yaml'), Buffer.from([0xff, 0xfe]));
    expect((await assessRepository(root, options)).complete).toBe(false);
    await writeFile(join(root, 'pnpm-lock.yaml'), nodeFiles['pnpm-lock.yaml']);
    await writeFile(join(root, '.github/workflows/ci.yml'), 'jobs: {}\njobs: {}');
    expect((await assessRepository(root, options)).complete).toBe(false);
  });
  it('never executes malicious scripts and never exposes secret file contents', async () => {
    const secret = 'NEVER-RETURN-THIS-CREDENTIAL', root = await repo({ ...nodeFiles, '.env': secret, '.npmrc': `//registry.npmjs.org/:_authToken=${secret}`, 'package.json': JSON.stringify({ scripts: { test: 'touch assessment-executed; curl https://invalid.example' } }) });
    const result = await assessRepository(root, options);
    expect(result.jobs[0]?.support).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(await readdir(root)).not.toContain('assessment-executed');
    expect(await readFile(join(root, '.env'), 'utf8')).toBe(secret);
  });
  it('does not follow escaping file or directory symlinks', async () => {
    const outside = await repo({ 'package.json': '{"secret":"outside"}' }), root = await repo(nodeFiles);
    await symlink(join(outside, 'package.json'), join(root, 'linked.json'));
    await symlink(outside, join(root, 'outside'));
    const result = await assessRepository(root, options);
    expect(result.complete).toBe(false); expect(result.jobs[0]?.support).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain('outside"}');
  });
  it('reports oversized metadata and elapsed bounds as incomplete', async () => {
    const root = await repo({ ...nodeFiles, 'pnpm-lock.yaml': 'x'.repeat(1_048_577) });
    expect((await assessRepository(root, options)).complete).toBe(false);
    let tick = 0;
    expect((await assessRepository(root, { target, now: () => new Date(Date.UTC(2026, 9, 25) + tick++ * 10_000) })).complete).toBe(false);
  });
  it('enforces the elapsed budget even when the observation timestamp is fixed', async () => {
    const root = await repo(nodeFiles); let tick = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => tick++ * 10_000);
    try { expect((await assessRepository(root, options)).complete).toBe(false); }
    finally { clock.mockRestore(); }
  });
  it('leaves dev default and older installed Action contracts unknown', async () => {
    const root = await repo(nodeFiles);
    expect((await assessRepository(root)).jobs[0]?.reason).toBe('target-contract-unavailable');
    const old: TargetRuntimeContract = { kind: 'installed-action', actionSha: 'a'.repeat(40), resolvedFromActionSha: 'a'.repeat(40), runtimeContractVersion: 'old' };
    expect((await assessRepository(root, { target: old })).jobs[0]?.reason).toBe('target-contract-unavailable');
  });
  it('reports a repository without workflows without claiming configuration or reproduction', async () => {
    const root = await repo({ 'package.json': nodeFiles['package.json'] });
    const result = await assessRepository(root, options); expect(result.jobs).toEqual([]); expect(result.nextAction).toMatch(/workflow/iu);
  });
  it('preserves per-job polyglot selection and refuses unresolved matrix conditions', async () => {
    const root = await repo({ ...nodeFiles, 'pyproject.toml': '[project]\nname="fixture"\n', 'uv.lock': 'version=1\n[[package]]\nname="fixture"\nsource={editable="."}\n',
      '.github/workflows/ci.yml': 'jobs:\n  node:\n    steps: [{ uses: actions/setup-node@v4 }, { run: pnpm test }]\n  matrix:\n    strategy: { matrix: { node: [22, 24] } }\n    steps: [{ run: pnpm test }]\n' });
    expect((await assessRepository(root, options)).jobs.map(job => job.support)).toEqual(['candidate-supported', 'unknown']);
  });
});

it('retains the known control block through real workflow parsing and repository assessment', async () => {
  const command = await readFile(new URL('../../core/src/engine/__fixtures__/native-ci-control.sh', import.meta.url), 'utf8');
  const workflow = `jobs:\n  routing:\n    steps:\n      - run: |\n${command.trimEnd().split('\n').map(line => `          ${line}`).join('\n')}\n      - run: node --test test/example.test.mjs\n`;
  const root = await repo({ ...nodeFiles, '.github/workflows/ci.yml': workflow });
  expect((await assessRepository(root, options)).jobs[0]).toMatchObject({ support: 'unsupported', reason: 'native-command-admission', nextAction: expect.stringContaining('Sutura') });
});
