import { expect, it, vi } from 'vitest';
import type { Executor } from './types.js';
import { preparationDeadlineExecutor } from './deadlines.js';
it('clamps preparation and initial probes to actual remaining ordinary case wall time', async () => {
  let now = 500_000; const run = vi.fn<Executor['run']>(async () => ({ imageId: 'child', exitCode: 0, stdout: '', stderr: '', truncated: false, metrics: {} }));
  const cancel = vi.fn<Executor['cancel']>(async operationId => ({ operationId, requested: true, terminal: 'cancelled' }));
  const executor = { run, cancel, importImage: vi.fn(async () => 'image'), snapshot: vi.fn(async () => 'snapshot'), operationCapacity: () => ({ limit: 1, active: 0, available: 1 }), runMany: vi.fn() } as Executor;
  const ports = preparationDeadlineExecutor(executor, 0, () => now);
  await ports.run('base', 'probe', { timeoutSec: 240 });
  expect(run.mock.calls[0]?.[2]?.timeoutSec).toBe(100);
  now = 600_000;
  await expect(ports.run('base', 'late')).rejects.toThrow(/elapsed/);
  await expect(ports.importImage('late')).rejects.toThrow(/elapsed/);
  expect(run).toHaveBeenCalledTimes(1);
});
