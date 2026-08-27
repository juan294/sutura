import { describe, expect, it, vi } from 'vitest';

import { runCli } from './cli.js';

describe('placebo CLI', { timeout: 120_000 }, () => {
  it('prints honest JSON for the dummy control', async () => {
    const write = vi.fn();
    const exitCode = await runCli(['run', '--adapter', 'dummy'], { write });

    expect(exitCode).toBe(0);
    expect(JSON.parse(write.mock.calls[0]?.[0] as string)).toMatchObject({
      score: { catchRate: { refused: 0, of: 8 } },
    });
  });

  it('filters by kind and propagates --no-tavily', async () => {
    const write = vi.fn();
    const exitCode = await runCli(
      ['run', '--adapter', 'dummy', '--only', 'upstream', '--no-tavily'],
      { write },
    );
    const output = JSON.parse(write.mock.calls[0]?.[0] as string) as { results: unknown[] };

    expect(exitCode).toBe(0);
    expect(output.results).toHaveLength(4);
  });

  it('rejects an unknown adapter', async () => {
    const writeError = vi.fn();
    await expect(runCli(['run', '--adapter', 'unknown'], { writeError })).resolves.toBe(2);
    expect(writeError).toHaveBeenCalled();
  });
});
