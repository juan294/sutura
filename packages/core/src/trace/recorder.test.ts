import { describe, expect, it } from 'vitest';

import { TraceRecorder } from './recorder.js';

describe('TraceRecorder', () => {
  it('records a versioned monotonic sequence with run-relative timestamps', () => {
    const ticks = [10_000, 10_025, 10_020];
    const recorder = new TraceRecorder('run-1', { now: () => ticks.shift() ?? 10_020 });

    recorder.record({ type: 'run-start', stage: 'run', summary: 'started' });
    recorder.record({ type: 'search-decision', stage: 'search', summary: 'expanded branch' });
    recorder.record({ type: 'run-finish', stage: 'run', outcome: 'gave-up' });

    expect(recorder.events().map(({ schemaVersion, runId, sequence, timestampMs }) => ({
      schemaVersion, runId, sequence, timestampMs,
    }))).toEqual([
      { schemaVersion: 'sutura-trace-v1', runId: 'run-1', sequence: 1, timestampMs: 0 },
      { schemaVersion: 'sutura-trace-v1', runId: 'run-1', sequence: 2, timestampMs: 25 },
      { schemaVersion: 'sutura-trace-v1', runId: 'run-1', sequence: 3, timestampMs: 25 },
    ]);
  });

  it('sanitizes every event while preserving the bounded provider request ID', () => {
    const recorder = new TraceRecorder('run-secret', { now: () => 1 });
    recorder.record({
      type: 'model-response',
      stage: 'candidate',
      role: 'assistant',
      model: 'model-a',
      summary: '<think>private chain</think> token=abc123 final answer',
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: 3,
      latencyMs: 12,
      costUsd: 0.01,
      requestId: 'provider-request-123',
    });

    const serialized = JSON.stringify(recorder.events());
    expect(serialized).not.toContain('private chain');
    expect(serialized).not.toContain('abc123');
    expect(serialized).toContain('provider-request-123');
    expect(serialized).toContain('[redacted]');
  });

  it('removes snake-case secrets, hidden reasoning, and complete source arguments recursively', () => {
    const recorder = new TraceRecorder('run-nested', { now: () => 1 });
    recorder.record({
      type: 'tool-request', stage: 'candidate', toolCallId: 'call-1', toolName: 'apply_patch',
      argumentSummary: {
        reasoning_content: 'do not store', api_key: 'small-secret',
        nested: { diff: 'const fullSource = true;', password: 'also-secret' },
      },
    });
    const serialized = JSON.stringify(recorder.events());
    expect(serialized).not.toMatch(/reasoning_content|api_key|do not store|small-secret|fullSource|also-secret/u);
  });

  it('removes an unclosed hidden-reasoning block at storage time', () => {
    const recorder = new TraceRecorder('run-truncated', { now: () => 1 });
    recorder.record({
      type: 'run-start', stage: 'run', summary: '<think>private truncated reasoning',
    });

    expect(JSON.stringify(recorder.events())).not.toContain('private truncated reasoning');
  });
});
