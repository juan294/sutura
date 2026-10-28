import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import type { AuditFile } from '../domain.js';
import { auditOnly } from '../audit-only.js';
import { Ledger, DEFAULT_MODEL_PRICES } from '../llm/cost.js';
import { loadRepositoryPolicy } from '../policy/load.js';
import { renderAuditCaseFile } from './audit-casefile.js';
import { renderAuditMarkdown } from './audit-markdown.js';

async function fixture(): Promise<AuditFile> {
  const parsed = JSON.parse(await readFile(new URL('./fixtures/audit-approved.json', import.meta.url), 'utf8')) as Omit<AuditFile, 'cost'> & { cost: Pick<AuditFile['cost'], 'entries'> };
  return {
    ...parsed,
    cost: {
      entries: parsed.cost.entries,
      totalUsd: () => parsed.cost.entries.reduce((total, entry) => total + entry.usd, 0),
    },
  };
}

describe('reduced-assurance audit reports', () => {
  it('renders stable Markdown with a visible assurance warning', async () => {
    expect(renderAuditMarkdown(await fixture())).toMatchSnapshot();
  });

  it('renders stable HTML with a visible assurance warning', async () => {
    expect(renderAuditCaseFile(await fixture())).toMatchSnapshot();
  });

  it('renders unconfigured optional voices as skipped while preserving their passing booleans', async () => {
    const ledger = new Ledger(DEFAULT_MODEL_PRICES);
    const llm = {
      async chat(tier: 'nano' | 'ultra') {
        if (tier === 'ultra') return { text: '{"approved":true,"reasoning":"Fixes the diagnosed assertion."}' };
        return { text: JSON.stringify({
          class: 'test-assertion', confidence: 0.9, signals: ['assertion'],
          failingCmd: 'pnpm test', errorExcerpt: 'AssertionError',
        }) };
      },
    };
    const loaded = loadRepositoryPolicy(null);
    const result = await auditOnly({
      llm,
      cost: ledger,
      beforeLog: 'Run pnpm test\nAssertionError: expected 1 to be 2\nProcess completed with exit code 1.',
      afterLog: 'Run pnpm test\nTests passed\nProcess completed with exit code 0.',
      candidateDiff: [
        'diff --git a/src/add.ts b/src/add.ts',
        'index 1111111..2222222 100644',
        '--- a/src/add.ts',
        '+++ b/src/add.ts',
        '@@ -1 +1 @@',
        '-export const add = (a: number, b: number) => a - b;',
        '+export const add = (a: number, b: number) => a + b;',
      ].join('\n'),
      policy: loaded.policy,
      policyEvidence: { baseRef: 'local', baseSha: 'local', policySha: loaded.sha },
    });

    expect(result.audit.checks.find((check) => check.name === 'second-opinion')?.passed).toBe(true);
    expect(result.audit.checks.find((check) => check.name === 'typesafe-audit')?.passed).toBe(true);
    expect(renderAuditMarkdown(result)).toContain(
      '| second-opinion | SKIPPED | gpt-6-astra: skipped: Not configured: OPENAI\\_API\\_KEY absent; requested model=gpt-6-astra;',
    );
    expect(renderAuditMarkdown(result)).toContain(
      '| typesafe-audit | SKIPPED | jev-latest: skipped: Not configured: TYPESAFE\\_API\\_KEY absent; requested model=jev-latest;',
    );
  });
});
