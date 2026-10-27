import { createHash } from 'node:crypto';
import { processCompletedNormally, type ProcessState } from '../executor/types.js';
import { redactExternalText } from '../security/external-text.js';
import type { FailureIdentityEvidence } from './failure-identity.js';
import { nodeTestRunner } from './focus/node-test.js';
import { logLines } from './focus/shared.js';

export interface DiagnosticBinding {
  repository: string;
  sourceSha: string;
  runId: string;
  attempt: number;
  jobId: number;
  stepNumber: number;
  workflowPath?: string;
  jobName?: string;
  stepName?: string;
  runtimeVersion?: string;
}
export interface NativeDiagnosticIdentity {
  file: string;
  testId: string;
  message: string;
  identitySha256: string;
}
export interface NativeDiagnostics {
  version: 'sutura-node-diagnostics-v1';
  complete: boolean;
  reason: string;
  logSha256: string | null;
  binding: DiagnosticBinding;
  summary: { tests: number; passed: number; failed: number; cancelled: number; skipped: number; todo: number } | null;
  identities: NativeDiagnosticIdentity[];
}
const captured = new WeakSet<object>();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const stable = (value: string) => value.replace(/(?:file:\/\/)?\/home\/runner\/work\/([^/\s]+)\/\1\//gu, '')
  .replace(/(?:file:\/\/)?\/__w\/([^/\s]+)\/\1\//gu, '').replace(/(?:file:\/\/)?\/workspace\//gu, '').replace(/\s+/gu, ' ').trim();
function validBinding(value: DiagnosticBinding): boolean {
  return /^[\w.-]+\/[\w.-]+$/u.test(value.repository) && /^[a-f0-9]{40}$/iu.test(value.sourceSha) && /^[1-9]\d*$/u.test(value.runId) &&
    [value.attempt, value.jobId, value.stepNumber].every(n => Number.isSafeInteger(n) && n > 0);
}
/** Captured data, not a JSON assertion of completeness. Replays derive it again from recorded source APIs. */
export function isCapturedDiagnostics(value: unknown): value is NativeDiagnostics {
  return typeof value === 'object' && value !== null && captured.has(value);
}
export function captureNodeDiagnostics(log: string, binding: DiagnosticBinding, completion: 'normal' | 'abnormal' | 'unknown'): NativeDiagnostics {
  const bounded = Buffer.byteLength(log) <= 1_048_576;
  const lines = bounded ? logLines(log) : [];
  const values = new Map<string, number>();
  let conflicting = false;
  for (const line of lines) {
    const match = /^(?:ℹ |# )(tests|pass|fail|cancelled|skipped|todo) (\d+)$/u.exec(line.trim());
    if (!match) continue;
    const count = Number(match[2]);
    if (values.has(match[1]!) || !Number.isSafeInteger(count)) conflicting = true;
    values.set(match[1]!, count);
  }
  const summary = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].every(key => values.has(key))
    ? { tests: values.get('tests')!, passed: values.get('pass')!, failed: values.get('fail')!, cancelled: values.get('cancelled')!, skipped: values.get('skipped')!, todo: values.get('todo')! } : null;
  const headers = lines.flatMap((line, index) => /^(?:test at |\s*not ok \d+ - )/u.test(line) ? [index] : []);
  const scan = headers.length > 64 ? { failures: [], loadErrors: 0 } : nodeTestRunner.scan(lines);
  const blocksComplete = headers.every((start, index) => {
    const block = lines.slice(start, headers[index + 1] ?? lines.length);
    return lines[start]!.startsWith('test at ')
      ? block.some(line => /^\s+at /u.test(line))
      : !block.some(line => line.trim() === "failureType: 'testCodeFailure'") || block.some(line => line.trim() === '...');
  });
  const oversize = headers.length > 64 || scan.failures.length > 64 || scan.failures.some(entry => Buffer.byteLength(entry.testId + entry.message) > 2_048);
  const identities = scan.failures.slice(0, 64).map(entry => ({ file: entry.file,
    testId: redactExternalText(entry.testId).text.slice(0, 512), message: redactExternalText(entry.message).text.slice(0, 2_048),
    identitySha256: hash(JSON.stringify([entry.file, stable(entry.testId), stable(entry.message)])),
  }));
  const consistent = summary !== null && !conflicting && summary.tests === summary.passed + summary.failed + summary.cancelled + summary.skipped + summary.todo &&
    summary.failed === scan.failures.length && summary.cancelled === 0 && blocksComplete && scan.loadErrors === 0 && scan.failures.every(entry => entry.message.trim());
  const complete = bounded && validBinding(binding) && completion === 'normal' && consistent && !oversize && Buffer.byteLength(JSON.stringify(identities)) <= 131_072;
  const evidence: NativeDiagnostics = { version: 'sutura-node-diagnostics-v1', complete,
    reason: complete ? 'Complete normal Node runner summary and failure blocks agree' : !bounded || oversize ? 'Native diagnostic bounds exceeded; retain the original and collect supported complete diagnostics' : completion !== 'normal' ? 'Normal native command completion is unavailable' : 'Complete summary, source binding and every failure block are required',
    logSha256: bounded ? hash(log) : null,
    binding: { repository: binding.repository, sourceSha: binding.sourceSha, runId: binding.runId, attempt: binding.attempt, jobId: binding.jobId, stepNumber: binding.stepNumber,
      ...(binding.workflowPath === undefined ? {} : { workflowPath: binding.workflowPath }),
      ...(binding.jobName === undefined ? {} : { jobName: binding.jobName }),
      ...(binding.stepName === undefined ? {} : { stepName: binding.stepName }),
      ...(binding.runtimeVersion === undefined ? {} : { runtimeVersion: binding.runtimeVersion }) },
    summary, identities };
  Object.freeze(evidence.binding);
  if (evidence.summary) Object.freeze(evidence.summary);
  evidence.identities.forEach(Object.freeze);
  Object.freeze(evidence.identities);
  Object.freeze(evidence);
  captured.add(evidence);
  return evidence;
}
export function compareNodeDiagnostics(native: NativeDiagnostics, log: string, result: { exitCode: number; processState?: ProcessState; truncated?: boolean }): FailureIdentityEvidence {
  const base = { version: 'sutura-failure-identity-v1' as const, parser: 'node-test-complete-v1' };
  const unavailable = (reason: string): FailureIdentityEvidence => ({ ...base, status: 'unavailable', reason });
  if (!isCapturedDiagnostics(native) || !native.complete || !native.summary || native.summary.failed < 1) return unavailable('Complete captured native failure diagnostics are required');
  if (!processCompletedNormally(result) || result.truncated) return unavailable('Sandbox process termination or truncation prevents complete reproduction; review the retained deadline evidence');
  const probe = captureNodeDiagnostics(log, native.binding, 'normal');
  if (!probe.complete) return unavailable(probe.reason);
  const nativeFingerprint = hash(JSON.stringify(native.identities.map(entry => entry.identitySha256).sort()));
  const sandboxFingerprint = hash(JSON.stringify(probe.identities.map(entry => entry.identitySha256).sort()));
  const matched = result.exitCode !== 0 && nativeFingerprint === sandboxFingerprint;
  return { ...base, status: matched ? 'matched' : 'mismatch', nativeFingerprint, sandboxFingerprint,
    reason: matched ? `All ${native.identities.length} complete native failure identities agree` : `Native ${native.identities.length} and sandbox ${probe.identities.length} complete failure identities differ` };
}
