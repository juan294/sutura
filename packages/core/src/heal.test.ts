import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { AuditVerdict, Candidate, CostLedger, Diagnosis } from './domain.js';
import { InMemoryExecutor, type InMemoryRunResult } from './executor/memory.js';
import { healCase, SUTURA_SANDBOX_ENV, type HealCaseContext } from './heal.js';
import type { TierLlm } from './llm/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'placebo', 'corpus');
const HONEST_DIFF = [
  'diff --git a/page-count.js b/page-count.js',
  '--- a/page-count.js',
  '+++ b/page-count.js',
  '@@ -1 +1 @@',
  '-export function pageCount(items, size) { return Math.floor(items / size) + 1; }',
  '+export function pageCount(items, size) { return Math.ceil(items / size); }',
].join('\n');

function result(exitCode: number, stderr = exitCode === 0 ? '' : 'case.test.js: assertion failed'): InMemoryRunResult {
  return { exitCode, stdout: exitCode === 0 ? 'Tests passed' : '', stderr, truncated: false, metrics: {} };
}

function ledger(): CostLedger {
  return { entries: [], totalUsd: () => 0 };
}

function diagnosis(failureClass: Diagnosis['class']): Diagnosis {
  return {
    class: failureClass,
    confidence: 0.95,
    signals: ['scripted'],
    failingCmd: 'pnpm test',
    errorExcerpt: 'case.test.js: assertion failed',
  };
}

function scriptedLlm(
  failureClass: Diagnosis['class'],
  candidates: Candidate[] = [{ id: 'repair', rationale: 'fix the source', diff: HONEST_DIFF }],
  auditApproved = true,
): { llm: TierLlm<'nano' | 'super' | 'ultra'>; chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn(async (tier: 'nano' | 'super' | 'ultra') => {
    if (tier === 'nano') return { text: JSON.stringify(diagnosis(failureClass)) };
    if (tier === 'super') return { text: JSON.stringify({ candidates }) };
    const verdict: Pick<AuditVerdict, 'approved' | 'reasoning'> = {
      approved: auditApproved,
      reasoning: auditApproved ? 'The source repair holds.' : 'REFUSED: wrong cause.',
    };
    return { text: JSON.stringify(verdict) };
  });
  return { llm: { chat }, chat };
}

function context(
  caseId: string,
  exits: number[],
  failureClass: Diagnosis['class'],
  extra: Partial<HealCaseContext> = {},
): { ctx: HealCaseContext; executor: InMemoryExecutor; chat: ReturnType<typeof vi.fn> } {
  let scenarioIndex = 0;
  const executor = new InMemoryExecutor((command) =>
    command.includes('if [ ! -d node_modules ]')
      ? result(0)
      : result(exits[scenarioIndex++] ?? 1),
  );
  const { llm, chat } = scriptedLlm(failureClass);
  return {
    executor,
    chat,
    ctx: {
      runId: `placebo-${caseId}`,
      repo: `placebo/${caseId}`,
      caseDir: join(ROOT, caseId, 'fixture'),
      executor,
      llm,
      cost: ledger(),
      triageN: 5,
      raceK: 1,
      readSourceContext: async () => {
        const path = caseId.startsWith('upstream-') ? 'app.cjs' : 'page-count.js';
        return {
          sources: [{
            path,
            startLine: 1,
            content: await readFile(join(ROOT, caseId, 'fixture', path), 'utf8'),
            truncated: false,
          }],
        };
      },
      ...extra,
    },
  };
}

describe('healCase', () => {
  it('repairs a real Placebo fixture after one snapshot and one pre-inference reproduction', async () => {
    const { ctx, executor, chat } = context(
      'repair-off-by-one',
      [1, 1, 1, 1, 1, 1, 0, 0],
      'test-assertion',
    );

    const caseFile = await healCase(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(executor.calls.filter(({ kind }) => kind === 'snapshot')).toHaveLength(1);
    expect(executor.calls.find((call) => call.kind === 'run')).toMatchObject({
      kind: 'run',
      cmd: expect.stringContaining('corepack pnpm install --frozen-lockfile'),
    });
    expect(executor.calls.filter(({ kind }) => kind === 'run').every((call) =>
      call.kind !== 'run' || call.opts?.env === SUTURA_SANDBOX_ENV,
    )).toBe(true);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano', 'super', 'ultra']);
  });

  it('labels the real Placebo flaky fixture without generating a patch', async () => {
    const { ctx, chat } = context(
      'flaky-timer-race',
      [1, 1, 0, 1, 0, 0],
      'flaky-timing',
    );

    await expect(healCase(ctx)).resolves.toMatchObject({
      outcome: 'flaky-no-patch',
      triage: { status: 'intermittent', reproduced: 2, of: 5 },
    });
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
  });

  it('administers and refuses the real Placebo trap candidate without a repair-model call', async () => {
    const candidateDiff = await readFile(join(ROOT, 'trap-skipped-test', 'fake-fix.diff'), 'utf8');
    const { ctx, executor, chat } = context(
      'trap-skipped-test',
      [1, 1, 1, 1, 1, 1, 0],
      'test-assertion',
      { candidateDiff },
    );

    const caseFile = await healCase(ctx);

    expect(caseFile.outcome).toBe('refused');
    expect(caseFile.audit?.approved).toBe(false);
    expect(caseFile.audit?.checks).toContainEqual(expect.objectContaining({ name: 'skipped-test', passed: false }));
    expect(executor.calls.filter(({ kind }) => kind === 'run')).toHaveLength(7);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
  });

  it('grounds an upstream Placebo fixture only when Tavily is enabled', async () => {
    const search = vi.fn().mockResolvedValue([{
      title: 'node-fetch v3 upgrade guide',
      url: 'https://github.com/node-fetch/node-fetch/blob/main/docs/v3-UPGRADE-GUIDE.md',
      snippet: 'node-fetch v3 is ESM-only.',
    }]);
    const { ctx } = context(
      'upstream-parser-release',
      [1, 1, 1, 1, 1, 1, 0, 0],
      'dep-upstream-breaking',
      { tavily: { search } },
    );

    const caseFile = await healCase(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(caseFile.diagnosis.grounding).toMatchObject({ skipped: false });
    expect(search).toHaveBeenCalledOnce();
  });

  it('stops before paid inference when the clean sandbox does not reproduce', async () => {
    const { ctx, chat } = context('repair-off-by-one', [0], 'test-assertion');

    await expect(healCase(ctx)).resolves.toMatchObject({
      outcome: 'infra-stop',
      triage: { status: 'not-run', reproduced: 0, of: 0 },
    });
    expect(chat).not.toHaveBeenCalled();
  });

  it('stops before reproduction and paid inference when sandbox preparation fails', async () => {
    const { ctx, chat } = context('repair-off-by-one', [1], 'test-assertion');
    const executor = new InMemoryExecutor(() => result(1, 'pnpm install failed'));
    ctx.executor = executor;

    await expect(healCase(ctx)).resolves.toMatchObject({
      outcome: 'infra-stop',
      diagnosis: {
        class: 'infra',
        signals: ['sandbox-preparation:failed'],
        errorExcerpt: 'pnpm install failed',
      },
    });
    expect(executor.calls.filter(({ kind }) => kind === 'run')).toHaveLength(1);
    expect(chat).not.toHaveBeenCalled();
  });

  it('reproduces an observed dependency-install command without preinstalling', async () => {
    const { ctx, chat } = context('repair-off-by-one', [0], 'infra', {
      failureCommand: 'pnpm install --frozen-lockfile',
    });

    const caseFile = await healCase(ctx);

    expect(caseFile.outcome).toBe('infra-stop');
    const commands = ctx.executor instanceof InMemoryExecutor
      ? ctx.executor.calls.filter((call) => call.kind === 'run').map(({ cmd }) => cmd)
      : [];
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('pnpm install --frozen-lockfile');
    expect(commands[0]).not.toContain('node_modules');
    expect(chat).not.toHaveBeenCalled();
  });
});
