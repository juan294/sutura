import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { focusedTriage, sameFailure } from './index.js';

const fixture = (name: string) => readFileSync(new URL(`__fixtures__/${name}`, import.meta.url), 'utf8');

// Real jest 30.5.2 output (CI=true) for one test that fails, passes, or fails
// with another assertion depending on MODE, and a suite with a missing import.
const FAIL = fixture('jest-fail.log');
const PASS = fixture('jest-pass.log');
const OTHER = fixture('jest-other.log');
const COLLECT = fixture('jest-collect.log');
const TEST_ID = 'src/case.test.js › timer boundary › observes the state after a fixed timer boundary';

describe('jest focus', () => {
  it.each([
    ['jest', 'jest --runTestsByPath src/case.test.js'],
    ['npx jest --ci', 'npx jest --ci --runTestsByPath src/case.test.js'],
    ['CI=true pnpm exec jest --ci --coverage --shard=1/3 src/', 'CI=true pnpm exec jest --ci --runTestsByPath src/case.test.js'],
    ['yarn jest -c jest.config.js --reporters default --reporters jest-junit', 'yarn jest -c jest.config.js --runTestsByPath src/case.test.js'],
    ['jest -t "a name" --runInBand', 'jest --runInBand --runTestsByPath src/case.test.js'],
  ])('focuses %s', (command, focused) => {
    expect(focusedTriage(command, FAIL)).toMatchObject({ focus: { runner: 'jest', command: focused, file: 'src/case.test.js', testId: TEST_ID } });
  });

  it.each([
    ['npm test', 'not a direct'],
    ['pnpm -r exec jest', 'not a direct'],
    ['tsc && jest', 'shell'],
    ['jest --watch', 'unknown option'],
    ['jest --listTests', 'unknown option'],
  ])('does not focus %s', (command, reason) => {
    expect(focusedTriage(command, FAIL)).toMatchObject({ reason: expect.stringContaining(reason) });
  });

  it('does not focus a suite that failed to load, alone or next to a test failure', () => {
    expect(focusedTriage('jest', COLLECT)).toMatchObject({ reason: expect.stringContaining('test-level') });
    expect(focusedTriage('jest', `${FAIL}\n${COLLECT}`)).toMatchObject({ reason: expect.stringContaining('load error') });
  });

  it('does not focus two failing files', () => {
    const two = `${FAIL}\n${FAIL.replaceAll('src/case.test.js', 'src/other.test.js')}`;
    expect(focusedTriage('jest', two)).toMatchObject({ reason: expect.stringContaining('one failing test file') });
  });

  // Real jest 30.5.2 output of a two-file run: jest buffers console output into
  // a `● Console` block under the file header, before the failing test.
  it('does not take buffered console output for a failing test', () => {
    const result = focusedTriage('jest', fixture('jest-console.log'));
    if (!('focus' in result)) throw new Error('expected a focus');

    expect(result.focus.testId).toBe('src/console.test.js › timer boundary › observes the state after a fixed timer boundary');
    expect(sameFailure(result.focus, fixture('jest-console.log'), 1)).toBe(true);
    expect(sameFailure(result.focus, fixture('jest-console-second.log'), 1)).toBe(false);
  });

  it('keeps a focused probe only for the same test failing with the same message block', () => {
    const result = focusedTriage('jest', FAIL);
    if (!('focus' in result)) throw new Error('expected a focus');

    expect(sameFailure(result.focus, FAIL, 1)).toBe(true);
    expect(sameFailure(result.focus, PASS, 0)).toBe(false);
    expect(sameFailure(result.focus, OTHER, 1)).toBe(false);
    expect(sameFailure(result.focus, COLLECT, 1)).toBe(false);
  });
});
