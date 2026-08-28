import { describe, expect, it, vi } from 'vitest';

import type { Diagnosis } from '../domain.js';
import type { Executor, RunResult } from '../executor/types.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { RepairBudget, DEFAULT_REPAIR_BUDGET_LIMITS } from './repair-budget.js';
import { RepairToolRuntime } from './repair-tools.js';

const diagnosis: Diagnosis = {
  class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'pnpm test', errorExcerpt: 'failed',
};
const diff = [
  'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts',
  '@@ -1 +1 @@', '-export const a = 1;', '+export const a = 2;', '',
].join('\n');

function runResult(imageId: string, stdout = '', exitCode = 0): RunResult {
  return { imageId, stdout, stderr: '', exitCode, truncated: false, metrics: {} };
}

function runtime(
  script: RunResult[],
  policy = createDefaultRepositoryPolicy(),
) {
  const run = vi.fn(async () => script.shift() ?? runResult('unexpected', '', 1));
  const executor = { run, runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn() } as unknown as Executor;
  return { run, tools: new RepairToolRuntime({
    executor, initialImageId: 'baseline', diagnosis,
    policy,
    budget: new RepairBudget(DEFAULT_REPAIR_BUDGET_LIMITS),
    trustedCommands: { diagnosed: 'pnpm test', 'policy-1': 'pnpm lint' },
    sourceContext: { sources: [] },
  }) };
}

describe('RepairToolRuntime', () => {
  it('rejects sensitive and policy-denied reads before sandbox execution', async () => {
    const { tools, run } = runtime([]);
    await expect(tools.execute('read_file', { path: '.env' })).resolves.toMatchObject({ ok: false, kind: 'policy' });
    await expect(tools.execute('read_file', { path: '../outside' })).resolves.toMatchObject({ ok: false, kind: 'invalid' });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', 'src/missing.ts', 'test -f'],
    ['binary', 'src/binary.dat', 'grep -Iq'],
    ['oversized', 'src/large.ts', 'wc -c'],
    ['direct symlink', 'src/link.ts', "test ! -L 'src/link.ts'"],
    ['ancestor symlink', 'src/link/file.ts', "test ! -L 'src/link'"],
  ])('rejects a %s read without returning file content', async (_scenario, path, condition) => {
    const { tools, run } = runtime([runResult('read-child', '', 1)]);

    await expect(tools.execute('read_file', { path })).resolves.toMatchObject({
      ok: false,
      kind: 'sandbox',
      message: expect.stringContaining('missing, binary, oversized, or symlinked'),
    });
    const command = (run.mock.calls[0] as unknown as [string, string])[1];
    expect(command).toContain(condition);
  });

  it.each([
    ['read_file', { path: 'src/a.ts' }],
    ['search_repo', { query: 'needle' }],
    ['run_test', { commandId: 'diagnosed' }],
    ['apply_patch', { diff }],
    ['inspect_diff', {}],
    ['submit_candidate', { id: 'fix', rationale: 'repair' }],
  ])('rejects additional keys for %s before execution', async (name, args) => {
    const { tools, run } = runtime([]);

    await expect(tools.execute(name, { ...args, unexpected: true })).resolves.toMatchObject({
      ok: false,
      kind: 'invalid',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects an unknown tool before execution', async () => {
    const { tools, run } = runtime([]);
    await expect(tools.execute('shell', {})).resolves.toMatchObject({ ok: false, kind: 'invalid' });
    expect(run).not.toHaveBeenCalled();
  });

  it('resolves tests only from trusted identifiers and keeps the editable image unchanged', async () => {
    const { tools, run } = runtime([runResult('test-child', 'passed')]);
    await expect(tools.execute('run_test', { commandId: 'arbitrary' })).resolves.toMatchObject({ ok: false });
    await expect(tools.execute('run_test', { commandId: 'diagnosed' })).resolves.toMatchObject({ ok: true });
    expect(run).toHaveBeenCalledOnce();
    expect(tools.state().editableImageId).toBe('baseline');
    expect(tools.state().latestTest?.imageId).toBe('test-child');
  });

  it('passes repository searches as quoted literal patterns', async () => {
    const { tools, run } = runtime([runResult('search-child', 'one match')]);
    await expect(tools.execute('search_repo', { query: '$(touch /tmp/not-run)' }))
      .resolves.toMatchObject({ ok: true });
    expect(run).toHaveBeenCalledWith(
      'baseline',
      expect.stringContaining("-e '$(touch /tmp/not-run)' -- '.'"),
      expect.any(Object),
    );
    expect(tools.state().editableImageId).toBe('baseline');
  });

  it('excludes sensitive and denied descendants from repository search output', async () => {
    const output = [
      'src/a.ts:1:needle',
      '.env:1:TOKEN=secret',
      'src/private/token.ts:1:secret',
    ].join('\n');
    const { tools, run } = runtime(
      [runResult('search-child', output)],
      { ...createDefaultRepositoryPolicy(), deniedReadPaths: ['src/private/**'] },
    );
    const result = await tools.execute('search_repo', { query: 'needle' });

    expect(result.message).toContain('src/a.ts');
    expect(result.message).not.toMatch(/TOKEN|src\/private/u);
    const searchCommand = (run.mock.calls[0] as unknown as [string, string])[1];
    expect(searchCommand).toContain("':(exclude,glob)src/private/**'");
  });

  it('advances only apply_patch and validates the complete cumulative diff', async () => {
    const { tools } = runtime([
      runResult('patched', diff),
      runResult('test-child', 'passed'),
      runResult('inspection', diff),
    ]);
    await expect(tools.execute('apply_patch', { diff })).resolves.toMatchObject({ ok: true });
    expect(tools.state().editableImageId).toBe('patched');
    await tools.execute('run_test', { commandId: 'diagnosed' });
    expect(tools.state().editableImageId).toBe('patched');
    await tools.execute('inspect_diff', {});
    expect(tools.state().editableImageId).toBe('patched');
    await expect(tools.execute('submit_candidate', { id: 'fix', rationale: 'small fix' }))
      .resolves.toMatchObject({ ok: true, submitted: true });
  });

  it('rejects truncated diffs and test output without advancing or recording evidence', async () => {
    const truncated = { ...runResult('partial', diff), truncated: true };
    const { tools } = runtime([truncated, truncated]);

    await expect(tools.execute('apply_patch', { diff })).resolves.toMatchObject({ ok: false });
    expect(tools.state().editableImageId).toBe('baseline');
    await expect(tools.execute('run_test', { commandId: 'diagnosed' })).resolves.toMatchObject({ ok: false });
    expect(tools.state().latestTest).toBeUndefined();
  });

  it('caps sandbox timeout by the remaining elapsed budget', async () => {
    let now = 0;
    const budget = new RepairBudget({ ...DEFAULT_REPAIR_BUDGET_LIMITS, elapsedTimeSec: 1 }, () => now);
    now = 750;
    const run = vi.fn(async () => runResult('child', 'text'));
    const executor = { run, runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn() } as unknown as Executor;
    const tools = new RepairToolRuntime({
      executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget,
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: { sources: [] },
    });

    await tools.execute('read_file', { path: 'src/a.ts' });
    const options = (run.mock.calls[0] as unknown as [string, string, { timeoutSec: number }])[2];
    expect(options).toMatchObject({ timeoutSec: 0.25 });
  });
});
