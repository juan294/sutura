import { aggregateStageEvidence, type CaseFile } from '@sutura/core';

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
  const contreeStage = caseFile.diagnosis.signals.includes(
    'sandbox-preparation:failed',
  )
    ? 'sandbox preparation failed before reproduction'
    : 'sandbox reproduction attempted';
  lines.push(
    `ConTree runtime: ${contreeStage}; triage=${caseFile.triage.reproduced}/${caseFile.triage.of}; raced=${caseFile.race.length}; outcome=${caseFile.outcome}`,
  );
  const totals = aggregateStageEvidence(caseFile);
  lines.push(
    `Sandbox evidence: operations=${totals.operationCount}; elapsed=${totals.elapsedTimeSec.toFixed(3)}s; cpu=${totals.cpuTimeSec.toFixed(3)}s; max-rss=${totals.maxRssKb}KB; sandbox cost USD=${totals.sandboxCostUsd.toFixed(6)}`,
  );
  lines.push(
    `Policy evidence: base-ref=${caseFile.policy.baseRef}; base-sha=${caseFile.policy.baseSha}; policy-sha=${caseFile.policy.policySha}`,
  );
  return lines;
}
