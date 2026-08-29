import { describe, expect, it, vi } from 'vitest';

import { reportOutcome, requiredOutcomeFailure } from './acceptance.js';

describe('required action outcome', () => {
  it('does not fail ordinary advisory runs', () => {
    expect(requiredOutcomeFailure('gave-up', false)).toBeNull();
    expect(requiredOutcomeFailure('already-attempted', false)).toBeNull();
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
