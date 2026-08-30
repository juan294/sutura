import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ReplayRecorder, type RepositoryPort } from '@sutura/core';

import { recordingRepositoryPort } from './replay-repository.js';

const CONFIG = {
  triageN: 1, raceK: 1,
  models: { nano: 'nano', super: 'super', ultra: 'ultra' },
  routingProfileId: 'test', maxOps: 1,
} as const;

describe('recordingRepositoryPort', () => {
  it('records all repository calls in order and returns exact results', async () => {
    const checkoutDir = await mkdtemp(join(tmpdir(), 'sutura-replay-repository-'));
    await mkdir(join(checkoutDir, 'src'));
    await writeFile(join(checkoutDir, 'package.json'), '{"type":"module"}');
    await writeFile(join(checkoutDir, 'src', 'value.ts'), 'export const value = 1;');
    const port = {
      readPolicyAtSha: vi.fn(async () => '{"runtime":"node"}'),
      checkoutHead: vi.fn(async () => checkoutDir),
      readSourceExcerpts: vi.fn(async () => [{
        path: 'src/value.ts', startLine: 1, content: 'value', truncated: false,
      }]),
      publishFix: vi.fn(async () => undefined),
    } satisfies RepositoryPort;
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const wrapped = recordingRepositoryPort(port, recorder);

    await expect(wrapped.readPolicyAtSha('acme/widget', 'a'.repeat(40)))
      .resolves.toBe('{"runtime":"node"}');
    await expect(wrapped.checkoutHead('acme/widget', 'a'.repeat(40)))
      .resolves.toBe(checkoutDir);
    await expect(wrapped.readSourceExcerpts(checkoutDir, [], {
      maxFiles: 1, maxLinesPerFile: 1, maxCharactersPerFile: 10, maxBytesPerFile: 10,
    })).resolves.toEqual([{
      path: 'src/value.ts', startLine: 1, content: 'value', truncated: false,
    }]);
    await expect(wrapped.publishFix({
      branch: 'sutura/fix-77001', checkoutDir, diff: '',
      headSha: 'a'.repeat(40), message: 'fix',
    })).resolves.toBeUndefined();

    const calls = recorder.finish('fixed').repository;
    expect(calls.map(({ method }) => method)).toEqual([
      'readPolicyAtSha', 'checkoutHead', 'readSourceExcerpts', 'publishFix',
    ]);
    expect(calls[1]?.result).toEqual({
      checkoutId: 'checkout-1',
      snapshot: {
        runtimeEvidencePaths: ['package.json', 'src/value.ts'],
        files: [{ path: 'package.json', content: '{"type":"module"}' }],
      },
    });
    expect(calls[2]?.args[0]).toBe('checkout-1');
    expect(calls[3]?.args[0]).toMatchObject({ checkoutDir: 'checkout-1' });
    await rm(checkoutDir, { recursive: true, force: true });
  });

  it('returns the checkout but marks an unsafe snapshot incomplete', async () => {
    const checkoutDir = await mkdtemp(join(tmpdir(), 'sutura-replay-repository-'));
    const outside = join(tmpdir(), `sutura-replay-outside-${String(process.pid)}.json`);
    await writeFile(outside, '{}');
    await symlink(outside, join(checkoutDir, 'package.json'));
    const port = {
      checkoutHead: vi.fn(async () => checkoutDir),
    } as unknown as RepositoryPort;
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);

    await expect(recordingRepositoryPort(port, recorder).checkoutHead(
      'acme/widget', 'a'.repeat(40),
    )).resolves.toBe(checkoutDir);

    const bundle = recorder.finish('infra-stop');
    expect(bundle.repository[0]?.result).toMatchObject({
      result: 'checkout-1',
      captureError: expect.stringContaining('must not be a symlink'),
    });
    expect(bundle.completeness).toMatchObject({
      complete: false,
      overflowedBoundaries: ['repository'],
    });
    await rm(checkoutDir, { recursive: true, force: true });
    await rm(outside, { force: true });
  });
});
