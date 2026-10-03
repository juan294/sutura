import { afterEach, describe, expect, it, vi } from 'vitest';

import { EXECUTOR_CURSOR_OPTIONS, RecordedExecutor } from './replay-executor.js';
import { describeMethodCall, RecordedCallCursor } from './recorded-call-cursor.js';
import { ReplayMismatchError } from './replay-error.js';
import type { RecordedExecutorCall } from './bundle.js';

function runRecord(sequence: number, parent: string, operationId: string, cmd = 'pnpm test'): RecordedExecutorCall {
  return {
    sequence, method: 'run', args: [parent, cmd, { operationId, timeoutSec: 120 }],
    result: { imageId: `${operationId}-image`, exitCode: 0, stdout: '', stderr: '', truncated: false, metrics: {} },
  };
}

describe('RecordedExecutor', () => {
  afterEach(() => { vi.useRealTimers(); });

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

  it('matches concurrent branch calls issued out of recorded order', async () => {
    const calls = [
      runRecord(1, 'base', 'search-001-op-001'),
      runRecord(2, 'base', 'search-002-op-001'),
      runRecord(3, 'search-001-op-001-image', 'search-001-op-002'),
    ];
    const cursor = new RecordedCallCursor(calls, describeMethodCall, 'executor', EXECUTOR_CURSOR_OPTIONS);
    const executor = new RecordedExecutor(calls, undefined, cursor, { quietMs: 10 });

    const second = executor.run('base', 'pnpm test', { operationId: 'search-002-op-001', timeoutSec: 120 });
    const first = executor.run('base', 'pnpm test', { operationId: 'search-001-op-001', timeoutSec: 120 });
    await expect(second).resolves.toMatchObject({ imageId: 'search-002-op-001-image' });
    await expect(first).resolves.toMatchObject({ imageId: 'search-001-op-001-image' });
    await expect(executor.run('search-001-op-001-image', 'pnpm test', { operationId: 'search-001-op-002', timeoutSec: 120 }))
      .resolves.toMatchObject({ imageId: 'search-001-op-002-image' });
    expect(() => cursor.assertConsumed()).not.toThrow();
  });

  // Case Lab run 37099476028 (2026-10-03): search-002 and search-003 both passed
  // their tests live, and search-002's result came first, so it took the
  // recovery audit. Served from memory, search-003's result resolved first and
  // the replay audited the wrong branch. Results must follow recorded order.
  it('resolves branch results in recorded order, whatever order the replay issues them in', async () => {
    const calls = [
      runRecord(1, 'base', 'search-001-op-001'),
      runRecord(2, 'base', 'search-002-op-001'),
      runRecord(3, 'base', 'search-003-op-001'),
    ];
    const executor = new RecordedExecutor(calls, undefined, undefined, { quietMs: 10 });
    const resolved: string[] = [];
    const issue = (operationId: string) =>
      executor.run('base', 'pnpm test', { operationId, timeoutSec: 120 }).then(() => { resolved.push(operationId); });

    await Promise.all([issue('search-003-op-001'), issue('search-001-op-001'), issue('search-002-op-001')]);

    expect(resolved).toEqual(['search-001-op-001', 'search-002-op-001', 'search-003-op-001']);
  });

  it('lets a released continuation that spans macrotasks reach its next call before releasing the next result', async () => {
    const calls = [
      runRecord(1, 'base', 'search-001-op-001'),
      runRecord(2, 'base', 'search-002-op-001'),
      runRecord(3, 'search-001-op-001-image', 'search-001-op-002'),
    ];
    const executor = new RecordedExecutor(calls);
    const events: string[] = [];
    const first = async () => {
      await executor.run('base', 'pnpm test', { operationId: 'search-001-op-001', timeoutSec: 120 });
      await new Promise((resolve) => setTimeout(resolve, 30));
      events.push('search-001 admitted');
      await executor.run('search-001-op-001-image', 'pnpm test', { operationId: 'search-001-op-002', timeoutSec: 120 });
    };
    const second = async () => {
      await executor.run('base', 'pnpm test', { operationId: 'search-002-op-001', timeoutSec: 120 });
      events.push('search-002 admitted');
    };

    await Promise.all([second(), first()]);

    expect(events).toEqual(['search-001 admitted', 'search-002 admitted']);
  });

  it('never releases past an unissued earlier call within the deadline, however short the quiet period', async () => {
    const calls = [runRecord(1, 'base', 'search-001-op-001'), runRecord(2, 'base', 'search-002-op-001')];
    const executor = new RecordedExecutor(calls, undefined, undefined, { quietMs: 1, deadlineMs: 5_000 });
    const resolved: string[] = [];

    const later = executor.run('base', 'pnpm test', { operationId: 'search-002-op-001', timeoutSec: 120 })
      .then(() => { resolved.push('search-002'); });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(resolved).toEqual([]);
    await executor.run('base', 'pnpm test', { operationId: 'search-001-op-001', timeoutSec: 120 })
      .then(() => { resolved.push('search-001'); });
    await later;

    expect(resolved).toEqual(['search-001', 'search-002']);
  });

  it('rejects recorded failures in recorded order', async () => {
    const failed: RecordedExecutorCall = {
      sequence: 1, method: 'run', args: ['base', 'pnpm test', { operationId: 'search-001-op-001', timeoutSec: 120 }],
      result: { error: { name: 'Error', message: 'sandbox lost' } },
    };
    const executor = new RecordedExecutor([failed, runRecord(2, 'base', 'search-002-op-001')], undefined, undefined, { quietMs: 10 });
    const settled: string[] = [];

    await Promise.all([
      executor.run('base', 'pnpm test', { operationId: 'search-002-op-001', timeoutSec: 120 }).then(() => { settled.push('search-002'); }),
      executor.run('base', 'pnpm test', { operationId: 'search-001-op-001', timeoutSec: 120 }).catch(() => { settled.push('search-001 failed'); }),
    ]);

    expect(settled).toEqual(['search-001 failed', 'search-002']);
  });

  it('leaves no timer behind once disposed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate'] });
    const calls = [runRecord(1, 'base', 'search-001-op-001'), runRecord(2, 'base', 'search-002-op-001')];
    const executor = new RecordedExecutor(calls);

    void executor.run('base', 'pnpm test', { operationId: 'search-002-op-001', timeoutSec: 120 });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    executor.dispose();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let a mismatched call hold back later results', async () => {
    const calls = [runRecord(1, 'base', 'search-001-op-001'), runRecord(2, 'base', 'search-002-op-001')];
    const executor = new RecordedExecutor(calls, undefined, undefined, { quietMs: 10, deadlineMs: 60_000 });

    expect(() => executor.run('base', 'pnpm lint', { operationId: 'search-001-op-001', timeoutSec: 120 }))
      .toThrow(ReplayMismatchError);
    await expect(executor.run('base', 'pnpm test', { operationId: 'search-002-op-001', timeoutSec: 120 }))
      .resolves.toMatchObject({ imageId: 'search-002-op-001-image' });
  });

  it('still fails closed on a command no branch recorded, naming the positional record', async () => {
    const calls = [runRecord(1, 'base', 'search-001-op-001'), runRecord(2, 'base', 'search-002-op-001')];
    const cursor = new RecordedCallCursor(calls, describeMethodCall, 'executor', EXECUTOR_CURSOR_OPTIONS);
    const executor = new RecordedExecutor(calls, undefined, cursor);

    let error: unknown;
    try {
      await executor.run('base', 'pnpm lint', { operationId: 'search-002-op-001', timeoutSec: 120 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ReplayMismatchError);
    expect(error).toMatchObject({ sequence: 1, path: '$[1]', expected: 'pnpm test', actual: 'pnpm lint' });
    expect(() => cursor.rethrowMismatch()).toThrow(ReplayMismatchError);
  });

  it('fails closed when a recorded branch call is never issued', async () => {
    const calls = [runRecord(1, 'base', 'search-001-op-001'), runRecord(2, 'base', 'search-002-op-001')];
    const cursor = new RecordedCallCursor(calls, describeMethodCall, 'executor', EXECUTOR_CURSOR_OPTIONS);
    const executor = new RecordedExecutor(calls, undefined, cursor, { deadlineMs: 10 });

    await executor.run('base', 'pnpm test', { operationId: 'search-002-op-001', timeoutSec: 120 });
    expect(() => cursor.assertConsumed()).toThrow(/run remains/u);
  });

  it('treats capacity probes and cancellations as observational', async () => {
    const calls: RecordedExecutorCall[] = [
      { sequence: 1, method: 'operationCapacity', args: [], result: { limit: 4, active: 0, available: 4 } },
      runRecord(2, 'base', 'search-001-op-001'),
      { sequence: 3, method: 'cancel', args: ['search-002-op-001'], result: { operationId: 'search-002-op-001', requested: true } },
      { sequence: 4, method: 'cancel', args: ['search-003-op-001'], result: { operationId: 'search-003-op-001', requested: true } },
    ];
    const cursor = new RecordedCallCursor(calls, describeMethodCall, 'executor', EXECUTOR_CURSOR_OPTIONS);
    const executor = new RecordedExecutor(calls, undefined, cursor);

    expect(executor.operationCapacity()).toEqual({ limit: 4, active: 0, available: 4 });
    expect(executor.operationCapacity()).toEqual({ limit: 4, active: 0, available: 4 });
    await expect(executor.run('base', 'pnpm test', { operationId: 'search-001-op-001', timeoutSec: 120 }))
      .resolves.toMatchObject({ exitCode: 0 });
    await expect(executor.cancel('search-003-op-001')).resolves.toEqual({ operationId: 'search-003-op-001', requested: true });
    await expect(executor.cancel('search-009-op-001')).resolves.toEqual({ operationId: 'search-009-op-001', requested: false });
    expect(() => cursor.assertConsumed()).not.toThrow();
  });

  it('fails closed on a capacity probe when none was ever recorded', () => {
    const executor = new RecordedExecutor([]);
    expect(() => executor.operationCapacity()).toThrow(ReplayMismatchError);
  });

  it('accepts a logical checkout-path normalizer', async () => {
    const options = { profile: 'repository', mode: 'replace' } as const;
    const executor = new RecordedExecutor([
      { sequence: 1, method: 'snapshot', args: ['checkout-1', 'image-1', options], result: 'image-2' },
    ], (args) => args.map((value) => value === '/tmp/replay-checkout' ? 'checkout-1' : value));

    await expect(executor.snapshot('/tmp/replay-checkout', 'image-1', options)).resolves.toBe('image-2');
  });
});
