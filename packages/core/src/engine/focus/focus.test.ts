import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { focusedTriage, sameFailure } from './index.js';

const fixture = (name: string) => readFileSync(new URL(`__fixtures__/${name}`, import.meta.url), 'utf8');

// Real vitest 4.1.11 output from the Placebo flaky-timer-race fixture at
// SUTURA_TRIAGE_ATTEMPT=0 (fails) and 1 (passes); paths rewritten to the
// sandbox and runner workspaces.
const DEFAULT_FAIL = fixture('vitest-default-fail.log');
const GITHUB_FAIL = fixture('vitest-github-actions-fail.log');
const FOCUSED_PASS = fixture('vitest-focused-pass.log');
const NO_FILES = fixture('vitest-no-files.log');

describe('vitest focus', () => {
  it.each([
    ['vitest run', 'vitest run case.test.js'],
    ['vitest', 'vitest run case.test.js'],
    ['npx vitest run', 'npx vitest run case.test.js'],
    ['pnpm exec vitest run --config vitest.config.ts', 'pnpm exec vitest run --config vitest.config.ts case.test.js'],
    [
      'VITEST_SHARD_RUN=true pnpm exec vitest run --shard=2/2 --coverage --reporter=blob --reporter=github-actions --outputFile=.vitest-reports/blob.json',
      'VITEST_SHARD_RUN=true pnpm exec vitest run case.test.js',
    ],
    ['vitest run --shard 1/2 src/', 'vitest run case.test.js'],
    ['vitest run -t "a name"', 'vitest run case.test.js'],
  ])('focuses %s', (command, focused) => {
    const result = focusedTriage(command, DEFAULT_FAIL);

    expect(result).toMatchObject({ focus: { runner: 'vitest', command: focused, file: 'case.test.js',
      testId: 'case.test.js > observes the state after a fixed timer boundary' } });
  });

  it('reads the failing test from GitHub annotations relative to the runner workspace', () => {
    expect(focusedTriage('vitest run --reporter=github-actions', GITHUB_FAIL)).toMatchObject({
      focus: { command: 'vitest run case.test.js', testId: 'case.test.js > observes the state after a fixed timer boundary' },
    });
  });

  it.each([
    ['pnpm test', 'not a direct'],
    ['npm run test', 'not a direct'],
    ['tsc --noEmit && vitest run', 'shell'],
    ['vitest run | tee out.log', 'shell'],
    ['vitest run; echo done', 'shell'],
    ['vitest run $(git diff --name-only)', 'shell'],
    ['vitest watch', 'subcommand'],
    ['vitest run --unknown-flag value', 'unknown option'],
    ['pnpm -r test', 'not a direct'],
    ["vitest run 'a'b", 'shell'],
    ['vitest run # --shard 1/2', 'shell'],
  ])('does not focus %s', (command, reason) => {
    expect(focusedTriage(command, DEFAULT_FAIL)).toMatchObject({ reason: expect.stringContaining(reason) });
  });

  it('does not focus when the log names no failing test or more than one file', () => {
    expect(focusedTriage('vitest run', ' FAIL  src/a.test.ts [ src/a.test.ts ]\nError: Failed to load url ./missing.js'))
      .toMatchObject({ reason: expect.stringContaining('test-level') });
    const two = `${DEFAULT_FAIL}\n FAIL  other.test.js > another test\nAssertionError: expected 1 to be 2`;
    expect(focusedTriage('vitest run', two)).toMatchObject({ reason: expect.stringContaining('one failing test file') });
  });

  // Real vitest 4.1.11 output: tests that fail identically share one error
  // under consecutive FAIL headers.
  it('fingerprints the shared error, not the next header, of grouped failures', () => {
    const grouped = fixture('vitest-grouped-fail.log');
    const result = focusedTriage('vitest run', grouped);
    if (!('focus' in result)) throw new Error('expected a focus');

    expect(result.focus.testId).toBe('grouped.test.js > case 1');
    expect(sameFailure(result.focus, grouped, 1)).toBe(true);
    expect(sameFailure(result.focus, grouped.replace("expected 'test' to be 'pass'", "expected 'other' to be 'pass'"), 1)).toBe(false);
  });

  // Real vitest 4.1.11 github-actions reporter output: a file that failed to
  // load is annotated with the file alone as its title.
  it('does not focus when an annotation reports a file that failed to load', () => {
    expect(focusedTriage('vitest run --reporter=github-actions', fixture('vitest-github-actions-load.log')))
      .toMatchObject({ reason: expect.stringContaining('load error') });
  });

  it('does not take a log path that starts with a dash for a test file', () => {
    expect(focusedTriage('vitest run', ' FAIL  -u > a test\nAssertionError: expected 1 to be 2'))
      .toMatchObject({ reason: expect.stringContaining('test-level') });
  });

  it('keeps an environment assignment an assignment when its value needs quoting', () => {
    expect(focusedTriage('DEBUG=* vitest run', DEFAULT_FAIL)).toMatchObject({ focus: { command: "DEBUG='*' vitest run case.test.js" } });
  });

  it('does not focus a path outside the repository', () => {
    const outside = DEFAULT_FAIL.replaceAll('case.test.js', '../outside.test.js');
    expect(focusedTriage('vitest run', outside)).toMatchObject({ reason: expect.stringContaining('path') });
  });

  it('keeps a focused probe only for the same test failing with the same message', () => {
    const result = focusedTriage('vitest run', DEFAULT_FAIL);
    if (!('focus' in result)) throw new Error('expected a focus');
    const { focus } = result;

    expect(sameFailure(focus, DEFAULT_FAIL, 1)).toBe(true);
    expect(sameFailure(focus, FOCUSED_PASS, 0)).toBe(false);
    expect(sameFailure(focus, NO_FILES, 1)).toBe(false);
    expect(sameFailure(focus, DEFAULT_FAIL.replaceAll('expected false to be true', 'expected 3 to be 4'), 1)).toBe(false);
    expect(sameFailure(focus, DEFAULT_FAIL.replaceAll('observes the state after', 'observes another'), 1)).toBe(false);
  });
});
