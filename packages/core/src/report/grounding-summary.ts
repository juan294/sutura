import type { Grounding } from '../domain.js';
import { validateGroundingSelection } from '../decisions/grounding-evidence.js';

/** Plain evidence text; every rendering surface escapes it for its output format. */
export function groundingSummary(grounding: Grounding | undefined): string[] {
  const selection = grounding?.selection;
  if (selection === undefined) return [];
  if (!validateGroundingSelection(selection, grounding?.citations)) {
    return ['Grounding selection unavailable: invalid metadata; regenerate the report with valid source references.'];
  }
  const judgments = new Map(selection.judgments.map(judgment => [judgment.id, judgment]));
  const lines = [
    'Grounding relevance/support labels are semantic judgments, not proof that the repair works.',
    `Selection mode=${selection.mode}; applied=${selection.applied}; reason=${selection.reason}.`,
    `Prompt selected: ${selection.selectedIds.join(', ')}.`,
    ...selection.excluded.map(excluded => `Prompt excluded: ${excluded.id}; reason=${excluded.reason}.`),
  ];
  if (selection.warning === 'no-qualified-source') {
    lines.push('Warning: no-qualified-source. All original sources retained; no source was qualified as supporting evidence.');
  }
  for (const citation of selection.originals) {
    const judgment = judgments.get(citation.id)!;
    lines.push(`Original ${citation.id}: title=${citation.title}; URL=${citation.url}; snippet=${citation.snippet}; relevance=${judgment.relevance}; support=${judgment.support}.`);
  }
  for (const comparison of selection.versionComparisons) {
    lines.push(`Exact version comparison (code): citation=${comparison.id}; package=${comparison.package}; expected=${comparison.expectedVersion}; mentioned=${comparison.mentionedVersion}; matches=${comparison.matches}.`);
  }
  return lines;
}
