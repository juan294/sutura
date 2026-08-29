import type { Candidate } from '../domain.js';
import { parseUnifiedDiff } from '../diff/unified.js';

export function repairProposalReply(candidate: Candidate): { text: string; usd: number } {
  const parsed = parseUnifiedDiff(candidate.diff);
  const file = parsed.files[0];
  const hunk = file?.hunks[0];
  const hunkStart = Number(hunk?.header.match(/^@@ -(\d+)/u)?.[1]);
  const firstRemoval = hunk?.lines.findIndex((line) => line.startsWith('-')) ?? -1;
  if (
    !parsed.valid || parsed.files.length !== 1 || !file?.newPath ||
    file.hunks.length !== 1 || !hunk || !Number.isSafeInteger(hunkStart) ||
    firstRemoval < 1 || hunk.removals.length === 0
  ) throw new Error('Repair proposal fixture requires one valid modified hunk');
  const contextBefore = hunk.lines.slice(1, firstRemoval).filter((line) => line.startsWith(' ')).length;
  const startLine = hunkStart + contextBefore;
  return {
    text: JSON.stringify({
      id: candidate.id,
      rationale: candidate.rationale,
      edits: [{
        path: file.newPath,
        startLine,
        endLine: startLine + hunk.removals.length - 1,
        new: hunk.additions.join('\n'),
      }],
    }),
    usd: 0.001,
  };
}
