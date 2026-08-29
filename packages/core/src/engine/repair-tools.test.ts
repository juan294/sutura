import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

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

const execFileAsync = promisify(execFile);

function runResult(imageId: string, stdout = '', exitCode = 0, stderr = ''): RunResult {
  return { imageId, stdout, stderr, exitCode, truncated: false, metrics: {} };
}

function toolsFor(
  executor: Executor,
  policy = createDefaultRepositoryPolicy(),
  budget = new RepairBudget(DEFAULT_REPAIR_BUDGET_LIMITS),
): RepairToolRuntime {
  return new RepairToolRuntime({
    executor, initialImageId: 'baseline', diagnosis, policy, budget,
    trustedCommands: { diagnosed: 'pnpm test', 'policy-1': 'pnpm lint' },
    sourceContext: { sources: [] },
  });
}

function executorFor(run: ReturnType<typeof vi.fn>): Executor {
  return { run, runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn() } as unknown as Executor;
}

function runtime(
  script: RunResult[],
  policy = createDefaultRepositoryPolicy(),
) {
  const run = vi.fn(async () => script.shift() ?? runResult('unexpected', '', 1));
  return { run, tools: toolsFor(executorFor(run), policy) };
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

  it('resolves an absent ESM .js source reference to an allowed TypeScript sibling', async () => {
    const { tools, run } = runtime([
      runResult(
        'read-child',
        'export const add = () => 4;',
        0,
        'SUTURA_RESOLVED_SOURCE=packages/core/src/dogfood-add.ts\n',
      ),
    ]);

    await expect(tools.execute('read_file', { path: 'packages/core/src/dogfood-add.js' }))
      .resolves.toMatchObject({
        ok: true,
        message: expect.stringContaining('Sutura resolved source: packages/core/src/dogfood-add.ts'),
      });
    const command = (run.mock.calls[0] as unknown as [string, string])[1];
    expect(command).toContain("fallback='packages/core/src/dogfood-add.ts'");
    expect(command).toContain("fallback='packages/core/src/dogfood-add.tsx'");
    expect(command).toContain('test ! -L "$fallback"');
    expect(command.indexOf("test ! -L 'packages/core'")).toBeLessThan(command.indexOf('test -f "$fallback"'));
  });

  it('executes the fallback without losing its path at the line boundary and requires a tracked source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-read-file-'));
    try {
      await mkdir(join(directory, 'src'));
      await mkdir(join(directory, 'packages', 'core', 'src'), { recursive: true });
      await writeFile(join(directory, 'src', 'value.ts'), Array.from({ length: 160 }, (_, index) => `line ${index + 1}`).join('\n'));
      await writeFile(join(directory, 'src', 'untracked.ts'), 'not tracked');
      await writeFile(join(directory, 'packages', 'core', 'src', 'package-value.ts'), 'package source');
      await execFileAsync('git', ['init', '--quiet'], { cwd: directory });
      await execFileAsync('git', ['add', 'src/value.ts', 'packages/core/src/package-value.ts'], { cwd: directory });
      const run = vi.fn(async (_imageId: string, command: string) => {
        try {
          const result = await execFileAsync('/bin/sh', ['-c', command], { cwd: directory });
          return runResult('read-child', result.stdout, 0, result.stderr);
        } catch (error) {
          const failed = error as { stdout?: string; stderr?: string; code?: number };
          return runResult('read-child', failed.stdout ?? '', failed.code ?? 1, failed.stderr ?? '');
        }
      });
      const tools = toolsFor(executorFor(run));

      const resolved = await tools.execute('read_file', { path: 'src/value.js' });
      expect(resolved).toMatchObject({ ok: true });
      expect(resolved.message.split('\n')[0]).toBe('Sutura resolved source: src/value.ts');
      expect(resolved.message).toContain('line 160');
      await expect(tools.execute('read_file', { path: 'src/untracked.js' }))
        .resolves.toMatchObject({ ok: false, kind: 'sandbox' });
      await expect(tools.execute('read_file', { path: 'src/package-value.js' }))
        .resolves.toMatchObject({
          ok: true,
          message: 'Sutura resolved source: packages/core/src/package-value.ts\npackage source',
        });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it('resolves a unique tracked monorepo suffix without spending another model turn', async () => {
    const { tools, run } = runtime([
      runResult('missing-child', '', 1),
      runResult('resolution-child', '0\tpackages/core/src/dogfood-add.test.ts\n'),
      runResult('read-child', 'expect(add(2, 3)).toBe(5);'),
    ]);

    await expect(tools.execute('read_file', { path: 'src/dogfood-add.test.ts' }))
      .resolves.toMatchObject({
        ok: true,
        message: expect.stringContaining('Sutura resolved source: packages/core/src/dogfood-add.test.ts'),
      });
    expect(run).toHaveBeenCalledTimes(3);
    const resolutionCommand = (run.mock.calls[1] as unknown as [string, string])[1];
    expect(resolutionCommand).toContain("':(glob)**/src/dogfood-add.test.ts'");
  });

  it('composes a monorepo suffix with TypeScript ESM resolution in precedence order', async () => {
    const { tools, run } = runtime([
      runResult('missing-child', '', 1),
      runResult('resolution-child', '1\tpackages/core/src/value.ts\n'),
      runResult('read-child', 'export const value = 1;'),
    ]);

    await expect(tools.execute('read_file', { path: 'src/value.js' }))
      .resolves.toMatchObject({
        ok: true,
        message: 'Sutura resolved source: packages/core/src/value.ts\nexport const value = 1;',
      });
    expect(run).toHaveBeenCalledTimes(3);
    expect((run.mock.calls[1] as unknown as [string, string])[1]).toContain("':(glob)**/src/value.js'");
    expect((run.mock.calls[1] as unknown as [string, string])[1]).toContain("':(glob)**/src/value.ts'");
  });

  it('renders only the final source path when suffix and ESM resolution both apply', async () => {
    const { tools } = runtime([
      runResult('missing-child', '', 1),
      runResult('resolution-child', '0\tpackages/core/src/value.js\n'),
      runResult(
        'read-child',
        'export const value = 1;',
        0,
        'SUTURA_RESOLVED_SOURCE=packages/core/src/value.ts\n',
      ),
    ]);

    const result = await tools.execute('read_file', { path: 'src/value.js' });
    expect(result).toMatchObject({
      ok: true,
      message: 'Sutura resolved source: packages/core/src/value.ts\nexport const value = 1;',
    });
    expect(result.message).not.toContain('packages/core/src/value.js');
  });

  it('fails closed when a monorepo suffix is ambiguous', async () => {
    const { tools, run } = runtime([
      runResult('missing-child', '', 1),
      runResult('resolution-child', '0\tpackages/a/src/value.ts\n0\tpackages/b/src/value.ts\n'),
    ]);

    await expect(tools.execute('read_file', { path: 'src/value.ts' }))
      .resolves.toMatchObject({ ok: false, kind: 'sandbox' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not read a suffix candidate denied by repository policy', async () => {
    const { tools, run } = runtime(
      [
        runResult('missing-child', '', 1),
        runResult('resolution-child', '0\tpackages/core/src/private.ts\n'),
      ],
      { ...createDefaultRepositoryPolicy(), deniedReadPaths: ['packages/core/src/**'] },
    );

    await expect(tools.execute('read_file', { path: 'src/private.ts' }))
      .resolves.toMatchObject({ ok: false, kind: 'sandbox' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('authorizes a suffix candidate by its full package path instead of the missing root path', async () => {
    const { tools } = runtime(
      [
        runResult('missing-child', '', 1),
        runResult('resolution-child', '1\tpackages/core/src/value.ts\n'),
        runResult('read-child', 'export const value = 1;'),
      ],
      { ...createDefaultRepositoryPolicy(), deniedReadPaths: ['src/*.ts'] },
    );

    await expect(tools.execute('read_file', { path: 'src/value.js' }))
      .resolves.toMatchObject({
        ok: true,
        message: expect.stringContaining('packages/core/src/value.ts'),
      });
  });

  it('does not offer TypeScript fallbacks denied by repository policy', async () => {
    const { tools, run } = runtime(
      [runResult('read-child', '', 1)],
      { ...createDefaultRepositoryPolicy(), deniedReadPaths: ['src/*.ts', 'src/*.tsx'] },
    );

    await expect(tools.execute('read_file', { path: 'src/a.js' }))
      .resolves.toMatchObject({ ok: false, kind: 'sandbox' });
    const command = (run.mock.calls[0] as unknown as [string, string])[1];
    expect(command).not.toContain("fallback='src/a.ts'");
    expect(command).not.toContain("fallback='src/a.tsx'");
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
    const tools = toolsFor(executorFor(run), createDefaultRepositoryPolicy(), budget);

    await tools.execute('read_file', { path: 'src/a.ts' });
    const options = (run.mock.calls[0] as unknown as [string, string, { timeoutSec: number }])[2];
    expect(options).toMatchObject({ timeoutSec: 0.25 });
  });
});
