import { describe, expect, it } from 'vitest';

import { InMemoryExecutor } from './memory.js';

describe('InMemoryExecutor', () => {
  it('creates deterministic image IDs and records calls', async () => {
    const executor = new InMemoryExecutor(() => ({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      truncated: false,
      metrics: {},
    }));

    const imported = await executor.importImage('node:22-slim');
    const snapshot = await executor.snapshot('/repo', imported);
    const result = await executor.run(snapshot, 'pnpm test', {
      cwd: '/workspace',
      env: { CI: 'true' },
      timeoutSec: 60,
    });

    expect([imported, snapshot, result.imageId]).toEqual([
      'mem-1',
      'mem-2',
      'mem-3',
    ]);
    expect(executor.calls).toEqual([
      { kind: 'importImage', ref: 'node:22-slim', imageId: 'mem-1' },
      { kind: 'snapshot', dir: '/repo', base: 'mem-1', imageId: 'mem-2' },
      {
        kind: 'run',
        parent: 'mem-2',
        cmd: 'pnpm test',
        opts: { cwd: '/workspace', env: { CI: 'true' }, timeoutSec: 60 },
        imageId: 'mem-3',
      },
    ]);
  });

  it('can script three divergent exits in five runs from one parent', async () => {
    const exits = [1, 0, 1, 0, 1];
    const executor = new InMemoryExecutor((_cmd, _parent, callIndex) => ({
      exitCode: exits[callIndex] ?? 0,
      stdout: '',
      stderr: '',
      truncated: false,
      metrics: {},
    }));

    const results = await executor.runMany('mem-parent', Array(5).fill('test'));

    expect(results.map(({ exitCode }) => exitCode)).toEqual(exits);
    expect(results.filter(({ exitCode }) => exitCode !== 0)).toHaveLength(3);
    expect(results.map(({ imageId }) => imageId)).toEqual([
      'mem-1',
      'mem-2',
      'mem-3',
      'mem-4',
      'mem-5',
    ]);
    expect(executor.calls.every((call) => call.kind === 'run')).toBe(true);
  });
});
