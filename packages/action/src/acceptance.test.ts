import { describe, expect, it, vi } from 'vitest';
import { ContreeError, RuntimeDetectionError } from '@sutura/core';
import { ActionInputError } from './input.js';

import { caseTerminalDetail, expectedActionStop, reportOutcome, requiredOutcomeFailure } from './acceptance.js';

describe('required action outcome', () => {
  it('does not fail ordinary advisory runs', () => {
    expect(requiredOutcomeFailure('gave-up', false)).toBeNull();
    expect(requiredOutcomeFailure('already-attempted', false)).toBeNull();
    expect(requiredOutcomeFailure('repair-branch-skipped', false)).toBeNull();
  });

  it('accepts only fixed when the caller enables the self-hosting gate', () => {
    expect(requiredOutcomeFailure('fixed', true)).toBeNull();
    for (const outcome of ['flaky-no-patch', 'refused', 'gave-up', 'infra-stop'] as const) {
      expect(requiredOutcomeFailure(outcome, true)).toBe(
        `Sutura required fixed but produced ${outcome}`,
      );
    }
    expect(requiredOutcomeFailure('already-attempted', true)).toBe(
      'Sutura required fixed but produced already-attempted',
    );
  });

  it('reports advisory and strict already-attempted outcomes to the action runtime', () => {
    const advisory = {
      setOutput: vi.fn(),
      setFailed: vi.fn(),
    };
    reportOutcome('already-attempted', false, advisory);
    expect(advisory.setOutput).toHaveBeenCalledWith('outcome', 'already-attempted');
    expect(advisory.setFailed).not.toHaveBeenCalled();

    const strict = {
      setOutput: vi.fn(),
      setFailed: vi.fn(),
    };
    reportOutcome('already-attempted', true, strict);
    expect(strict.setOutput).toHaveBeenCalledWith('outcome', 'already-attempted');
    expect(strict.setFailed).toHaveBeenCalledWith(
      'Sutura required fixed but produced already-attempted',
    );
  });
});

it('keeps unknown internal stops red even in advisory mode', () => {
  const reporter = { setOutput: vi.fn(), setFailed: vi.fn() };
  reportOutcome('infra-stop', false, reporter, { reason: 'unexpected-exception', stage: 'preparation', nextAction: 'Inspect the retained incident.' });
  expect(reporter.setFailed).toHaveBeenCalled();
});

it.each(['unsupported-input', 'setup-blocked', 'resource-blocked', 'reproduction-mismatch', 'identity-unavailable', 'budget-exhausted'] as const)(
  'preserves advisory non-repair and strict failure for %s', reason => {
    for (const strict of [false, true]) {
      const reporter = { setOutput: vi.fn(), setFailed: vi.fn() };
      reportOutcome('infra-stop', strict, reporter, { reason, stage: reason === 'setup-blocked' ? 'configuration' : reason === 'reproduction-mismatch' || reason === 'identity-unavailable' ? 'reproduction' : reason === 'budget-exhausted' ? 'search' : 'preparation', nextAction: 'Resolve the exact boundary before a new eligible event.' });
      expect(reporter.setFailed).toHaveBeenCalledTimes(strict ? 1 : 0);
      expect(reporter.setOutput).toHaveBeenCalledWith('terminal-reason', reason);
      expect(reporter.setOutput).toHaveBeenCalledWith('next-action', expect.any(String));
    }
  });

it('does not accept invalid reason/stage combinations as a successful stop', () => {
  const reporter = { setOutput: vi.fn(), setFailed: vi.fn() };
  reportOutcome('infra-stop', false, reporter, { reason: 'setup-blocked', stage: 'evidence-api', nextAction: 'Retry.' });
  expect(reporter.setFailed).toHaveBeenCalledOnce();
});

it('recognizes only typed source-defined setup, unsupported and rate-limit boundaries', () => {
  expect(expectedActionStop(new ActionInputError('Missing required action input: contree-token'))).toMatchObject({ reason: 'setup-blocked' });
  expect(expectedActionStop(new RuntimeDetectionError('unknown root', 'runtime-ambiguous'))).toMatchObject({ reason: 'unsupported-input' });
  expect(expectedActionStop(new ContreeError('limited', 429))).toMatchObject({ reason: 'resource-blocked' });
  expect(expectedActionStop(new ContreeError('ConTree snapshot exceeds 10000 files'))).toMatchObject({ reason: 'unsupported-input' });
  for (const error of [new Error('ConTree snapshot exceeds 10000 files'), new ContreeError('quota maybe', 500),
    new RuntimeDetectionError('escape', 'runtime-evidence-escape'), new Error('Missing required action input: contree-token')]) {
    expect(expectedActionStop(error)).toBeUndefined();
  }
});

it.each(['flaky-no-patch', 'already-attempted', 'repair-branch-skipped'] as const)('gives %s a usable next action without changing strict acceptance', outcome => {
  const reporter = { setOutput: vi.fn(), setFailed: vi.fn() };
  reportOutcome(outcome, false, reporter);
  expect(reporter.setOutput).toHaveBeenCalledWith('next-action', expect.any(String));
  expect(reporter.setFailed).not.toHaveBeenCalled();
});

it('reports native admission separately while preserving require-fixed', () => {
  const file = { outcome: 'gave-up', reproduction: { parser: 'native-command-admission' }, diagnosis: { signals: ['native-command-admission:ci-control'] } } as unknown as import('@sutura/core').CaseFile;
  const detail = caseTerminalDetail(file);
  expect(detail).toMatchObject({ reason: 'native-command-admission', stage: 'admission' });
  const reporter = { setOutput: vi.fn(), setFailed: vi.fn() };
  reportOutcome('gave-up', true, reporter, detail);
  expect(reporter.setFailed).toHaveBeenCalledWith('Sutura required fixed but produced gave-up');
});

it('keeps newly typed source/resource failures red rather than expanding advisory stops', async () => {
  const { RepositoryError } = await import('./repository.js');
  for (const error of [new RepositoryError('exact unavailable', { code: 'exact-source-unavailable', stage: 'source-checkout', details: { sourceSha: 'a'.repeat(40), attemptedRefCount: 1 } }), new ContreeError('disk unavailable', undefined, undefined, { code: 'provider-disk-exhausted', stage: 'provider-operation' })]) {
    expect(expectedActionStop(error)).toBeUndefined();
    const reporter = { setOutput: vi.fn(), setFailed: vi.fn() };
    reportOutcome('infra-stop', false, reporter);
    expect(reporter.setFailed).toHaveBeenCalled();
  }
});
