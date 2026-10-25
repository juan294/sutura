import { constants, closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const id = value => Number.isSafeInteger(value) && value > 0;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\0\r\n]/.test(value);
const list = (value, limit = 1000) => Array.isArray(value) && value.length <= limit;
const sha = value => typeof value === 'string' && SHA.test(value);
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  return new Date(time).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z')) ? time : undefined;
}

/** Digest integrity binds a descriptor; authenticated protected-policy sourcing remains the caller's responsibility. */
export function compatibilityContractDigest(contract) {
  const requiredJobs = contract.requiredJobs.map(({ workflowId, jobKey }) => ({ workflowId, jobKey }))
    .sort((a, b) => a.workflowId - b.workflowId || (a.jobKey < b.jobKey ? -1 : a.jobKey > b.jobKey ? 1 : 0));
  const source = contract.policySource, applicability = contract.eventApplicability;
  const payload = { version: contract.version, repositoryId: contract.repositoryId, protected: contract.protected,
    policySource: source && { repositoryId: source.repositoryId, ref: source.ref, sha: source.sha, path: source.path },
    eventApplicability: applicability && { event: applicability.event, branch: applicability.branch },
    fullRequired: contract.fullRequired, requiredJobs };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function nativeObligations(input) {
  const contract = input.verificationContract, native = input.native;
  if (contract?.version !== 1 || contract.repositoryId !== input.repositoryId || contract.protected !== true ||
      typeof contract.policyDigest !== 'string' || !DIGEST.test(contract.policyDigest) ||
      !list(contract.requiredJobs) || contract.requiredJobs.length === 0 ||
      !contract.requiredJobs.every(job => id(job?.workflowId) && text(job?.jobKey))) return 'protected-native-contract-unavailable';
  const source = contract.policySource, applicability = contract.eventApplicability;
  if (contract.fullRequired !== true || source?.repositoryId !== input.repositoryId ||
      !text(source?.ref) || !source.ref.startsWith('refs/heads/') || source.ref.includes('..') || !sha(source?.sha) ||
      !text(source?.path) || source.path.startsWith('/') || source.path.includes('\\') ||
      source.path.split('/').some(part => part === '..' || part === '') ||
      !['push', 'pull_request', 'workflow_dispatch', 'schedule'].includes(applicability?.event) ||
      applicability?.branch !== input.defaultBranch) return 'protected-native-contract-unavailable';
  if (compatibilityContractDigest(contract) !== contract.policyDigest) return 'native-contract-digest-mismatch';
  const keys = contract.requiredJobs.map(job => `${job.workflowId}:${job.jobKey}`);
  if (new Set(keys).size !== keys.length) return 'duplicate-native-obligation';
  if (native?.complete !== true || native.policyDigest !== contract.policyDigest || !list(native.runs)) return 'native-evidence-incomplete';
  if (new Set(native.runs.map(run => run?.runId)).size !== native.runs.length) return 'duplicate-native-run';
  for (const workflowId of new Set(contract.requiredJobs.map(job => job.workflowId))) {
    const runs = native.runs.filter(run => run?.workflowId === workflowId);
    if (runs.length !== 1) return 'native-run-unavailable-or-ambiguous';
    const run = runs[0];
    if (run.repositoryId !== input.repositoryId || !id(run.runId) || !id(run.attempt) ||
        run.headSha !== input.expectedInstallationSha || run.event !== applicability.event ||
        run.branch !== applicability.branch || run.complete !== true ||
        run.status !== 'completed' || run.conclusion !== 'success' || !list(run.jobs)) return 'native-run-identity-mismatch';
    for (const obligation of contract.requiredJobs.filter(job => job.workflowId === workflowId)) {
      const jobs = run.jobs.filter(job => job?.jobKey === obligation.jobKey);
      if (jobs.length !== 1) return 'required-job-unavailable-or-ambiguous';
      const job = jobs[0];
      if (job.runId !== run.runId || job.attempt !== run.attempt || job.headSha !== run.headSha) return 'native-job-identity-mismatch';
      if (job.status !== 'completed' || job.conclusion !== 'success') return 'required-job-not-successful';
    }
  }
  return undefined;
}

function eventEvidence(event, input, start, end) {
  const source = event?.source, monitor = event?.monitor;
  const sourceTime = timestamp(source?.completedAt), monitorTime = timestamp(monitor?.completedAt);
  if (source?.repositoryId !== input.repositoryId || !id(source?.runId) || !id(source?.attempt) || !sha(source?.sourceSha) ||
      !input.installation.watchedWorkflowIds.includes(source?.workflowId) || !['failure', 'timed_out'].includes(source?.conclusion) ||
      sourceTime === undefined || sourceTime < start || sourceTime > end) return { error: 'source-event-identity-unavailable' };
  if (monitor?.repositoryId !== input.repositoryId || monitor.workflowId !== input.installation.monitorWorkflowId ||
      !id(monitor.runId) || !id(monitor.attempt) || monitor.sourceRunId !== source.runId || monitor.sourceAttempt !== source.attempt ||
      monitor.sourceSha !== source.sourceSha || monitor.actionSha !== input.candidateSha || monitor.complete !== true ||
      monitorTime === undefined || monitorTime < sourceTime || monitorTime > end || !list(monitor.stages)) return { error: 'monitor-evidence-unavailable-or-mismatched' };
  if (!monitor.stages.every(stage => text(stage?.name) && ['passed', 'failed', 'not-run'].includes(stage?.status) &&
      stage.monitorRunId === monitor.runId && stage.monitorAttempt === monitor.attempt) ||
      new Set(monitor.stages.map(stage => stage.name)).size !== monitor.stages.length) return { error: 'stage-evidence-identity-mismatch' };
  const target = monitor.stages.find(stage => stage.name === input.targetStage);
  return { key: `${source.runId}:${source.attempt}`, monitorKey: `${monitor.runId}:${monitor.attempt}`, status: target?.status ?? 'not-run', proof: {
    sourceRunId: source.runId, sourceAttempt: source.attempt, sourceSha: source.sourceSha,
    monitorRunId: monitor.runId, monitorAttempt: monitor.attempt,
  } };
}

/** Qualify supplied read-only receipts; this neither authenticates them nor grants publication authority.
 * requiredJobs comes from protected policy, never the list of observed successful jobs.
 * jobKey identifies the descriptor's exact job/matrix leg; callers must retain every required leg.
 */
export function evaluateCompatibilityPilot(input) {
  const result = { schemaVersion: 'sutura-compatibility-pilot-result-v1', installation: 'unmeasured', stopRemoval: 'unmeasured',
    organicRecovery: 'unmeasured', compatibilityDistribution: 'pending', safetyWindow: 'unmeasured',
    eligibleEvents: null, stageProofs: [], reason: 'invalid-pilot-input',
    nextAction: 'Collect exact installation, protected native obligations and bounded source/monitor evidence.' };
  if (input?.schemaVersion !== 'sutura-compatibility-pilot-v1' || !id(input.repositoryId) || !sha(input.candidateSha) ||
      !sha(input.expectedInstallationSha) || !text(input.defaultBranch) || !text(input.targetStage) || !list(input.events, 10_000)) return result;
  const installation = input.installation;
  if (installation?.rolledBack === true) return { ...result, installation: 'rolled-back', reason: 'candidate-rolled-back' };
  if (installation?.complete !== true || installation.repositoryId !== input.repositoryId ||
      installation.branch !== input.defaultBranch || installation.sourceSha !== input.expectedInstallationSha ||
      installation.actionSha !== input.candidateSha || !id(installation.monitorWorkflowId) ||
      !list(installation.watchedWorkflowIds) || installation.watchedWorkflowIds.length === 0 ||
      !installation.watchedWorkflowIds.every(id) || timestamp(installation.observedAt) === undefined) {
    return { ...result, reason: 'default-branch-installation-unavailable-or-mismatched' };
  }
  const nativeError = nativeObligations(input);
  if (nativeError) return { ...result, reason: nativeError };
  result.installation = 'verified';
  const observation = input.observation, start = timestamp(observation?.startedAt), end = timestamp(observation?.endedAt);
  if (observation?.complete !== true || start === undefined || end === undefined || end < start ||
      timestamp(installation.observedAt) < end || timestamp(installation.activatedAt) === undefined ||
      timestamp(installation.activatedAt) > start) return { ...result, reason: 'observation-window-incomplete' };
  const events = input.events.map(event => eventEvidence(event, input, start, end));
  const invalid = events.find(event => event.error);
  if (invalid) return { ...result, reason: invalid.error };
  if (new Set(events.map(event => event.key)).size !== events.length) return { ...result, reason: 'duplicate-source-attempt' };
  if (new Set(events.map(event => event.monitorKey)).size !== events.length) return { ...result, reason: 'duplicate-monitor-attempt' };
  result.eligibleEvents = events.length;
  result.stageProofs = events.filter(event => event.status === 'passed').map(event => event.proof);
  result.stopRemoval = events.some(event => event.status === 'failed') ? 'not-removed'
    : result.stageProofs.length ? 'proved' : 'unexercised';
  const windowComplete = end - start >= 72 * 60 * 60 * 1000;
  result.safetyWindow = observation.safetyRegression === true ? 'regression-observed'
    : observation.safetyRegression === false && windowComplete ? 'complete' : 'pending';
  const local = input.regression;
  const localPassed = local?.candidateSha === input.candidateSha && local.capturedRegression === 'passed' && local.fullLocalChecks === 'passed';
  const ready = localPassed && result.safetyWindow === 'complete' && result.stopRemoval !== 'not-removed';
  return { ...result, compatibilityDistribution: ready ? 'evidence-ready' : 'pending',
    reason: ready ? 'compatibility-evidence-complete' : 'compatibility-evidence-pending',
    nextAction: ready ? 'Review the exact consumer publication scope; await the next ordinary event for unexercised stages.'
      : 'Resolve the named evidence gap or observe the remaining safety window; do not rerun automatically.' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let descriptor;
  try {
    if (process.argv.length !== 3) throw new Error('one-input-required');
    descriptor = openSync(process.argv[2], constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('bounded-input-required');
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 1);
    let total = 0;
    while (total < bytes.length) {
      const count = readSync(descriptor, bytes, total, bytes.length - total, total);
      if (count === 0) break;
      total += count;
    }
    if (total > 2 * 1024 * 1024) throw new Error('bounded-input-required');
    const result = evaluateCompatibilityPilot(JSON.parse(bytes.subarray(0, total).toString('utf8')));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.compatibilityDistribution === 'evidence-ready' ? 0 : 2;
  } catch {
    process.stderr.write('Unable to evaluate pilot: supply one bounded JSON evidence file with exact identities.\n');
    process.exitCode = 1;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
