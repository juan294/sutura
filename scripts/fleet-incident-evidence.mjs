import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, link, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'sutura-incident-evidence-v1';
const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const id = value => Number.isSafeInteger(value) && value > 0;
const sha = value => typeof value === 'string' && SHA.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 300 && !/[\0\r\n]/u.test(value);
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const stages = ['proposal', 'integration'];
const sourceFields = ['repositoryId', 'sourceRunId', 'sourceAttempt', 'sourceSha', 'workflowId', 'branch'];

export function incidentEvidenceKey(source) {
  return `${source.repositoryId}:${source.sourceRunId}:${source.sourceAttempt}`;
}
function validSource(source) {
  return source && ['repositoryId', 'sourceRunId', 'sourceAttempt', 'workflowId'].every(key => id(source[key])) &&
    sha(source.sourceSha) && text(source.branch);
}
function sameSource(left, right) { return sourceFields.every(key => left?.[key] === right?.[key]); }

/** Integrity of an enrolled descriptor is separate from authenticating its protected source. */
export function verificationContractDigest(contract) {
  const policy = contract.policySource;
  return hash({ schemaVersion: contract.schemaVersion, repositoryId: contract.repositoryId,
    protected: contract.protected, fullRequired: contract.fullRequired, baseBranch: contract.baseBranch,
    policySource: policy && { repositoryId: policy.repositoryId, ref: policy.ref, sha: policy.sha, path: policy.path },
    stages: Object.fromEntries(stages.map(stage => {
      const scope = contract.stages?.[stage];
      return [stage, scope && { event: scope.event, branchRole: scope.branchRole,
        requiredJobs: scope.requiredJobs?.map(({ workflowId, jobKey }) => ({ workflowId, jobKey }))
          .sort((a, b) => a.workflowId - b.workflowId || (a.jobKey < b.jobKey ? -1 : a.jobKey > b.jobKey ? 1 : 0)) }];
    })) });
}
function validContract(contract, source) {
  if (contract?.schemaVersion !== 'sutura-native-verification-v1' || contract.repositoryId !== source.repositoryId ||
      contract.protected !== true || contract.fullRequired !== true || contract.baseBranch !== source.branch || !DIGEST.test(contract.policyDigest ?? '')) return false;
  const policy = contract.policySource;
  if (policy?.repositoryId !== source.repositoryId || !sha(policy.sha) || !text(policy.ref) ||
      !policy.ref.startsWith('refs/heads/') || policy.ref.includes('..') || !text(policy.path) ||
      policy.path.startsWith('/') || policy.path.includes('\\') || policy.path.split('/').some(p => !p || p === '..')) return false;
  for (const stage of stages) {
    const scope = contract.stages?.[stage];
    if (!['push', 'pull_request', 'workflow_dispatch', 'schedule'].includes(scope?.event) ||
        !['repair-head', 'base'].includes(scope.branchRole) ||
        (stage === 'integration' && (scope.event !== 'push' || scope.branchRole !== 'base')) ||
        !Array.isArray(scope.requiredJobs) || scope.requiredJobs.length === 0 || scope.requiredJobs.length > 1000 ||
        !scope.requiredJobs.every(job => id(job?.workflowId) && text(job?.jobKey))) return false;
    const keys = scope.requiredJobs.map(job => `${job.workflowId}:${job.jobKey}`);
    if (new Set(keys).size !== keys.length) return false;
  }
  return verificationContractDigest(contract) === contract.policyDigest;
}

function references(proof) {
  return Object.entries(proof ?? {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, value]) => ({ kind, digest: hash(value) }));
}
export function sealIncidentEvidence(record) {
  return { ...structuredClone(record), incidentKey: incidentEvidenceKey(record.source), proofReferences: references(record.proof) };
}
function validateRecord(record) {
  if (record?.schemaVersion !== VERSION || !validSource(record.source) ||
      record.incidentKey !== incidentEvidenceKey(record.source) || !instant(record.observedAt) ||
      !record.completeness || !['collection', 'source', 'native', 'logs'].every(key => typeof record.completeness[key] === 'boolean') ||
      !text(record.classificationRevision) || !record.proof || typeof record.proof !== 'object' || Array.isArray(record.proof) ||
      !Array.isArray(record.proofReferences) || JSON.stringify(record.proofReferences) !== JSON.stringify(references(record.proof))) {
    throw new Error('Companion integrity/schema error; preserve history and rebuild into a new output generation');
  }
  return record;
}

export function validateIncidentEvidence(record) {
  validateRecord(record);
  if (Buffer.byteLength(`${JSON.stringify(record)}\n`) > 2 * 1024 * 1024) throw new Error('Companion evidence exceeds bounded record size');
  return record;
}

function matchingMonitor(source, monitor) {
  return monitor?.repositoryId === source.repositoryId && id(monitor.runId) && id(monitor.attempt) &&
    monitor.sourceRunId === source.sourceRunId && monitor.sourceAttempt === source.sourceAttempt &&
    monitor.sourceSha === source.sourceSha && sha(monitor.actionSha) && monitor.complete === true && monitor.outcome === 'fixed';
}
function matchingPr(source, pr) {
  return pr?.repositoryId === source.repositoryId && id(pr.number) && pr.sourceRunId === source.sourceRunId &&
    pr.sourceAttempt === source.sourceAttempt && pr.sourceSha === source.sourceSha &&
    pr.sourceParentSha === source.sourceSha && sha(pr.headSha) && sha(pr.baseSha) &&
    pr.baseBranch === source.branch && text(pr.headBranch) && DIGEST.test(pr.diffDigest ?? '');
}
function publicationIdentity(pr) {
  return pr ? `${pr.repositoryId}:${pr.number}:${pr.headSha}:${pr.diffDigest}` : null;
}
function boundPublication(source, record) {
  const monitor = record.proof.monitor, pr = record.proof.repairPr;
  if (!matchingMonitor(source, monitor) || !matchingPr(source, pr)) return null;
  const publication = monitor.publication;
  if (publication?.prNumber !== pr.number || publication.headSha !== pr.headSha || publication.diffDigest !== pr.diffDigest) return null;
  return { identity: publicationIdentity(pr), monitor,
    ordered: instant(monitor.completedAt) && monitor.completedAt <= record.observedAt };
}
function selectPublication(publications) {
  const byRun = new Map();
  for (const publication of publications.filter(value => value.ordered)) {
    const { runId, attempt } = publication.monitor, previous = byRun.get(runId);
    if (!previous || attempt > previous[0].monitor.attempt) byRun.set(runId, [publication]);
    else if (attempt === previous[0].monitor.attempt) previous.push(publication);
  }
  const groups = [...byRun.values()].map(values => ({ values,
    completedAt: values.map(value => value.monitor.completedAt).sort().at(-1) }));
  const completedAt = groups.map(group => group.completedAt).sort().at(-1);
  const newest = groups.filter(group => group.completedAt === completedAt).flatMap(group => group.values);
  const identities = new Set(newest.map(value => value.identity));
  if (identities.size !== 1) return { identity: null,
    reason: newest.length ? 'publication-order-ambiguous' : 'publication-order-unavailable' };
  const identity = newest[0].identity;
  const competing = publications.some(value => {
    if (value.ordered || value.identity === identity) return false;
    const known = byRun.get(value.monitor.runId);
    // A lower attempt is stale even when its completion clock is unavailable.
    return !known || value.monitor.attempt >= known[0].monitor.attempt;
  });
  return competing ? { identity: null, reason: 'publication-order-ambiguous' } : { identity, reason: null };
}
function comparableRun(run, stage, source, pr, scope, digest) {
  return run?.stage === stage && run.repositoryId === source.repositoryId &&
    run.policyDigest === digest && run.event === scope.event &&
    run.branch === (scope.branchRole === 'base' ? source.branch : pr.headBranch) &&
    run.headSha === (stage === 'proposal' ? pr.headSha : pr.integrationSha);
}

function newestRun(runs) {
  const byRun = new Map();
  for (const run of runs) {
    if (!id(run.runId) || !id(run.attempt)) return undefined;
    const candidates = byRun.get(run.runId) ?? [];
    candidates.push(run); byRun.set(run.runId, candidates);
  }
  const newestAttempts = [];
  for (const candidates of byRun.values()) {
    const attempt = Math.max(...candidates.map(run => run.attempt));
    const newest = candidates.filter(run => run.attempt === attempt);
    if (newest.length !== 1) return undefined;
    newestAttempts.push(newest[0]);
  }
  if (newestAttempts.length === 1) return newestAttempts[0];
  if (newestAttempts.length && newestAttempts.every(run => instant(run.completedAt)) &&
      new Set(newestAttempts.map(run => run.completedAt)).size === newestAttempts.length) {
    return newestAttempts.sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
  }
  return undefined;
}
function inspectWorkflow(run, obligations, stage, pr, record, contract) {
  const result = (state, reason) => ({ state, reason, runId: run.runId, attempt: run.attempt,
    completedAt: run.completedAt ?? null, observedAt: record.observedAt,
    proofDigests: record.proofReferences.map(ref => ref.digest) });
  if (!id(run.runId) || !id(run.attempt) || !sha(run.testedSha)) return result('unmeasured', 'native-run-identity-unavailable');
  if (run.policySourceSha !== contract.policySource.sha) return result('unmeasured', 'native-policy-source-unavailable');
  const expectedHead = stage === 'proposal' ? pr.headSha : pr.integrationSha;
  if (run.testedSha !== expectedHead && !(stage === 'proposal' && contract.stages[stage].event === 'pull_request' &&
      Array.isArray(run.mergeParents) && run.mergeParents.length === 2 &&
      run.mergeParents[0] === pr.baseSha && run.mergeParents[1] === pr.headSha)) return result('not-qualified', 'tested-merge-identity-mismatch');
  if (run.status === 'completed' && run.conclusion !== 'success') return result('not-qualified', 'native-run-not-successful');
  if (!Array.isArray(run.jobs) || run.jobs.length > 2000) return result('unmeasured', 'native-jobs-unavailable');
  for (const obligation of obligations) {
    const jobs = run.jobs.filter(job => job?.jobKey === obligation.jobKey);
    if (jobs.length !== 1) return result(run.jobsComplete === true ? 'not-qualified' : 'unmeasured', 'required-job-unavailable-or-ambiguous');
    const job = jobs[0];
    if (job.runId !== run.runId || job.attempt !== run.attempt || job.testedSha !== run.testedSha) return result('not-qualified', 'native-job-identity-mismatch');
    if (job.status === 'completed' && job.conclusion !== 'success') return result('not-qualified', 'required-job-not-successful');
    if (job.status !== 'completed' || job.conclusion !== 'success') return result('unmeasured', 'required-job-pending');
  }
  if (run.jobsComplete !== true || run.status !== 'completed' || run.conclusion !== 'success') return result('unmeasured', 'native-evidence-incomplete');
  if (!record.completeness.source || !record.completeness.native || !record.completeness.collection) return result('unmeasured', 'collection-incomplete');
  return result('qualified', 'exact-native-obligations-complete');
}
function inspectStage(stage, source, record, contract) {
  const pr = record.proof.repairPr, scope = contract.stages[stage];
  const result = { publication: null, workflows: new Map() };
  const publication = boundPublication(source, record);
  if (!publication?.ordered) return result;
  result.publication = publication.identity;
  if (stage === 'integration' && (pr.merged !== true || !sha(pr.integrationSha))) return result;
  if (!Array.isArray(record.proof.native) || record.proof.native.length > 2000) return result;
  for (const workflowId of new Set(scope.requiredJobs.map(job => job.workflowId))) {
    const run = newestRun(record.proof.native.filter(run => run?.workflowId === workflowId &&
      comparableRun(run, stage, source, pr, scope, contract.policyDigest)));
    if (!run) continue;
    result.workflows.set(workflowId, inspectWorkflow(run, scope.requiredJobs.filter(job => job.workflowId === workflowId), stage, pr, record, contract));
  }
  return result;
}
function replacesWorkflow(previous, current) {
  if (current.state === 'unmeasured') return false;
  if (!previous) return true;
  // Attempt order is authoritative within a run. Completion clocks never override it.
  const order = previous.runId === current.runId ? current.attempt - previous.attempt :
    instant(current.completedAt) && instant(previous.completedAt) ? current.completedAt.localeCompare(previous.completedAt) : null;
  if (order === null || order < 0) return false;
  if (order > 0) return true;
  // Contradictory terminal evidence for one proof stays conservative, including tied receipts.
  return current.state === 'not-qualified' || previous.state !== 'not-qualified';
}
function stageQualification(selected, scope) {
  const values = [...selected.workflows.values()];
  const failed = values.find(value => value.state === 'not-qualified');
  const complete = new Set(scope.requiredJobs.map(job => job.workflowId)).size === values.length;
  return { publication: selected.publication,
    state: failed ? 'not-qualified' : complete && values.length ? 'qualified' : 'unmeasured',
    reason: failed?.reason ?? (complete && values.length ? 'exact-native-obligations-complete' : 'proof-unavailable'),
    proofDigests: [...new Set(values.flatMap(value => value.proofDigests))] };
}

/** Receipts must originate in authenticated adapters. Hashes protect integrity, not source authenticity. */
export function qualifyIncident(source, observations, contract) {
  const empty = { incidentKey: validSource(source) ? incidentEvidenceKey(source) : null,
    proposal: 'unmeasured', integration: 'unmeasured', attribution: 'unmeasured',
    reasons: ['protected-native-contract-unavailable'], proofDigests: [], latestObservationAt: null,
    currentScanComplete: false, nextObservedGreen: null };
  if (!validSource(source) || !validContract(contract, source)) return empty;
  const records = observations.filter(record => record?.incidentKey === incidentEvidenceKey(source)).map(validateRecord);
  if (records.some(record => !sameSource(record.source, source))) throw new Error('Incident identity integrity conflict; preserve history and rebuild into a new output generation');
  records.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || hash(a).localeCompare(hash(b)));
  const bound = new Map(records.filter(record => record.policyDigest === contract.policyDigest)
    .map(record => [record, boundPublication(source, record)]));
  const publication = selectPublication([...bound.values()].filter(Boolean));
  const cursors = Object.fromEntries(stages.map(stage => [stage, { publication: publication.identity, workflows: new Map() }]));
  let nextObservedGreen = null;
  for (const record of records) {
    if (record.nextObservedGreen) nextObservedGreen = record.nextObservedGreen;
    if (!publication.identity || bound.get(record)?.identity !== publication.identity || !bound.get(record)?.ordered) continue;
    for (const stage of stages) {
      const current = inspectStage(stage, source, record, contract);
      if (!current.publication) continue;
      for (const [workflowId, value] of current.workflows) {
        if (replacesWorkflow(cursors[stage].workflows.get(workflowId), value)) cursors[stage].workflows.set(workflowId, value);
      }
    }
  }
  const selected = Object.fromEntries(stages.map(stage => [stage, stageQualification(cursors[stage], contract.stages[stage])]));
  // A revoked proposal cannot retain a stronger current integration claim.
  if (selected.proposal.state !== 'qualified' && selected.integration.state === 'qualified') {
    selected.integration = { ...selected.integration, state: selected.proposal.state, reason: 'proposal-proof-required' };
  }
  const latest = records.at(-1);
  return { ...empty, proposal: selected.proposal.state, integration: selected.integration.state,
    reasons: publication.reason ? [publication.reason] : [...new Set(stages.map(stage => selected[stage].reason))],
    proofDigests: [...new Set(stages.flatMap(stage => selected[stage].proofDigests ?? []))].sort(),
    latestObservationAt: latest?.observedAt ?? null,
    currentScanComplete: latest?.completeness.collection === true && latest.completeness.source === true &&
      latest.completeness.native === true && latest.policyDigest === contract.policyDigest &&
      publication.identity !== null && bound.get(latest)?.identity === publication.identity && bound.get(latest)?.ordered === true,
    nextObservedGreen };
}

export async function persistIncidentEvidence(directory, record) {
  validateIncidentEvidence(record);
  const bytes = `${JSON.stringify(record)}\n`, digest = hash(bytes);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${record.incidentKey.replaceAll(':', '-')}-${digest}.json`);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    try { await link(temporary, path); } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if ((await boundedRead(path)).toString() !== bytes) throw new Error(`Companion integrity error at ${path}; rebuild into a new output generation`);
    }
  } finally { await rm(temporary, { force: true }); }
  return { path, sha256: digest };
}
async function boundedRead(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('bounded regular file required');
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 1); let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size === bytes.length) throw new Error('bounded regular file required');
    return bytes.subarray(0, size);
  } finally { await handle.close(); }
}
export async function readIncidentEvidence(directory) {
  let names;
  try { names = await readdir(directory); } catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  if (names.length > 100_000) throw new Error('Companion journal entry limit exceeded; preserve and partition the journal');
  const records = [];
  for (const name of names.filter(name => !name.startsWith('.')).sort()) {
    try {
      if (!/^\d+-\d+-\d+-[a-f0-9]{64}\.json$/u.test(name)) throw new Error('unknown journal entry');
      const bytes = await boundedRead(join(directory, name));
      if (!name.endsWith(`-${hash(bytes)}.json`)) throw new Error('hash mismatch');
      const record = validateRecord(JSON.parse(bytes.toString('utf8')));
      if (!name.startsWith(`${record.incidentKey.replaceAll(':', '-')}-`)) throw new Error('identity mismatch');
      records.push(record);
    } catch { throw new Error(`Companion integrity error at ${join(directory, name)}; preserve bytes and rebuild into a new output generation`); }
  }
  return records;
}

export function rebuildLegacyEvidence(observations) {
  return observations.flatMap(observation => {
    const incident = observation.incident;
    if (observation.schemaVersion !== 'sutura-fleet-observation-v1' || incident?.schemaVersion !== 'sutura-fleet-incident-v2') return [];
    const source = Object.fromEntries(sourceFields.map(key => [key, incident[key]]));
    if (!validSource(source) || !instant(observation.observedAt)) return [];
    return [sealIncidentEvidence({ schemaVersion: VERSION, source, observedAt: observation.observedAt,
      trigger: { event: null, actorId: null, triggeringActorId: null, authenticated: false },
      classificationRevision: 'legacy-unmeasured', classification: null, policyDigest: null,
      completeness: { collection: false, source: false, native: false, logs: false }, proof: {},
      legacyCanonicalObjectDigest: hash(observation), nextObservedGreen: null })];
  });
}

export function summarizeQualifications(qualifications, coverage = {}) {
  const unmeasured = qualifications.filter(q => q.proposal === 'unmeasured' || q.integration === 'unmeasured').length;
  const measuredProposal = qualifications.some(q => q.proposal !== 'unmeasured');
  const measuredIntegration = qualifications.some(q => q.integration !== 'unmeasured');
  return { schemaVersion: 'sutura-qualification-summary-v1', incidents: qualifications.length, unmeasured,
    verifiedRepairPrs: measuredProposal ? qualifications.filter(q => q.proposal === 'qualified').length : null,
    integratedRecoveries: measuredIntegration ? qualifications.filter(q => q.integration === 'qualified').length : null,
    complete: qualifications.length > 0 && coverage.complete === true && unmeasured === 0 && qualifications.every(q => q.currentScanComplete) };
}
export function publicQualificationSummary(summary) {
  if (summary?.schemaVersion !== 'sutura-qualification-summary-v1' || typeof summary.complete !== 'boolean' ||
      !['incidents', 'unmeasured'].every(key => Number.isSafeInteger(summary[key]) && summary[key] >= 0) ||
      !['verifiedRepairPrs', 'integratedRecoveries'].every(key => summary[key] === null ||
        (Number.isSafeInteger(summary[key]) && summary[key] >= 0 && summary[key] <= summary.incidents)) ||
      summary.unmeasured > summary.incidents ||
      (summary.integratedRecoveries !== null && (summary.verifiedRepairPrs === null || summary.integratedRecoveries > summary.verifiedRepairPrs)) ||
      (summary.complete && (summary.incidents === 0 || summary.unmeasured > 0 || summary.verifiedRepairPrs === null || summary.integratedRecoveries === null))) {
    throw new Error('Invalid qualification summary');
  }
  return Object.fromEntries(['schemaVersion', 'incidents', 'unmeasured', 'verifiedRepairPrs', 'integratedRecoveries', 'complete'].map(key => [key, summary[key]]));
}

/** Safe read-only boundary for rebuilds; original v2 bytes and checksums are never rewritten. */
export async function readLegacyIncidentEvidence(directory) {
  const names = await readdir(directory);
  if (names.length > 100_000) throw new Error('Legacy journal entry limit exceeded');
  const observations = [];
  for (const name of names.filter(name => !name.startsWith('.')).sort()) {
    try {
      if (!/^\d+-\d+-\d+-[a-f0-9]{64}\.json$/u.test(name)) throw new Error('unknown legacy entry');
      const bytes = await boundedRead(join(directory, name));
      if (!name.endsWith(`-${hash(bytes)}.json`)) throw new Error('legacy checksum mismatch');
      const observation = JSON.parse(bytes.toString('utf8'));
      if (observation.schemaVersion !== 'sutura-fleet-observation-v1' ||
          observation.incident?.schemaVersion !== 'sutura-fleet-incident-v2') throw new Error('unknown legacy schema');
      observations.push(observation);
    } catch { throw new Error(`Legacy journal integrity error at ${join(directory, name)}; preserve bytes and rebuild from validated observations`); }
  }
  return observations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 4 || args[0] !== '--rebuild-from-v2' || args[2] !== '--output') throw new Error('Usage: --rebuild-from-v2 observations-directory --output new-generation-directory');
    const output = resolve(args[3]), input = resolve(args[1]);
    if (output === input || output.startsWith(`${input}/`)) throw new Error('Rebuild output must be a distinct new generation');
    await mkdir(output, { mode: 0o700 });
    const observations = await readLegacyIncidentEvidence(input);
    const records = rebuildLegacyEvidence(observations);
    for (const record of records) await persistIncidentEvidence(output, record);
    process.stdout.write(`${JSON.stringify({ records: records.length, qualification: 'unmeasured', skipped: observations.length - records.length })}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
