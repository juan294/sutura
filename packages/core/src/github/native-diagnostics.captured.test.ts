import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { selectFailedStepLog } from './adapter.js';
const binding = { repository: 'example/project', sourceSha: 'a'.repeat(40), runId: '42', attempt: 1, jobId: 7, stepNumber: 3 };
it('derives the complete two-failure envelope from the authenticated full step before its display cap', () => {
  const capture = readFileSync(new URL('./__fixtures__/native-node-two-failures.log', import.meta.url), 'utf8');
  const raw = ['##[group]Run node scripts/test-select.mjs run terminal:rest', 'node scripts/test-select.mjs run terminal:rest', 'shell: /usr/bin/bash -e {0}', '##[endgroup]', ...Array.from({ length: 300 }, (_, i) => `passed unrelated test ${i}`), capture, '##[error]Process completed with exit code 1.']
    .join('\n').split('\n').map(line => `2026-10-27T00:00:00.100Z ${line}`).join('\n');
  const selected = selectFailedStepLog(raw, { name: 'Run node scripts/test-select.mjs run terminal:rest', startedAt: '2026-10-27T00:00:00Z', completedAt: '2026-10-27T00:00:01Z' }, { binding, completion: 'normal' });
  expect(selected.truncated).toBe(true);
  expect(selected.log.split('\n').length).toBeLessThanOrEqual(200);
  expect(selected.diagnostics).toMatchObject({ complete: true, summary: { failed: 2 }, identities: [{ file: 'test/terminal/storage.test.mjs' }, { file: 'test/terminal/clock.test.mjs' }] });
});
it('does not bless Node summaries from a killed native process', () => {
  const capture = readFileSync(new URL('./__fixtures__/native-node-two-failures.log', import.meta.url), 'utf8');
  const raw = `${capture}\n##[error]Process completed with exit code 137.`.split('\n').map(line => `2026-10-27T00:00:00.100Z ${line}`).join('\n');
  const selected = selectFailedStepLog(raw, { name: 'Tests', startedAt: '2026-10-27T00:00:00Z', completedAt: '2026-10-27T00:00:01Z' }, { binding, completion: 'normal' });
  expect(selected.diagnostics?.complete).toBe(false);
});
