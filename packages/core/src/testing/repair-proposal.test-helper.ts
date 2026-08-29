import type { Candidate } from '../domain.js';
import { parseUnifiedDiff } from '../diff/unified.js';

export function repairProposalReply(
  candidate: Candidate,
  replacement: string,
): { text: string; usd: number } {
  const parsed = parseUnifiedDiff(candidate.diff);
  if (!parsed.valid) throw new Error('Repair proposal fixture requires a valid diff');
  return {
    text: JSON.stringify({
      replacement,
    }),
    usd: 0.001,
  };
}
