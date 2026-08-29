import { describe, expect, it, vi } from 'vitest';

import { runCli } from './cli.js';
import { score } from './score.js';
import type { BenchmarkReport } from './types.js';

function report(resultCount = 0): BenchmarkReport {
  return {
    adapter: 'dummy',
    results: Array.from({ length: resultCount }, () => ({})) as BenchmarkReport['results'],
    score: {
      ...score([]),
      catchRate: { refused: 0, of: 19 },
    },
  };
}

describe('placebo CLI', { timeout: 120_000 }, () => {
  it('prints honest JSON for the dummy control', async () => {
    const write = vi.fn();
    const benchmark = vi.fn(async (adapter) => {
      expect(adapter.name).toBe('dummy');
      return report();
    });
    const exitCode = await runCli(
      ['run', '--adapter', 'dummy'],
      { write },
      { benchmark },
    );

    expect(exitCode).toBe(0);
    expect(benchmark).toHaveBeenCalledOnce();
    expect(JSON.parse(write.mock.calls[0]?.[0] as string)).toMatchObject({
      score: { catchRate: { refused: 0, of: 19 } },
    });
  });

  it('filters by kind and propagates --no-tavily', async () => {
    const write = vi.fn();
    const benchmark = vi.fn().mockResolvedValue(report(4));
    const exitCode = await runCli(
      ['run', '--adapter', 'dummy', '--only', 'upstream', '--no-tavily'],
      { write },
      { benchmark },
    );
    const output = JSON.parse(write.mock.calls[0]?.[0] as string) as { results: unknown[] };

    expect(exitCode).toBe(0);
    expect(benchmark).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'dummy' }),
      { only: 'upstream', noTavily: true },
    );
    expect(output.results).toHaveLength(4);
  });

  it('rejects an unknown adapter', async () => {
    const writeError = vi.fn();
    await expect(runCli(['run', '--adapter', 'unknown'], { writeError })).resolves.toBe(2);
    expect(writeError).toHaveBeenCalled();
  });

  it('rejects a missing manifest output path before running the benchmark', async () => {
    const writeError = vi.fn();
    const benchmark = vi.fn();

    await expect(runCli(
      ['run', '--adapter', 'dummy', '--manifest-output'],
      { writeError },
      { benchmark },
    )).resolves.toBe(2);
    expect(writeError).toHaveBeenCalledWith('--manifest-output requires a file path\n');
    expect(benchmark).not.toHaveBeenCalled();
  });

  it('captures a manifest only with explicit output and a clean exact commit', async () => {
    const write = vi.fn();
    const benchmark = vi.fn().mockResolvedValue({
      adapter: 'dummy', results: [], score: { catchRate: { refused: 0, of: 0 } },
      manifest: { schemaVersion: 'sutura-evaluation-v1', evaluationId: 'placebo-dummy' },
    });
    const output = `/tmp/placebo-manifest-${process.pid}-${Date.now()}.json`;

    const exitCode = await runCli(
      ['run', '--adapter', 'dummy', '--manifest-output', output],
      { write },
      {
        benchmark,
        repositoryState: async () => ({ commit: 'a'.repeat(40), clean: true }),
      },
    );

    expect(exitCode).toBe(0);
    expect(benchmark).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      manifest: expect.objectContaining({ suturaCommit: 'a'.repeat(40), repositoryClean: true }),
    }));
    await import('node:fs/promises').then(({ rm }) => rm(output, { force: true }));
  });
});
