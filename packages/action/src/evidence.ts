import { aggregateStageEvidence, focusedTriageCounts, triageBudgetNote, type CaseFile } from '@sutura/core';

export { checkOutput } from '@sutura/core';

export function runtimeEvidence(
  caseFile: CaseFile,
): string[] {
  const lines: string[] = [];
  const calls = new Map<string, number>();
  for (const entry of caseFile.cost.entries) {
    const key = `${entry.role}\u0000${entry.model}`;
    calls.set(key, (calls.get(key) ?? 0) + 1);
  }
  if (calls.size > 0) {
    const modelCalls = [...calls]
      .map(([key, count]) => {
        const [role, model] = key.split('\u0000');
        return `${role}=${model} calls=${count}`;
      })
      .join('; ');
    lines.push(
      `Model runtime: ${modelCalls}; inference cost USD=${caseFile.cost.totalUsd().toFixed(6)}`,
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
  const focused = focusedTriageCounts(caseFile);
  const focusedEvidence = focused === undefined ? '' : ` focused=${focused.kept}/${focused.rejected}`;
  lines.push(
    `ConTree runtime: ${contreeStage}; triage=${caseFile.triage.reproduced}/${caseFile.triage.of} max=${caseFile.triage.maximumAttempts} stop=${caseFile.triage.stopReason}${focusedEvidence} method=${caseFile.triage.methodVersion}; search-nodes=${caseFile.search?.length ?? 0}; outcome=${caseFile.outcome}`,
  );
  const budgetNote = triageBudgetNote(caseFile);
  if (budgetNote !== undefined) lines.push(`Triage budget: ${budgetNote}`);
  const totals = aggregateStageEvidence(caseFile);
  lines.push(
    `Sandbox evidence: operations=${totals.operationCount}; elapsed=${totals.elapsedTimeSec.toFixed(3)}s; cpu=${totals.cpuTimeSec.toFixed(3)}s; max-rss=${totals.maxRssKb}KB; sandbox cost USD=${totals.sandboxCostUsd.toFixed(6)}`,
  );
  lines.push(
    `Policy evidence: base-ref=${caseFile.policy.baseRef}; base-sha=${caseFile.policy.baseSha}; policy-sha=${caseFile.policy.policySha}`,
  );
  return lines;
}
