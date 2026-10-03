import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { focusedTriage, sameFailure } from './index.js';

const fixture = (name: string) => readFileSync(new URL(`__fixtures__/${name}`, import.meta.url), 'utf8');

// Real pytest 9.1.1 output for a test that fails, passes or fails another
// assertion by MODE, and a module whose import is missing.
const FAIL = fixture('pytest-fail.log');
const PASS = fixture('pytest-pass.log');
const OTHER = fixture('pytest-other.log');
const COLLECT = fixture('pytest-collect.log');
const TEST_ID = 'tests/test_case.py::test_observes_state_after_boundary';

describe('pytest focus', () => {
  it.each([
    ['pytest', `pytest ${TEST_ID}`],
    ['python -m pytest -q tests/', `python -m pytest -q ${TEST_ID}`],
    ['PYTHONPATH=src pytest -n auto --cov=src --cov-report=xml --junitxml=out.xml', `PYTHONPATH=src pytest ${TEST_ID}`],
    ['pytest -x -rA --tb=short -n4 -k "not slow"', `pytest -x -rA --tb=short ${TEST_ID}`],
    ['python3 -m pytest -p no:cacheprovider -m unit', `python3 -m pytest -p no:cacheprovider -m unit ${TEST_ID}`],
  ])('focuses %s', (command, focused) => {
    expect(focusedTriage(command, FAIL)).toMatchObject({ focus: { runner: 'pytest', command: focused, file: 'tests/test_case.py', testId: TEST_ID } });
  });

  it.each([
    ['tox -e py312', 'not a direct'],
    ['uv run pytest', 'not a direct'],
    ['pytest --pdb', 'unknown option'],
    ['pip install -e . && pytest', 'shell'],
  ])('does not focus %s', (command, reason) => {
    expect(focusedTriage(command, FAIL)).toMatchObject({ reason: expect.stringContaining(reason) });
  });

  it('does not focus a collection error, alone or next to a test failure', () => {
    expect(focusedTriage('pytest', COLLECT)).toMatchObject({ reason: expect.stringContaining('test-level') });
    expect(focusedTriage('pytest', `${FAIL}\n${COLLECT}`)).toMatchObject({ reason: expect.stringContaining('load error') });
  });

  it('keeps a focused probe only for the same test failing with the same E block', () => {
    const result = focusedTriage('pytest', FAIL);
    if (!('focus' in result)) throw new Error('expected a focus');

    expect(sameFailure(result.focus, FAIL, 1)).toBe(true);
    expect(sameFailure(result.focus, PASS, 0)).toBe(false);
    expect(sameFailure(result.focus, OTHER, 1)).toBe(false);
    expect(sameFailure(result.focus, COLLECT, 2)).toBe(false);
  });
});
