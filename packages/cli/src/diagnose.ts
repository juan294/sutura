import { createHash } from 'node:crypto';
import { classifyMechanically, selectFailedStepLog } from '@sutura/core';
import type { DiagnoseArguments } from './args.js';
import { runCommand, type CommandRunner } from './command.js';
interface SourceRun { id: number; run_attempt: number; head_sha: string; repository: { full_name: string }; conclusion: string }
interface Job { id: number; run_id: number; run_attempt: number; head_sha: string; name: string; conclusion: string;
  steps: Array<{ number: number; name: string; conclusion: string; started_at: string | null; completed_at: string | null }> }
export async function diagnoseRun(request: DiagnoseArguments, run: CommandRunner = runCommand) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(request.repository) || !Number.isSafeInteger(request.runId) || request.runId <= 0) throw new Error('Invalid diagnosis scope');
  const api = async (path: string) => run('gh', ['api', `repos/${request.repository}/${path}`], { timeoutMs: 10_000, maxOutputBytes: 2 * 1024 * 1024 });
  const sourceRun = JSON.parse(await api(`actions/runs/${request.runId}`)) as SourceRun;
  if (sourceRun.id !== request.runId || sourceRun.repository?.full_name.toLowerCase() !== request.repository.toLowerCase() ||
      !Number.isSafeInteger(sourceRun.run_attempt) || sourceRun.run_attempt <= 0 || !/^[a-f0-9]{40}$/u.test(sourceRun.head_sha)) throw new Error('Selected run identity mismatch');
  const source = { repository: request.repository, runId: request.runId, attempt: sourceRun.run_attempt, sourceSha: sourceRun.head_sha };
  const base = { schemaVersion: 'sutura-run-diagnosis-v1', source, reproduction: 'unmeasured', providerCalls: 0,
    nextAction: 'Compare repository assessment and the selected native failure. Live repair requires separate configured access and authorization.' };
  if (!['failure', 'timed_out'].includes(sourceRun.conclusion)) return { ...base, evidenceStage: 'observed', reason: 'no-failed-run', selectedStep: null };
  const page = JSON.parse(await api(`actions/runs/${request.runId}/attempts/${source.attempt}/jobs?per_page=100`)) as { total_count: number; jobs: Job[] };
  if (!Array.isArray(page.jobs) || page.total_count !== page.jobs.length || page.jobs.length > 100) throw new Error('Incomplete bounded job inventory; select a smaller evidence scope');
  if (page.jobs.some(job => job.run_id !== source.runId || job.run_attempt !== source.attempt || job.head_sha !== source.sourceSha || !Number.isSafeInteger(job.id) || job.id <= 0 || !Array.isArray(job.steps))) throw new Error('Selected job identity mismatch');
  const failed = page.jobs.filter(job => ['failure', 'timed_out'].includes(job.conclusion))
    .flatMap(job => job.steps.filter(step => ['failure', 'timed_out'].includes(step.conclusion)).map(step => ({ job, step })));
  if (failed.length !== 1) return { ...base, evidenceStage: 'observed', reason: 'selected-step-ambiguous', selectedStep: null };
  const { job, step } = failed[0]!;
  const selected = selectFailedStepLog(await api(`actions/jobs/${job.id}/logs`), { name: step.name, startedAt: step.started_at, completedAt: step.completed_at });
  const diagnosis = classifyMechanically(selected.log);
  return { ...base, evidenceStage: 'diagnosed', reason: selected.truncated ? 'selected-log-incomplete' : 'selected-step-observed',
    selectedStep: { jobId: job.id, stepNumber: step.number }, logDigest: createHash('sha256').update(selected.log).digest('hex'),
    diagnosis: { class: diagnosis.class, confidence: diagnosis.confidence, commandObserved: diagnosis.failingCmd !== 'unknown' },
    logHandling: 'Untrusted selected-step data; raw logs and command text are not returned or executed.' };
}
