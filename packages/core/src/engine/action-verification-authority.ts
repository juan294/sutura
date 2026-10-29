import { RecordedExecutor } from '../replay/replay-executor.js';
import { createHash } from 'node:crypto';
import { parseAssessmentWorkflow } from '../incidents/workflow-assessment.js';
import { parseRepositoryPolicy } from '../policy/schema.js';
import type { ReproductionProfile } from '../policy/reproduction-profile.js';
import { canonicalJson } from '../replay/canonical-json.js';
import type { VerificationBinding, VerificationPacket } from './verification-allowance.js';

/** Raw identities must come from authenticated API responses, never event JSON. */
export interface ActionAuthorityRun {
  id: number; attempt: number; repository: string; repositoryId: number; headRepositoryId: number;
  headSha: string; headBranch: string; event: string; actorId: number; triggeringActorId: number;
  workflowId: number; workflowPath: string; conclusion: string | null;
}
export interface ActionAuthorityBlob { repository: string; path: string; commitSha: string; blobSha: string; content: string; size: number }
export interface ActionGrantBinding {
  id: string; repository: string; repositoryId: number; callerRunId: number; callerJobId: number; callerAttempt: 1;
  sandboxReservationUsd: number;
  actual: Readonly<VerificationBinding>; packetDigest: string; policySha256: string; profileSha256: string;
}
export interface ActionAuthorityApi {
  getRun(repository: string, runId: number, attempt: number): Promise<ActionAuthorityRun>;
  getProtectedRef(repository: string, ref: string): Promise<{ repositoryId: number; ref: string; protected: boolean; sha: string }>;
  compareCommits(repository: string, baseSha: string, headSha: string): Promise<{ baseSha: string; mergeBaseSha: string; headSha: string; status: string; behindBy: number }>;
  getFileBlob(repository: string, path: string, commitSha: string): Promise<ActionAuthorityBlob>;
  getJobs(repository: string, runId: number, attempt: number): Promise<{
    complete: boolean; totalCount: number;
    jobs: Array<{ id: number; runId: number; attempt: number; headSha: string; name: string; status: string; steps: Array<{ name: string; number: number; status: string }> }>;
  }>;
  /** Atomically persist this grant; refuse existing/in-flight/ambiguous IDs and never delete history. */
  claimGrant(binding: Readonly<ActionGrantBinding>): Promise<void>;
}
export interface ActionReadPermit { readonly version: 'sutura-action-read-permit-v1'; readonly actual: Readonly<VerificationBinding> }
export interface AuthenticatedActionAuthority {
  readonly version: 'sutura-authenticated-action-authority-v1'; readonly actual: Readonly<VerificationBinding>;
  readonly provenance: string; readonly readPermit: ActionReadPermit; readonly packetDigest: string;
  reserveGrant(): Promise<void>;
}
export type ActionReadAuthority = Pick<AuthenticatedActionAuthority, 'actual' | 'provenance' | 'readPermit'>;
const authorities = new WeakSet<AuthenticatedActionAuthority>(), readAuthorities = new WeakSet<ActionReadAuthority>(), permits = new WeakSet<ActionReadPermit>();
const SHA = /^[a-f0-9]{40}$/u, DIGEST = /^[a-f0-9]{64}$/u;
const packetExpression = "${{ inputs['verification-packet'] }}";
const digestExpression = "${{ inputs['verification-packet-digest'] }}";
const runExpression = "${{ fromJSON(inputs['verification-packet']).runId }}";
const concurrencyGroup = "sutura-long-${{ fromJSON(inputs['verification-packet']).repository }}-${{ fromJSON(inputs['verification-packet']).runId }}-${{ fromJSON(inputs['verification-packet']).attempt }}";
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function requireFact(value: unknown, reason: string): asserts value { if (!value) throw new Error(`Action verification authority: ${reason}`); }
function id(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
function object(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function unchanged(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function checkBlob(value: ActionAuthorityBlob, repository: string, path: string, sha: string): string {
  requireFact(value.repository === repository && value.path === path && value.commitSha === sha && SHA.test(value.blobSha), 'exact blob binding differs');
  requireFact(typeof value.content === 'string' && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= 65_536 && Buffer.byteLength(value.content) === value.size, 'bounded complete blob required');
  requireFact(createHash('sha1').update(`blob ${value.size}\0`).update(value.content).digest('hex') === value.blobSha, 'Git blob digest differs');
  return value.content;
}
function checkRun(value: ActionAuthorityRun, repository: string, runId: number, attempt: number): void {
  requireFact(value.id === runId && value.attempt === attempt && id(value.repositoryId) && value.repository === repository && value.headRepositoryId === value.repositoryId && SHA.test(value.headSha), 'authenticated run/repository/attempt identity differs');
}
function checkWorkflow(text: string, packet: VerificationPacket): { jobName: string; stepName: string } {
  const workflow = parseAssessmentWorkflow(text), events = object(workflow.on), dispatch = object(events?.workflow_dispatch), inputs = object(dispatch?.inputs);
  requireFact(events && Object.keys(events).length === 1 && dispatch && inputs, 'explicit owner dispatch workflow required');
  for (const name of ['verification-packet', 'verification-packet-digest']) {
    const declaration = object(inputs[name]);
    requireFact(declaration?.required === true && declaration.type === 'string' && declaration.default === undefined, 'required explicit packet/digest inputs required');
  }
  requireFact(workflow.env === undefined, 'ambient workflow environment is unsupported');
  const concurrency = object(workflow.concurrency);
  requireFact(concurrency?.group === concurrencyGroup && concurrency['cancel-in-progress'] === false, 'source-incident concurrency without cancellation required');
  const jobs = object(workflow.jobs);
  requireFact(jobs && Object.keys(jobs).length === 1, 'exactly one repair job required');
  const [jobKey] = Object.keys(jobs), job = object(jobs[jobKey!]);
  requireFact(job && job.strategy === undefined && job.uses === undefined && job.env === undefined && job.if === undefined, 'matrix/reusable/dynamic job is unsupported');
  requireFact(Number.isSafeInteger(job['timeout-minutes']) && Number(job['timeout-minutes']) > 0 && Number(job['timeout-minutes']) <= 120 && Number(job['timeout-minutes']) * 60 >= packet.workflowTimeoutSec, 'workflow wall timeout cannot fit packet');
  requireFact(Array.isArray(job.steps) && job.steps.length === 1, 'exactly one pinned repair Action step required');
  const step = object(job.steps[0]), withInputs = object(step?.with);
  requireFact(step && step.uses === `juan294/sutura@${packet.engineSha}` && step.run === undefined && step.env === undefined && step.if === undefined && step['continue-on-error'] === undefined && job['continue-on-error'] === undefined, 'unchanged pinned Sutura Action required');
  requireFact(step['timeout-minutes'] === undefined || Number.isSafeInteger(step['timeout-minutes']) && Number(step['timeout-minutes']) > 0 && Number(step['timeout-minutes']) * 60 >= packet.workflowTimeoutSec, 'Action step wall timeout cannot fit packet');
  requireFact(withInputs?.['verification-packet'] === packetExpression && withInputs['authorize-long-verification'] === digestExpression && withInputs['run-id'] === runExpression && (withInputs.mode === undefined || withInputs.mode === 'heal' || withInputs.mode === 'verify'), 'direct dispatch packet/digest/source mapping required');
  const jobName = job.name ?? jobKey, stepName = step.name;
  requireFact(typeof jobName === 'string' && jobName.length > 0 && jobName.length <= 160 && !jobName.includes('${{') && typeof stepName === 'string' && stepName.length > 0 && stepName.length <= 160 && !stepName.includes('${{'), 'static caller job and Action names required');
  return { jobName, stepName };
}
export function isAuthenticatedActionAuthority(value: unknown): value is AuthenticatedActionAuthority { return typeof value === 'object' && value !== null && authorities.has(value as AuthenticatedActionAuthority); }
export function permitsActionSourceRead(value: unknown, binding: Pick<VerificationBinding, 'repository' | 'runId' | 'attempt' | 'sourceSha'>): value is ActionReadPermit {
  if (typeof value !== 'object' || value === null || !permits.has(value as ActionReadPermit)) return false;
  const actual = (value as ActionReadPermit).actual;
  return actual.repository === binding.repository && actual.runId === binding.runId && actual.attempt === binding.attempt && actual.sourceSha === binding.sourceSha;
}
export function permitsActionPolicyRead(value: unknown, binding: Pick<VerificationBinding, 'repository' | 'policyBaseSha'>): value is ActionReadPermit {
  if (typeof value !== 'object' || value === null || !permits.has(value as ActionReadPermit)) return false;
  const actual = (value as ActionReadPermit).actual;
  return actual.repository === binding.repository && actual.policyBaseSha === binding.policyBaseSha;
}

/** Inputs are runner-provided strings under the authenticated immutable mapping, not REST run inputs (GitHub does not expose those). */
export async function authenticateActionVerification(input: {
  packet: VerificationPacket; profile: ReproductionProfile; callerRunId: number; callerJobId: number;
  packetInput: string; packetDigestInput: string; api: ActionAuthorityApi;
}): Promise<AuthenticatedActionAuthority> {
  const packet = structuredClone(input.packet), profile = structuredClone(input.profile), api = input.api;
  requireFact(packet.version === 'sutura-verification-packet-v1' && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(packet.id) && /^[\w.-]+\/[\w.-]+$/u.test(packet.repository) && /^[1-9]\d*$/u.test(packet.runId) && id(Number(packet.runId)) && id(packet.attempt) && id(input.callerRunId) && id(input.callerJobId) && input.callerRunId !== Number(packet.runId), 'exact source/caller identity required');
  requireFact([packet.sourceSha, packet.policyBaseSha, packet.engineSha].every(sha => SHA.test(sha)) && [packet.policySha256, packet.profileSha256, packet.nativeLogSha256, packet.nativeBindingSha256].every(sha => DIGEST.test(sha)), 'exact source/policy/profile/engine/log digests required');
  const serialized = canonicalJson(packet), packetDigest = digest(serialized);
  requireFact(Buffer.byteLength(serialized) <= 16_384 && input.packetInput === serialized, 'explicit canonical packet invocation differs');
  requireFact(input.packetDigestInput === packetDigest, 'separate dispatch digest differs');
  requireFact(digest(canonicalJson(profile)) === packet.profileSha256, 'profile digest differs');
  const caller = structuredClone(await api.getRun(packet.repository, input.callerRunId, 1));
  checkRun(caller, packet.repository, input.callerRunId, 1);
  requireFact(caller.event === 'workflow_dispatch' && caller.conclusion === null && id(caller.actorId) && id(caller.triggeringActorId) && profile.approverIds.includes(caller.actorId) && profile.approverIds.includes(caller.triggeringActorId), 'owner dispatch actor/trigger authority unavailable');
  const enrollment = profile.callers.filter(item => item.workflowId === caller.workflowId && item.path === caller.workflowPath && item.engineSha === packet.engineSha && item.protectedRef === `refs/heads/${caller.headBranch}`);
  requireFact(enrollment.length === 1, 'caller workflow/profile/engine enrollment differs');
  const selected = enrollment[0]!;
  const ref = structuredClone(await api.getProtectedRef(packet.repository, selected.protectedRef));
  requireFact(ref.repositoryId === caller.repositoryId && ref.ref === selected.protectedRef && ref.protected === true && ref.sha === caller.headSha, 'protected current caller ref differs');
  const workflowBlob = await api.getFileBlob(packet.repository, selected.path, caller.headSha);
  const workflow = checkBlob(workflowBlob, packet.repository, selected.path, caller.headSha);
  requireFact(workflowBlob.blobSha === selected.blobSha, 'enrolled workflow blob differs');
  const expected = checkWorkflow(workflow, packet);
  if (packet.policyBaseSha !== ref.sha) {
    const comparison = await api.compareCommits(packet.repository, packet.policyBaseSha, ref.sha);
    requireFact(comparison.baseSha === packet.policyBaseSha && comparison.mergeBaseSha === packet.policyBaseSha && comparison.headSha === ref.sha && comparison.status === 'ahead' && comparison.behindBy === 0, 'protected policy ancestry differs');
  }
  for (const sha of new Set([packet.policyBaseSha, ref.sha])) {
    const declaration = checkBlob(await api.getFileBlob(packet.repository, '.sutura.json', sha), packet.repository, '.sutura.json', sha);
    requireFact(digest(declaration) === packet.policySha256, 'protected policy changed');
    const policy = parseRepositoryPolicy(declaration);
    requireFact(policy.reproductionProfiles?.filter(item => digest(canonicalJson(item)) === packet.profileSha256).length === 1, 'profile is not protected policy data');
  }
  const source = await api.getRun(packet.repository, Number(packet.runId), packet.attempt);
  checkRun(source, packet.repository, Number(packet.runId), packet.attempt);
  requireFact(source.repositoryId === caller.repositoryId && source.headSha === packet.sourceSha && ['failure', 'timed_out'].includes(source.conclusion ?? ''), 'selected failed source differs');
  const jobs = await api.getJobs(packet.repository, caller.id, 1);
  requireFact(jobs.complete === true && jobs.totalCount === 1 && jobs.jobs.length === 1, 'complete single caller job inventory required');
  const job = jobs.jobs[0]!;
  requireFact(job.id === input.callerJobId && job.runId === caller.id && job.attempt === 1 && job.headSha === caller.headSha && job.name === expected.jobName && job.status === 'in_progress', 'authenticated caller job differs');
  const steps = job.steps.filter(step => step.name === expected.stepName && id(step.number) && step.status === 'in_progress');
  requireFact(steps.length === 1, 'authenticated active Action step differs');
  const actual = Object.freeze({ repository: packet.repository, runId: packet.runId, attempt: source.attempt, sourceSha: source.headSha, policyBaseSha: packet.policyBaseSha, engineSha: selected.engineSha });
  const readPermit = Object.freeze({ version: 'sutura-action-read-permit-v1' as const, actual }); permits.add(readPermit);
  const grant = Object.freeze({ sandboxReservationUsd: packet.sandboxReservationUsd, id: `action:${packet.repository}:${caller.id}:1`, repository: packet.repository, repositoryId: caller.repositoryId, callerRunId: caller.id, callerJobId: job.id, callerAttempt: 1 as const, actual, packetDigest, policySha256: packet.policySha256, profileSha256: packet.profileSha256 });
  const revalidate = async () => {
    const current = await api.getRun(packet.repository, caller.id, 1);
    requireFact(unchanged(current, caller), 'caller changed during authentication/reservation');
    requireFact(unchanged(await api.getProtectedRef(packet.repository, selected.protectedRef), ref), 'protected caller changed during authentication/reservation');
  };
  await revalidate();
  let consumed = false;
  const authority = Object.freeze({ version: 'sutura-authenticated-action-authority-v1' as const, actual, readPermit, packetDigest,
    provenance: `authenticated-workflow-dispatch:${packet.repository}:${caller.id}:1:${job.id}:${selected.blobSha}:${packetDigest}`,
    async reserveGrant() {
      requireFact(!consumed, 'grant already consumed'); consumed = true;
      await revalidate(); await api.claimGrant(grant);
    },
  });
  authorities.add(authority); readAuthorities.add(authority); return authority;
}

export function isActionReadAuthority(value: unknown): value is ActionReadAuthority { return typeof value === 'object' && value !== null && readAuthorities.has(value as ActionReadAuthority); }
/** Offline read bindings cannot create live allowance authority or a durable grant. */
export function recordedActionReadAuthority(input: { packet: VerificationPacket; provenance: string; executor: unknown }): ActionReadAuthority {
  if (!(input.executor instanceof RecordedExecutor) || !input.provenance || input.provenance.length > 1024) throw new Error('Recorded read authority requires the owned offline executor');
  const p = input.packet;
  const actual = Object.freeze({ repository: p.repository, runId: p.runId, attempt: p.attempt, sourceSha: p.sourceSha, policyBaseSha: p.policyBaseSha, engineSha: p.engineSha });
  const readPermit = Object.freeze({ version: 'sutura-action-read-permit-v1' as const, actual }); permits.add(readPermit);
  const value = Object.freeze({ actual, provenance: input.provenance, readPermit }); readAuthorities.add(value); return value;
}
