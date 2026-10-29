import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { captureNodeDiagnostics, compareNodeDiagnostics, isCapturedDiagnostics } from './native-diagnostics.js';
const log = readFileSync(new URL('../github/__fixtures__/native-node-two-failures.log', import.meta.url), 'utf8');
const binding = { repository: 'example/project', sourceSha: 'a'.repeat(40), runId: '42', attempt: 1, jobId: 7, stepNumber: 3 };
it('captures both complete native failures before a display excerpt is shortened', () => {
  const evidence = captureNodeDiagnostics(log, binding, 'normal');
  expect(evidence).toMatchObject({ complete: true, summary: { tests: 194, failed: 2 }, identities: [expect.objectContaining({ file: 'test/terminal/storage.test.mjs' }), expect.objectContaining({ file: 'test/terminal/clock.test.mjs' })] });
  expect(isCapturedDiagnostics(evidence)).toBe(true);
  expect(isCapturedDiagnostics(JSON.parse(JSON.stringify(evidence)))).toBe(false);
  expect(compareNodeDiagnostics(evidence, log, { exitCode: 1 })).toMatchObject({ status: 'matched' });
});
it.each([
  ['missing failure block', log.slice(0, log.lastIndexOf('test at ')), 'normal'],
  ['clipped assertion block', log.slice(0, log.lastIndexOf('      at TestContext')), 'normal'],
  ['summary mismatch', log.replace('ℹ fail 2', 'ℹ fail 3'), 'normal'],
  ['abnormal native completion', log, 'abnormal'],
  ['unknown completion', log, 'unknown'],
  ['missing summary', log.replace('ℹ tests 194', ''), 'normal'],
  ['overflow', 'x'.repeat(1_048_577), 'normal'],
] as const)('discloses incomplete %s', (_name, value, completion) => {
  expect(captureNodeDiagnostics(value, binding, completion).complete).toBe(false);
});
it('does not match missing, extra, changed or killed sandbox failures', () => {
  const evidence = captureNodeDiagnostics(log, binding, 'normal');
  expect(compareNodeDiagnostics(evidence, log.replace('expected a real Cached footer', 'expected a different footer'), { exitCode: 1 }).status).toBe('mismatch');
  const extra = log.replace('ℹ tests 194', 'ℹ tests 195').replace('ℹ fail 2', 'ℹ fail 3') + '\ntest at test/terminal/extra.test.mjs:1:1\n✖ extra failure (1ms)\n  AssertionError: expected true to be false\n      at TestContext.<anonymous> (file:///workspace/test/terminal/extra.test.mjs:1:1)\n';
  expect(compareNodeDiagnostics(evidence, extra, { exitCode: 1 }).status).toBe('mismatch');
  expect(compareNodeDiagnostics(evidence, log.slice(0, log.lastIndexOf('test at ')), { exitCode: 1 }).status).toBe('unavailable');
  expect(compareNodeDiagnostics(evidence, log, { exitCode: -1, processState: { timedOut: true, signal: 9 } }).status).toBe('unavailable');
  expect(compareNodeDiagnostics(JSON.parse(JSON.stringify(evidence)), log, { exitCode: 1 }).status).toBe('unavailable');
});
it('keeps assertion identity distinct even when the displayed diagnostic is redacted', () => {
  const a = captureNodeDiagnostics(log.replace('expected a real Cached footer', 'TOKEN=first-sensitive-value'), binding, 'normal');
  const b = log.replace('expected a real Cached footer', 'TOKEN=second-sensitive-value');
  expect(compareNodeDiagnostics(a, b, { exitCode: 1 }).status).toBe('mismatch');
});
