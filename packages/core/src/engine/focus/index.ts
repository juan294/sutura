import { failureFingerprint, logLines, shellWords, type FocusRunner } from './shared.js';
import { jestRunner } from './jest.js';
import { nodeTestRunner } from './node-test.js';
import { pytestRunner } from './pytest.js';
import { vitestRunner } from './vitest.js';

export interface FocusedTriage {
  runner: FocusRunner['name'];
  /** The command that reruns only the failing test file. */
  command: string;
  file: string;
  testId: string;
  /** `errorFingerprint` of the failure's message block. */
  fingerprint: string;
}

export type FocusResult = { focus: FocusedTriage } | { reason: string };

const RUNNERS: readonly FocusRunner[] = [vitestRunner, jestRunner, nodeTestRunner, pytestRunner];

/**
 * The focused form of a triage command: the same direct runner invocation
 * narrowed to the one failing test file named in the log. Anything that could
 * change the failure's meaning (shell syntax, package scripts, unknown options,
 * collection errors, several failing files) has no focused form.
 */
export function focusedTriage(command: string, failedLog: string): FocusResult {
  const words = shellWords(command.trim());
  if (words === undefined) return { reason: 'the command uses shell syntax' };
  for (const runner of RUNNERS) {
    const invocation = runner.parse(words);
    if (invocation === undefined) continue;
    if (typeof invocation === 'string') return { reason: invocation };
    const { failures, loadErrors } = runner.scan(logLines(failedLog));
    if (loadErrors > 0 && failures.length > 0) return { reason: `the log has a ${runner.name} collection or load error` };
    if (failures.length === 0) return { reason: `no test-level ${runner.name} failure with a repository path in the log` };
    const files = new Set(failures.map(({ file }) => file));
    if (files.size !== 1) return { reason: `the log names more than one failing test file (${files.size}), not one failing test file` };
    const failure = failures[0]!;
    if (failure.message.trim() === '') return { reason: 'the failing test has no failure message' };
    return {
      focus: {
        runner: runner.name,
        command: runner.focusedCommand(invocation, failure),
        file: failure.file,
        testId: failure.testId,
        fingerprint: failureFingerprint(failure.message),
      },
    };
  }
  return { reason: 'not a direct vitest, jest, node --test or pytest invocation' };
}

/** A focused probe counts only when it fails the same test with the same message. */
export function sameFailure(focus: FocusedTriage, output: string, exitCode: number): boolean {
  if (exitCode === 0) return false;
  const runner = RUNNERS.find(({ name }) => name === focus.runner);
  if (runner === undefined) return false;
  const { failures, loadErrors } = runner.scan(logLines(output));
  return loadErrors === 0 && failures.some((failure) =>
    failure.testId === focus.testId && failureFingerprint(failure.message) === focus.fingerprint);
}
