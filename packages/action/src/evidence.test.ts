import { describe, expect, it } from 'vitest';

import type { CaseFile } from '@sutura/core';

import { runtimeEvidence } from './evidence.js';

function caseFile(overrides: Partial<CaseFile> = {}): CaseFile {
  const entries = [{ model: 'nano', inTok: 10, outTok: 5, reasoningTok: 0, usd: 0.001 }];
  return {
    runId: '1',
    repo: 'owner/repo',
    diagnosis: {
      class: 'build',
      confidence: 1,
      signals: [],
      failingCmd: 'pnpm build',
      errorExcerpt: 'red',
      grounding: { query: '', citations: [], skipped: true, reason: 'not-applicable' },
    },
    triage: { status: 'real', reproduced: 5, of: 5 },
    race: [],
    outcome: 'gave-up',
    cost: { entries, totalUsd: () => 0.001 },
    policy: { baseRef: 'develop', baseSha: 'a'.repeat(40), policySha: 'default' },
    stages: [],
    ...overrides,
  };
}

describe('runtimeEvidence', () => {
  it('reports actual Nemotron calls, cost, and ConTree results', () => {
    expect(runtimeEvidence(caseFile(), { nano: 'nemotron-nano' })).toEqual([
      'Nemotron runtime: nano=nemotron-nano calls=1; inference cost USD=0.001000',
      'ConTree runtime: sandbox reproduction attempted; triage=5/5; raced=0; outcome=gave-up',
      'Sandbox evidence: operations=0; elapsed=0.000s; cpu=0.000s; max-rss=0KB; sandbox cost USD=0.000000',
      `Policy evidence: base-ref=develop; base-sha=${'a'.repeat(40)}; policy-sha=default`,
    ]);
  });

  it('does not claim Tavily runtime evidence when grounding was only configured or skipped', () => {
    expect(runtimeEvidence(caseFile(), { nano: 'nemotron-nano' }).join('\n')).not.toContain('Tavily');
  });

  it('reports only actual Tavily query and citation counts without snippets', () => {
    const value = caseFile();
    value.diagnosis.grounding = {
      query: 'sensitive source text',
      citations: [{ title: 'Title', url: 'https://example.test', snippet: 'private snippet' }],
      skipped: false,
    };
    const evidence = runtimeEvidence(value, { nano: 'nemotron-nano' }).join('\n');

    expect(evidence).toContain('Tavily runtime: queries=1; citations=1');
    expect(evidence).not.toContain('sensitive source text');
    expect(evidence).not.toContain('private snippet');
  });

  it('does not claim reproduction when dependency preparation failed', () => {
    const value = caseFile({
      outcome: 'infra-stop',
      diagnosis: {
        class: 'infra',
        confidence: 1,
        signals: ['sandbox-preparation:failed'],
        failingCmd: 'pnpm test',
        errorExcerpt: 'pnpm install failed',
      },
      triage: { status: 'not-run', reproduced: 0, of: 0 },
      cost: { entries: [], totalUsd: () => 0 },
    });

    expect(runtimeEvidence(value, { nano: 'nemotron-nano' })).toEqual([
      'ConTree runtime: sandbox preparation failed before reproduction; triage=0/0; raced=0; outcome=infra-stop',
      'Sandbox evidence: operations=0; elapsed=0.000s; cpu=0.000s; max-rss=0KB; sandbox cost USD=0.000000',
      `Policy evidence: base-ref=develop; base-sha=${'a'.repeat(40)}; policy-sha=default`,
    ]);
  });
});
