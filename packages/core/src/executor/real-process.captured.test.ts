import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ContreeExecutor } from './contree.js';
import { StageLedger } from '../heal.js';
import { compareFailureIdentity } from '../engine/failure-identity.js';
import { triage } from '../engine/triage.js';
import type { Executor } from './types.js';

// Structural capture: termination/duration fields retain the real provider shape;
// identifiers, output paths and cost are synthetic, not private fleet evidence.
const operation = JSON.parse(readFileSync(new URL('./__fixtures__/operation-process-timeout-duration.json', import.meta.url), 'utf8'));
function executorFor(value: unknown): ContreeExecutor {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response('{}', { status: 201, headers: { Location: '/sandboxes/v1/operations/sanitized' } }))
    .mockResolvedValueOnce(Response.json(value));
  return new ContreeExecutor({ token: 'synthetic-token', project: 'synthetic-project', fetch, pollIntervalMs: 0 });
}

describe('real process termination boundary', () => {
  it('does not count contradictory timed-out successes as flaky passes', async () => {
    const result = { imageId: 'probe', exitCode: 0, stdout: 'passed', stderr: '', truncated: false, metrics: {}, processState: { timedOut: true } };
    const executor = { runMany: async () => [result, result] } as unknown as Executor;
    expect((await triage(executor, 'baseline', 'vitest run', 2)).stopReason).toBe('failure-identity');
  });
  it('retains killed-process evidence and measured duration/cost after provider operation success', async () => {
    const result = await executorFor(operation).run('baseline', 'node test-selector.mjs', { operationId: 'capture-timeout' });
    expect(result).toMatchObject({ operation: { terminal: 'succeeded' }, exitCode: -1, processState: { timedOut: true, signal: 9 }, metrics: { elapsedTimeSec: 0.001125, wallTimeSec: 60.6, cost: 0.0125 } });
    const ledger = new StageLedger();
    ledger.record({ stage: 'reproduction', attempt: 1, result, network: 'disabled' });
    expect(ledger.entries()).toContainEqual(expect.objectContaining({ processState: { timedOut: true, signal: 9 }, metrics: expect.objectContaining({ wallTimeSec: 60.6 }) }));
  });

  it('normalizes the provider no-signal sentinel on ordinary success', async () => {
    const value = structuredClone(operation);
    value.metadata.result.state = { exit_code: 0, signal: -1, timed_out: false };
    expect(await executorFor(value).run('base', 'true')).toMatchObject({ exitCode: 0, processState: { timedOut: false } });
  });

  it('leaves historical wall time unknown instead of assigning unconfirmed raw resource units', async () => {
    const legacy = JSON.parse(readFileSync(new URL('./__fixtures__/operation-process-timeout.json', import.meta.url), 'utf8'));
    const result = await executorFor(legacy).run('base', 'test');
    expect(result.metrics.wallTimeSec).toBeUndefined();
    expect(result.metrics.elapsedTimeSec).toBe(0.001125);
  });

  it.each([
    { state: { exit_code: 0, timed_out: 'true' } },
    { state: { exit_code: 0, signal: -2 } },
    { state: { exit_code: 0 }, invalidDuration: true },
  ])('refuses malformed optional process evidence', async result => {
    await expect(executorFor({ ...operation, ...('invalidDuration' in result ? { duration: -1 } : {}), metadata: { result } }).run('baseline', 'true')).rejects.toThrow();
  });

  it.each([
    { exitCode: 1, processState: { timedOut: true } },
    { exitCode: 1, processState: { signal: 9 } },
    { exitCode: -1 },
  ])('does not use an abnormal process containing the expected assertion as reproduction', sandbox => {
    const log = ' FAIL src/example.test.ts > adds\nAssertionError: expected 2 to be 3\n';
    expect(compareFailureIdentity({ command: 'vitest run', log }, { ...sandbox, log }).status).toBe('unavailable');
  });
});
