import { describe, expect, it } from 'vitest';

import { RecordedExecutor } from './replay-executor.js';
import type { RecordedExecutorCall } from './bundle.js';

describe('RecordedExecutor', () => {
  it('replays logical executor calls and validates their arguments', async () => {
    const calls: RecordedExecutorCall[] = [
      { sequence: 1, method: 'operationCapacity', args: [], result: { limit: 2, active: 0, available: 2 } },
      { sequence: 2, method: 'importImage', args: ['node:22'], result: 'image-1' },
      { sequence: 3, method: 'run', args: ['image-1', 'pnpm test', null], result: {
        imageId: 'image-2', exitCode: 1, stdout: '', stderr: 'failed', truncated: false, metrics: {},
      } },
    ];
    const executor = new RecordedExecutor(calls);

    expect(executor.operationCapacity()).toEqual({ limit: 2, active: 0, available: 2 });
    await expect(executor.importImage('node:22')).resolves.toBe('image-1');
    await expect(executor.run('image-1', 'pnpm test')).resolves.toMatchObject({ exitCode: 1 });
  });

  it('fails at the first differing argument path', async () => {
    const executor = new RecordedExecutor([
      { sequence: 1, method: 'importImage', args: ['node:22'], result: 'image-1' },
    ]);
    expect(() => executor.importImage('node:20')).toThrow(/\$\[0\]/u);
  });

  it('accepts a logical checkout-path normalizer', async () => {
    const options = { profile: 'repository', mode: 'replace' } as const;
    const executor = new RecordedExecutor([
      { sequence: 1, method: 'snapshot', args: ['checkout-1', 'image-1', options], result: 'image-2' },
    ], (args) => args.map((value) => value === '/tmp/replay-checkout' ? 'checkout-1' : value));

    await expect(executor.snapshot('/tmp/replay-checkout', 'image-1', options)).resolves.toBe('image-2');
  });
});
