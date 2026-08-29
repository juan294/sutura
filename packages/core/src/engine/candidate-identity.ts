import { createHash } from 'node:crypto';

import type { Candidate, CaseFile, RaceResult } from '../domain.js';

export type CandidateIdentity = NonNullable<CaseFile['selectedCandidate']>;

export function candidateIdentity(candidate: Candidate): CandidateIdentity {
  return {
    id: candidate.id,
    diffHash: createHash('sha256').update(candidate.diff).digest('hex'),
  };
}

export function findSelectedCandidate(
  race: readonly RaceResult[],
  selected: CandidateIdentity,
): RaceResult | null {
  const matches = race.filter(({ candidate, held }) =>
    held && candidate.id === selected.id &&
    candidateIdentity(candidate).diffHash === selected.diffHash,
  );
  return matches.length === 1 ? matches[0]! : null;
}
