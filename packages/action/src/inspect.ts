import { createHash } from 'node:crypto';
import { admitNativeCommand, assessJobSupport, classifyIncident, classifyMechanically, compareFailureIdentity, extractAssessmentJobs, nativeFailureForCommand,
  parseAssessmentWorkflow, RUNTIME_SUPPORT_CONTRACT, type FailedStepLog, type IncidentClassificationRecord, type JobAssessmentRecord } from '@sutura/core';
export interface InspectionCapture {
  observedAt: string; repository: string; repositoryId: number; runId: string; attempt: number; sourceSha: string; workflowId: number; workflowPath: string;
  event: string; actionSha?: string | undefined; conclusion: string | null; headBranch: string; complete: boolean;
  selected?: FailedStepLog | undefined; workflow: string; files: Readonly<Record<string, string>>; paths: readonly string[];
  snapshot: { complete: boolean; fileCount: number; totalBytes: number; largestFileBytes: number };
}
export interface ActionInspection {
  schemaVersion: 'sutura-action-inspection-v1'; repository: string; runId: string; attempt: number; sourceSha: string;
  disposition: IncidentClassificationRecord['disposition']; reason: string; owner: string; nextAction: string;
  evidenceDigest: string; repairEligible: boolean; executionAuthorized: false; assessment?: JobAssessmentRecord;
  selectedStep?: { jobId?: number; jobName: string; stepNumber?: number; stepName: string };
}
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function inspectEvidence(capture: InspectionCapture): ActionInspection {
  if (!/^[\w.-]+\/[\w.-]+$/u.test(capture.repository) || !/^[1-9]\d*$/u.test(capture.runId) ||
    !/^[a-f0-9]{40}$/iu.test(capture.sourceSha) || !Number.isSafeInteger(capture.attempt) || capture.attempt < 1 ||
    !Number.isSafeInteger(capture.repositoryId) || capture.repositoryId < 1 || !Number.isSafeInteger(capture.workflowId) || capture.workflowId < 1 ||
    !/^\.github\/workflows\/[\w.-]+\.ya?ml$/u.test(capture.workflowPath)) throw new Error('Inspection source identity is invalid');
  const selected = capture.selected;
  const selectedStep = selected ? { jobName: selected.jobName, stepName: selected.stepName,
    ...(selected.jobId === undefined ? {} : { jobId: selected.jobId }), ...(selected.stepNumber === undefined ? {} : { stepNumber: selected.stepNumber }) } : undefined;
  const base: ActionInspection = { schemaVersion: 'sutura-action-inspection-v1', repository: capture.repository, runId: capture.runId,
    attempt: capture.attempt, sourceSha: capture.sourceSha, disposition: 'escalation', reason: 'inspection-incomplete', owner: 'repository',
    nextAction: 'Capture complete selected-job metadata and diagnostics for this exact run and attempt.',
    evidenceDigest: digest(capture), repairEligible: false, executionAuthorized: false, ...(selectedStep ? { selectedStep } : {}) };
  if (!['failure', 'timed_out'].includes(capture.conclusion ?? '')) return { ...base, disposition: 'observe-only', reason: 'no-failed-source-run', nextAction: 'Keep diagnosis available; wait for a real eligible failure.' };
  if (capture.headBranch.startsWith('sutura/fix-')) return { ...base, disposition: 'observe-only', reason: 'repair-branch-recursion', nextAction: 'Inspect the existing repair attempt; do not create a recursive repair.' };
  if (!capture.complete || !selected || selected.truncated) return base;
  const admission = admitNativeCommand(classifyMechanically(selected.log).failingCmd);
  if (admission) return { ...base, reason: admission.reason, owner: 'sutura', nextAction: admission.nextAction };
  const workflow = parseAssessmentWorkflow(capture.workflow), jobs = extractAssessmentJobs(workflow, capture.files);
  const definitions = workflow.jobs as Record<string, { name?: unknown }>;
  const matches = jobs.filter(job => (definitions[job.jobKey]?.name ?? job.jobKey) === selected.jobName);
  if (matches.length !== 1) return { ...base, reason: 'selected-job-ambiguous', nextAction: 'Provide an exact statically resolved selected workflow job; matrix expressions remain unknown.' };
  const job = matches[0]!, mechanical = classifyMechanically(selected.log);
  const scope = { repositoryId: capture.repositoryId, workflowId: capture.workflowId, workflowPath: capture.workflowPath, jobKey: job.jobKey, remoteSourceSha: capture.sourceSha };
  const assessment = assessJobSupport({ scope, target: { kind: 'installed-action', ...(capture.actionSha ? { actionSha: capture.actionSha, resolvedFromActionSha: capture.actionSha, runtimeContractVersion: RUNTIME_SUPPORT_CONTRACT } : {}) },
    observation: { complete: capture.complete, truncated: false, observedAt: capture.observedAt }, job: job.job, files: capture.files, paths: capture.paths, snapshot: capture.snapshot });
  const native = nativeFailureForCommand(mechanical.failingCmd, selected.log, Object.entries(capture.files).map(([path, content]) => ({ path, content })));
  // Parsing a native log against itself validates diagnostic structure only. This is not sandbox reproduction.
  const identity = compareFailureIdentity(native, { log: selected.log, exitCode: 1 });
  const sourceDefect = assessment.coveredFailureClasses.includes(mechanical.class) && identity.status === 'matched';
  const classification = classifyIncident({ assessment, trigger: { event: capture.event, authenticated: true },
    ...(sourceDefect ? { causeEvidence: { cause: 'source-defect' as const, confidence: 'confirmed' as const, complete: true, digest: digest(selected.log), scope } } : {}) });
  return { ...base, assessment, disposition: classification.disposition, reason: classification.reason, owner: classification.ownerDomain,
    nextAction: classification.nextAction, repairEligible: classification.disposition === 'repair-supported' };
}
export function reportInspection(result: ActionInspection, reporter: { setOutput(name: string, value: string): void; info(message: string): void }): void {
  for (const [name, value] of Object.entries({ outcome: 'inspected', disposition: result.disposition, reason: result.reason, owner: result.owner,
    'evidence-digest': result.evidenceDigest, 'next-action': result.nextAction, 'repair-eligible': String(result.repairEligible), inspection: JSON.stringify(result) })) reporter.setOutput(name, value);
  reporter.info(`Sutura inspection: ${result.disposition}; ${result.reason}. ${result.nextAction} Inspection does not authorize execution.`);
}
