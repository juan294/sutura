import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { focusedTriage, sameFailure } from './index.js';

const fixture = (name: string) => readFileSync(new URL(`__fixtures__/${name}`, import.meta.url), 'utf8');

// Real Node 24.21.0 `node --test` output: the TAP reporter and the default spec
// reporter, for a test that fails, passes or fails another assertion by MODE,
// and a file whose import is missing.
const TAP_FAIL = fixture('node-tap-fail.log');
const TAP_PASS = fixture('node-tap-pass.log');
const TAP_OTHER = fixture('node-tap-other.log');
const TAP_COLLECT = fixture('node-tap-collect.log');
const SPEC_FAIL = fixture('node-spec-fail.log');
const SPEC_COLLECT = fixture('node-spec-collect.log');
const TEST_ID = 'test/case.test.mjs:4:1 > observes the state after a fixed timer boundary';

describe('node --test focus', () => {
  it.each([
    ['node --test', 'node --test test/case.test.mjs'],
    ['node --test --test-reporter=tap test/', 'node --test --test-reporter=tap test/case.test.mjs'],
    ['NODE_ENV=test node --import tsx --test --test-name-pattern=boundary', 'NODE_ENV=test node --import tsx --test test/case.test.mjs'],
    ['node --experimental-test-coverage --test test/*.test.mjs', 'node --test test/case.test.mjs'],
  ])('focuses %s', (command, focused) => {
    expect(focusedTriage(command, TAP_FAIL)).toMatchObject({ focus: { runner: 'node-test', command: focused, file: 'test/case.test.mjs', testId: TEST_ID } });
  });

  it('reads the default spec reporter', () => {
    expect(focusedTriage('node --test', SPEC_FAIL)).toMatchObject({ focus: { command: 'node --test test/case.test.mjs', testId: TEST_ID } });
  });

  it.each([
    ['node test/case.test.mjs', 'not a direct'],
    ['node --test --watch', 'unknown option'],
    ['node --test && node lint.js', 'shell'],
    ['node scripts/run-tests.js --test', 'positional argument scripts/run-tests.js'],
  ])('does not focus %s', (command, reason) => {
    expect(focusedTriage(command, TAP_FAIL)).toMatchObject({ reason: expect.stringContaining(reason) });
  });

  it('does not focus a file that failed to load', () => {
    expect(focusedTriage('node --test', TAP_COLLECT)).toMatchObject({ reason: expect.stringContaining('test-level') });
    expect(focusedTriage('node --test', SPEC_COLLECT)).toMatchObject({ reason: expect.stringContaining('test-level') });
    expect(focusedTriage('node --test', `${TAP_FAIL}\n${TAP_COLLECT}`)).toMatchObject({ reason: expect.stringContaining('load error') });
  });

  it('keeps a focused probe only for the same test failing with the same error', () => {
    for (const log of [TAP_FAIL, SPEC_FAIL]) {
      const result = focusedTriage('node --test', log);
      if (!('focus' in result)) throw new Error('expected a focus');
      expect(sameFailure(result.focus, log, 1)).toBe(true);
    }
    const tap = focusedTriage('node --test', TAP_FAIL);
    if (!('focus' in tap)) throw new Error('expected a focus');
    expect(sameFailure(tap.focus, TAP_PASS, 0)).toBe(false);
    expect(sameFailure(tap.focus, TAP_OTHER, 1)).toBe(false);
    expect(sameFailure(tap.focus, TAP_COLLECT, 1)).toBe(false);
  });
});
