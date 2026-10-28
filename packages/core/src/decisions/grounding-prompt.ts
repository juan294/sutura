import type { Diagnosis } from '../domain.js';
import { validateGroundingSelection } from './grounding-evidence.js';

/** Public provenance stays in the case file; only retained evidence enters repair. */
export function diagnosisForRepairPrompt(diagnosis: Diagnosis) {
  if (!diagnosis.grounding?.selection) return diagnosis;
  const { selection, ...grounding } = diagnosis.grounding;
  if (!validateGroundingSelection(selection, grounding.citations) || !selection.applied) return { ...diagnosis, grounding };
  const indices = new Map(selection.selectedIds.map((id, index) => [id, index]));
  const judgments = new Map(selection.judgments.map(j => [j.id, j]));
  return { ...diagnosis, grounding: { ...grounding,
    sourceJudgmentNotice: 'Optional source relevance/support judgments; executable verification remains required.',
    sourceJudgments: selection.selectedIds.map((id, citationIndex) => ({ citationIndex,
      relevance: judgments.get(id)!.relevance, support: judgments.get(id)!.support })),
    exactVersionComparisons: selection.versionComparisons.flatMap(comparison => {
      const citationIndex = indices.get(comparison.id);
      return citationIndex === undefined ? [] : [{ citationIndex, package: comparison.package,
        expectedVersion: comparison.expectedVersion, mentionedVersion: comparison.mentionedVersion, matches: comparison.matches }];
    }),
  } };
}
