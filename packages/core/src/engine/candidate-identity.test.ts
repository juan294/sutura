import { describe, expect, it } from 'vitest';

import type { Candidate, RaceResult } from '../domain.js';
import { candidateIdentity, findSelectedCandidate } from './candidate-identity.js';

function result(candidate: Candidate, held = true): RaceResult {
  return { candidate, imageId: candidate.id, nodeId: candidate.id, exitCode: 0, held };
}

describe('candidate identity', () => {
  it('selects exactly one held candidate by id and diff hash', () => {
    const audited = { id: 'audited', rationale: 'repair', diff: 'diff-a' };
    const smaller = { id: 'smaller', rationale: 'other', diff: 'b' };

    expect(findSelectedCandidate(
      [result(audited), result(smaller)],
      candidateIdentity(audited),
    )?.candidate).toBe(audited);
  });

  it('fails closed for changed, unheld, missing, or duplicated identities', () => {
    const candidate = { id: 'audited', rationale: 'repair', diff: 'diff-a' };
    const selected = candidateIdentity(candidate);

    expect(findSelectedCandidate([result({ ...candidate, diff: 'changed' })], selected)).toBeNull();
    expect(findSelectedCandidate([result(candidate, false)], selected)).toBeNull();
    expect(findSelectedCandidate([], selected)).toBeNull();
    expect(findSelectedCandidate([result(candidate), result(candidate)], selected)).toBeNull();
  });
});
