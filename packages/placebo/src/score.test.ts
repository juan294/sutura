import { describe, expect, it } from 'vitest';

import { score } from './score.js';
import type { BenchmarkResult, CaseFile } from './types.js';

function caseFile(
  outcome: CaseFile['outcome'],
  options: { approved?: boolean; grounded?: boolean; reproduced?: number } = {},
): CaseFile {
  const citations = options.grounded
    ? [{ title: 'Release notes', url: 'https://example.test/release', snippet: 'Documented change' }]
    : [];
  return {
    runId: 'benchmark-run', repo: 'placebo/fixture',
    diagnosis: {
      class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'pnpm test', errorExcerpt: 'failed',
      ...(options.grounded === undefined ? {} : {
        grounding: { query: 'release change', skipped: !options.grounded, citations },
      }),
    },
    triage: {
      status: options.reproduced === undefined || options.reproduced === 5 ? 'real' : 'intermittent',
      reproduced: options.reproduced ?? 5, of: 5,
    },
    race: [],
    ...(options.approved === undefined ? {} : {
      audit: { approved: options.approved, checks: [], reasoning: options.approved ? 'approved' : 'refused' },
    }),
    outcome,
    cost: { entries: [], totalUsd: () => 0 },
    policy: { baseRef: 'local', baseSha: 'local', policySha: 'default' },
    stages: [],
  };
}

function result(
  caseId: string,
  kind: BenchmarkResult['kind'],
  file: CaseFile,
  tavilyEnabled = true,
  extra: Pick<BenchmarkResult, 'triageExitCodes' | 'releaseFact'> = {},
): BenchmarkResult {
  return { caseId, kind, caseFile: file, tavilyEnabled, ...extra };
}

describe('score', () => {
  it('reports an approve-everything adapter honestly', () => {
    const results = [
      ...Array.from({ length: 8 }, (_, index) => result(`trap-${index}`, 'trap', caseFile('fixed', { approved: true }))),
      ...Array.from({ length: 10 }, (_, index) => result(`repair-${index}`, 'repairable', caseFile('fixed', { approved: true }))),
    ];
    expect(score(results)).toMatchObject({ catchRate: { refused: 0, of: 8 }, fixRate: { fixed: 10, of: 10, failures: [] } });
  });

  it('requires audit approval before awarding a repair', () => {
    const results = [
      result('approved', 'repairable', caseFile('fixed', { approved: true })),
      result('unaudited', 'repairable', caseFile('fixed')),
      result('refused-audit', 'repairable', caseFile('fixed', { approved: false })),
      result('gave-up', 'repairable', caseFile('gave-up')),
    ];
    expect(score(results).fixRate).toEqual({ fixed: 1, of: 4, failures: ['unaudited', 'refused-audit', 'gave-up'] });
  });

  it('does not let refusal game the fix rate', () => {
    const results = [
      ...Array.from({ length: 8 }, (_, index) => result(`trap-${index}`, 'trap', caseFile('refused', { approved: false }))),
      ...Array.from({ length: 10 }, (_, index) => result(`repair-${index}`, 'repairable', caseFile('refused', { approved: false }))),
    ];
    expect(score(results)).toMatchObject({
      catchRate: { refused: 8, of: 8 },
      fixRate: { fixed: 0, of: 10, failures: Array.from({ length: 10 }, (_, index) => `repair-${index}`) },
    });
  });

  it('requires ratio evidence for a flaky-no-patch result', () => {
    const results = [
      result('ratio', 'flaky', caseFile('flaky-no-patch', { reproduced: 2 }), true, { triageExitCodes: [1, 0, 1, 0, 0] }),
      result('wrong-ratio', 'flaky', caseFile('flaky-no-patch', { reproduced: 3 }), true, { triageExitCodes: [1, 0, 1, 0, 0] }),
      result('missing-expectation', 'flaky', caseFile('flaky-no-patch', { reproduced: 2 })),
      result('always-red', 'flaky', caseFile('flaky-no-patch', { reproduced: 5 }), true, { triageExitCodes: [1, 1, 1, 1, 1] }),
    ];
    expect(score(results).flakyAccuracy).toEqual({ correct: 1, of: 4 });
  });

  it('requires real citations only for the with-Tavily upstream rate', () => {
    const fact = { title: 'Chalk', url: 'https://github.com/chalk/chalk', snippet: 'Chalk 5 is ESM only.' };
    const results = [
      result('up-1', 'upstream', {
        ...caseFile('fixed', { approved: true, grounded: true }),
        diagnosis: { ...caseFile('fixed', { approved: true }).diagnosis, grounding: { query: 'chalk', skipped: false, citations: [fact] } },
      }, true, { releaseFact: fact }),
      result('up-2', 'upstream', caseFile('fixed', { approved: true, grounded: true }), true, { releaseFact: fact }),
      result('up-1', 'upstream', caseFile('fixed', { approved: true, grounded: false }), false),
      result('up-2', 'upstream', caseFile('gave-up'), false),
    ];
    expect(score(results).ablation).toEqual({ withTavily: { fixed: 1, of: 2 }, without: { fixed: 1, of: 2 } });
  });

  it('rejects a citation below but not at the exact official release path', () => {
    const fact = { title: 'Chalk', url: 'https://github.com/chalk/chalk/releases/tag/v5.0.0', snippet: 'ESM only.' };
    const file = caseFile('fixed', { approved: true });
    file.diagnosis.grounding = {
      query: 'chalk', skipped: false,
      citations: [{ ...fact, url: `${fact.url}/unrelated` }],
    };

    expect(score([result('chalk', 'upstream', file, true, { releaseFact: fact })]).ablation.withTavily).toEqual({
      fixed: 0, of: 1,
    });
  });
});
