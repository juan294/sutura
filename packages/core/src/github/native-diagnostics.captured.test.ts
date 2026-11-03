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
it('keeps a normal failed step normal when only passing test titles name a signal (gh-glance job 125482795195)', () => {
  // Real gh-glance CI log, 2026-11-02: two PTY tests failed with exit code 1, and three
  // passing tests are titled "SIGTERM ...". A test title is not evidence that the runner was killed.
  const raw = readFileSync(new URL('./__fixtures__/gh-glance-pty-rest-125482795195.log', import.meta.url), 'utf8');
  const step = { name: 'Run node scripts/test-select.mjs run pty:rest', startedAt: '2026-11-02T18:56:42Z', completedAt: '2026-11-02T19:31:07Z' };
  const selected = selectFailedStepLog(raw, step, { binding, completion: 'normal' });
  expect(raw).toContain('✔ SIGTERM exits 143');
  expect(selected.diagnostics).toMatchObject({ complete: true, summary: { failed: 2 } });
});
it('still treats a runner-level signal line in that step as abnormal completion', () => {
  const raw = readFileSync(new URL('./__fixtures__/gh-glance-pty-rest-125482795195.log', import.meta.url), 'utf8')
    .replace('2026-11-02T19:31:07.4888275Z ##[error]Process completed with exit code 1.',
      '2026-11-02T19:31:07.4880000Z /home/runner/work/_temp/x.sh: line 1:  2412 Killed  node scripts/test-select.mjs run pty:rest\n2026-11-02T19:31:07.4888275Z ##[error]Process completed with exit code 1.');
  const step = { name: 'Run node scripts/test-select.mjs run pty:rest', startedAt: '2026-11-02T18:56:42Z', completedAt: '2026-11-02T19:31:07Z' };
  expect(selectFailedStepLog(raw, step, { binding, completion: 'normal' }).diagnostics?.complete).toBe(false);
});
