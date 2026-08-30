import { describe, expect, it, vi } from 'vitest';

import type { Executor } from '../executor/types.js';
import { ReplayRecorder } from './bundle.js';
import { recordingExecutor } from './record-executor.js';

const CONFIG = {
  triageN: 1, raceK: 1,
  models: { nano: 'nano', super: 'super', ultra: 'ultra' },
  routingProfileId: 'test', maxOps: 1,
} as const;

describe('recordingExecutor', () => {
  it('records every logical executor operation and preserves exact results', async () => {
    const runResult = {
      imageId: 'image-2', exitCode: 0, stdout: 'ok', stderr: '', truncated: false, metrics: {},
    };
    const executor = {
      importImage: vi.fn(async () => 'image-1'),
      snapshot: vi.fn(async () => 'image-2'),
      run: vi.fn(async () => runResult),
      runMany: vi.fn(async () => [runResult]),
      operationCapacity: vi.fn(() => ({ limit: 40, active: 1, available: 39 })),
      cancel: vi.fn(async () => ({ operationId: 'operation-1', requested: true })),
    } satisfies Executor;
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const wrapped = recordingExecutor(executor, recorder);

    await expect(wrapped.importImage('node:22')).resolves.toBe('image-1');
    await expect(wrapped.snapshot('/tmp/repo', 'image-1', {
      profile: 'repository', mode: 'replace',
    })).resolves.toBe('image-2');
    await expect(wrapped.run('image-2', 'pnpm test')).resolves.toBe(runResult);
    await expect(wrapped.runMany('image-2', ['pnpm test'])).resolves.toEqual([runResult]);
    expect(wrapped.operationCapacity()).toEqual({ limit: 40, active: 1, available: 39 });
    await expect(wrapped.cancel('operation-1')).resolves.toEqual({
      operationId: 'operation-1', requested: true,
    });

    expect(recorder.finish('fixed').executor.map(({ method }) => method)).toEqual([
      'importImage', 'snapshot', 'run', 'runMany', 'operationCapacity', 'cancel',
    ]);
  });

  it('records and rethrows executor failures', async () => {
    const failure = new Error('sandbox unavailable');
    const executor = { importImage: vi.fn(async () => { throw failure; }) } as unknown as Executor;
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);

    await expect(recordingExecutor(executor, recorder).importImage('node:22'))
      .rejects.toBe(failure);
    expect(recorder.finish('infra-stop').executor[0]?.result).toEqual({
      error: 'sandbox unavailable',
    });
  });
});
