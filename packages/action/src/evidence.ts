import type { CaseFile } from '@sutura/core';

export function runtimeEvidence(
  caseFile: CaseFile,
  models: Readonly<Record<string, string>>,
): string[] {
  const lines: string[] = [];
  const calls = new Map<string, number>();
  for (const entry of caseFile.cost.entries) {
    calls.set(entry.model, (calls.get(entry.model) ?? 0) + 1);
  }
  if (calls.size > 0) {
    const modelCalls = [...calls]
      .map(([tier, count]) => `${tier}=${models[tier] ?? tier} calls=${count}`)
      .join('; ');
    lines.push(
      `Nemotron runtime: ${modelCalls}; inference cost USD=${caseFile.cost.totalUsd().toFixed(6)}`,
    );
  }
  const grounding = caseFile.diagnosis.grounding;
  if (grounding && !grounding.skipped) {
    lines.push(`Tavily runtime: queries=1; citations=${grounding.citations.length}`);
  }
  lines.push(
    `ConTree runtime: sandbox reproduction attempted; triage=${caseFile.triage.reproduced}/${caseFile.triage.of}; raced=${caseFile.race.length}; outcome=${caseFile.outcome}`,
  );
  return lines;
}
