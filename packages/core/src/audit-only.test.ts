import { describe, expect, it, vi } from 'vitest';

import { TypeSafeClient } from './llm/typesafe.js';
import { DEFAULT_MODEL_PRICES, Ledger } from './llm/cost.js';
import type { ChatMessage } from './llm/types.js';
import { auditOnly, validateAuditEvidence } from './audit-only.js';
import { loadRepositoryPolicy } from './policy/load.js';
import { renderAuditCaseFile } from './report/audit-casefile.js';
import { renderAuditMarkdown } from './report/audit-markdown.js';

const DIFF = [
  'diff --git a/src/add.ts b/src/add.ts',
  'index 1111111..2222222 100644',
  '--- a/src/add.ts',
  '+++ b/src/add.ts',
  '@@ -1 +1 @@',
  '-export const add = (a: number, b: number) => a - b;',
  '+export const add = (a: number, b: number) => a + b;',
].join('\n');

const BEFORE = 'Run pnpm test\nAssertionError: expected 1 to be 2\nProcess completed with exit code 1.';
const AFTER = 'Run pnpm test\nTests passed\nProcess completed with exit code 0.';

describe('auditOnly', () => {
  it('uses Nano twice and Ultra once and returns reduced assurance', async () => {
    const ledger = new Ledger(DEFAULT_MODEL_PRICES);
    const calls: string[] = [];
    const llm = {
      async chat(tier: 'nano' | 'ultra') {
        calls.push(tier);
        ledger.add(tier, tier === 'nano' ? 'nano-model' : 'ultra-model', {
          inTok: 10, outTok: 5, reasoningTok: 0,
        });
        if (tier === 'ultra') return { text: '{"approved":true,"reasoning":"The patch fixes the assertion."}' };
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
      beforeLog: BEFORE,
      afterLog: AFTER,
      candidateDiff: DIFF,
      policy: loaded.policy,
      policyEvidence: { baseRef: 'local', baseSha: 'local', policySha: loaded.sha },
    });

    expect(calls).toEqual(['nano', 'nano', 'ultra']);
    expect(result.assurance).toBe('reduced');
    expect(result.outcome).toBe('audit-approved');
    expect(result.audit.approved).toBe(true);
    expect(result.cost.entries.map((entry) => entry.role)).toEqual(['nano', 'nano', 'ultra']);
    expect(JSON.stringify(result)).not.toMatch(/fixed|verified|flaky-no-patch/u);
    expect(renderAuditMarkdown(result)).toContain('Reduced assurance');
    expect(renderAuditCaseFile(result)).toContain('Reduced assurance');
    expect(renderAuditCaseFile(result)).not.toContain('<script>');
  });

  it.each([
    ['missing command', 'noise\nProcess completed with exit code 1.', AFTER],
    ['ambiguous command', `${BEFORE}\nRun pnpm lint`, AFTER],
    ['mismatched command', BEFORE, AFTER.replace('pnpm test', 'pnpm lint')],
    ['before passes', BEFORE.replace('exit code 1', 'exit code 0'), AFTER],
    ['after fails', BEFORE, AFTER.replace('exit code 0', 'exit code 1')],
  ])('refuses invalid paired evidence: %s', (_name, beforeLog, afterLog) => {
    expect(() => validateAuditEvidence(beforeLog, afterLog, [])).toThrow();
  });

  it('accepts a repository-policy allowlisted command', () => {
    expect(validateAuditEvidence(
      'Run pnpm integration\nProcess completed with exit code 2.',
      'Run pnpm integration\nProcess completed with exit code 0.',
      ['pnpm integration'],
    )).toEqual({ command: 'pnpm integration', beforeExitCode: 2, afterExitCode: 0 });
  });

  it('filters repository policy denied context before every model boundary', async () => {
    const seen: string[] = [];
    const llm = {
      async chat(tier: 'nano' | 'ultra', messages: readonly ChatMessage[]) {
        seen.push(JSON.stringify(messages));
        return { text: tier === 'ultra'
          ? '{"approved":false,"reasoning":"Denied context was unavailable."}'
          : '{"class":"test-assertion","confidence":0.9,"signals":["safe"],"failingCmd":"pnpm test","errorExcerpt":"redacted"}' };
      },
    };
    const loaded = loadRepositoryPolicy(JSON.stringify({
      version: 1,
      deniedReadPaths: ['private/**'],
    }));
    await auditOnly({
      llm,
      cost: { entries: [], totalUsd: () => 0 },
      beforeLog: `${BEFORE}\nprivate/secret.ts:1 token-value`,
      afterLog: `${AFTER}\nprivate/secret.ts:1 token-value`,
      candidateDiff: DIFF.replaceAll('src/add.ts', 'private/secret.ts').replace('a - b', 'token-value'),
      policy: loaded.policy,
      policyEvidence: { baseRef: 'local', baseSha: 'local', policySha: loaded.sha },
    });
    expect(seen).toHaveLength(3);
    expect(seen.join('\n')).not.toContain('private/secret.ts');
    expect(seen.join('\n')).not.toContain('token-value');
    expect(seen.join('\n')).toContain('[policy-denied repository context]');
  });
});


it('finishes audit-only with skipped optional assurance when the provider never responds', async () => {
  vi.useFakeTimers();
  try {
    const ledger = new Ledger(DEFAULT_MODEL_PRICES);
    let calls = 0;
    let signal: AbortSignal | undefined;
    const typesafe = new TypeSafeClient({ apiKey: 'test', ledger }, { fetch: async (_url, request) => {
      calls++; signal = request.signal; return new Promise(() => {});
    } });
    const llm = { async chat(tier: 'nano' | 'ultra') {
      return { text: tier === 'ultra' ? '{"approved":true,"reasoning":"Fixes the assertion."}' : JSON.stringify({ class: 'test-assertion', confidence: 0.9, signals: ['assertion'], failingCmd: 'pnpm test', errorExcerpt: 'AssertionError' }) };
    } };
    const loaded = loadRepositoryPolicy(null);
    const pending = auditOnly({ llm, cost: ledger, typesafeAudit: typesafe, beforeLog: BEFORE, afterLog: AFTER, candidateDiff: DIFF, policy: loaded.policy, policyEvidence: { baseRef: 'local', baseSha: 'local', policySha: loaded.sha } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    const file = await pending;
    expect(calls).toBe(1); expect(signal?.aborted).toBe(true);
    expect(file.audit.checks.find((check) => check.name === 'typesafe-audit')).toMatchObject({ passed: true, metadata: { status: 'skipped' } });
    expect(file.outcome).toBe('audit-approved');
    expect(renderAuditMarkdown(file)).toContain('deadline exhausted');
    expect(renderAuditMarkdown(file)).toContain('new authorized invocation');
    expect(renderAuditMarkdown(file)).toContain('| typesafe-audit | SKIPPED |');
  } finally { vi.useRealTimers(); }
});
