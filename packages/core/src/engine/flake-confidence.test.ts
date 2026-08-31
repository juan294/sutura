import { describe, expect, it } from 'vitest';

import {
  FLAKE_CONFIDENCE_METHOD_VERSION,
  evaluateFlakeConfidence,
  wilsonInterval,
} from './flake-confidence.js';

describe('progressive flake confidence', () => {
  it('uses the declared strict SPRT boundaries', () => {
    const below = evaluateFlakeConfidence([1, 1], 5);
    const crossed = evaluateFlakeConfidence([1, 1, 1, 1], 5);
    expect(below).toMatchObject({ decision: 'continue', stopReason: 'continue' });
    expect(crossed).toMatchObject({ decision: 'real', stopReason: 'failure-boundary' });
    expect(crossed.logLikelihoodRatio).toBeGreaterThan(crossed.upperBoundary);
  });

  it.each([
    { exits: [1, 1, 1, 1], decision: 'real', reason: 'failure-boundary' },
    { exits: [0, 0, 0, 0], decision: 'flaky', reason: 'pass-boundary' },
  ] as const)('stops a pure sequence only after evidence crosses: $decision', ({ exits, decision, reason }) => {
    expect(evaluateFlakeConfidence(exits, 5)).toMatchObject({
      decision, stopReason: reason, attemptsUsed: 4,
      methodVersion: FLAKE_CONFIDENCE_METHOD_VERSION,
    });
  });

  it.each([1, 2, 3] as const)('uses a low maximum of %i for a pure sequence without an early boundary stop', (maximum) => {
    expect(evaluateFlakeConfidence(Array.from({ length: maximum }, () => 1), maximum)).toMatchObject({
      decision: 'real', stopReason: 'maximum-attempts', attemptsUsed: maximum,
    });
  });

  it.each([1, 2, 3, 4, 5] as const)('never evaluates beyond maximum %i', (maximum) => {
    expect(() => evaluateFlakeConfidence(Array.from({ length: maximum + 1 }, () => 1), maximum))
      .toThrow(/exceed maximum/u);
  });

  it('forces a mixed sequence to its maximum even after the numeric boundary later crosses', () => {
    expect(evaluateFlakeConfidence([0, 1, 1, 1], 5)).toMatchObject({ decision: 'continue' });
    expect(evaluateFlakeConfidence([0, 1, 1, 1, 1], 5)).toMatchObject({
      decision: 'intermittent', stopReason: 'maximum-attempts', attemptsUsed: 5,
    });
  });

  it('reports a bounded 95 percent Wilson interval', () => {
    expect(wilsonInterval(4, 4)).toEqual({ lower: expect.closeTo(0.5101, 4), upper: 1 });
    expect(wilsonInterval(0, 4)).toEqual({ lower: 0, upper: expect.closeTo(0.4899, 4) });
  });
});
