import { isAuthenticatedActionAuthority, type AuthenticatedActionAuthority } from './action-verification-authority.js';
import { RecordedExecutor } from '../replay/replay-executor.js';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../replay/canonical-json.js';
import { isResolvedReproductionPlan, type ResolvedReproductionPlan } from './reproduction-plan.js';
export interface VerificationBinding {
  repository: string; runId: string; attempt: number; sourceSha: string; policyBaseSha: string; engineSha: string;
}
export interface VerificationPacket extends VerificationBinding {
  version: 'sutura-verification-packet-v1'; id: string; policySha256: string; profileSha256: string; nativeLogSha256: string; nativeBindingSha256: string;
  fullCommand: string; fullTimeoutSec: number; finalAllowanceSec: number; policyTimeoutSec: number; challengeTimeoutSec: number;
  cancellationSec: number; adjudicationSec: number; providerMaxTimeoutSec: number; workflowTimeoutSec: number;
  sandboxUsdPerSecond: number; sandboxReservationUsd: number;
}
export interface VerificationAllowance { readonly version: 'sutura-verification-allowance-v1'; readonly packet: Readonly<VerificationPacket>; readonly provenance: string }
export interface FinalVerificationPhase { readonly version: 'sutura-final-verification-phase-v1'; readonly imageId: string; readonly diffSha256: string }
export interface VerificationOperationPermit { readonly version: 'sutura-verification-operation-v1' }
interface AllowanceState { packet: VerificationPacket; consumed: boolean; now: () => number }
interface PhaseState { allowance: AllowanceState; deadline: number; fullUsed: boolean }
const allowances = new WeakMap<VerificationAllowance, AllowanceState>();
const phases = new WeakMap<FinalVerificationPhase, PhaseState>();
const operations = new WeakMap<VerificationOperationPermit, { phase: FinalVerificationPhase; imageId: string; command: string; seconds: number; used: boolean }>();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function fail(detail: string): never { throw new Error(`full-verification-budget-incompatible: ${detail}`); }
export function canonicalPacketDigest(packet: VerificationPacket): string { return hash(canonicalJson(packet)); }
/** Structural data validation only; this never grants spending authority. */
export function parseVerificationPacket(value: unknown): VerificationPacket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('packet object required');
  const packet = value as VerificationPacket;
  const keys = ['version','id','repository','runId','attempt','sourceSha','policyBaseSha','engineSha','policySha256','profileSha256','nativeLogSha256','nativeBindingSha256','fullCommand','fullTimeoutSec','finalAllowanceSec','policyTimeoutSec','challengeTimeoutSec','cancellationSec','adjudicationSec','providerMaxTimeoutSec','workflowTimeoutSec','sandboxUsdPerSecond','sandboxReservationUsd'];
  if (Object.keys(packet).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(packet, key))) fail('packet fields differ from the contract');
  if (packet.version !== 'sutura-verification-packet-v1' || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(packet.id) || !/^[\w.-]+\/[\w.-]+$/u.test(packet.repository) || (!/^[1-9]\d{0,15}$/u.test(packet.runId) || !Number.isSafeInteger(Number(packet.runId)))) fail('packet identity is invalid');
  for (const key of ['sourceSha','policyBaseSha','engineSha'] as const) if (!/^[a-f0-9]{40}$/u.test(packet[key])) fail(`packet ${key} is invalid`);
  for (const key of ['policySha256','profileSha256','nativeLogSha256','nativeBindingSha256'] as const) if (!/^[a-f0-9]{64}$/u.test(packet[key])) fail(`packet ${key} is invalid`);
  for (const key of ['attempt','fullTimeoutSec','finalAllowanceSec','policyTimeoutSec','challengeTimeoutSec','cancellationSec','adjudicationSec','providerMaxTimeoutSec','workflowTimeoutSec'] as const) if (!Number.isSafeInteger(packet[key]) || packet[key] < 1) fail(`packet ${key} is invalid`);
  if (typeof packet.fullCommand !== 'string' || !packet.fullCommand || packet.fullCommand.length > 256 || !/^[\x20-\x7e]+$/u.test(packet.fullCommand)) fail('packet full command is invalid');
  for (const key of ['sandboxUsdPerSecond','sandboxReservationUsd'] as const) if (!Number.isFinite(packet[key]) || packet[key] <= 0 || packet[key] > 100) fail(`packet ${key} is invalid`);
  if (packet.finalAllowanceSec > 3600 || packet.fullTimeoutSec > 3600 || packet.policyTimeoutSec > 600 || packet.challengeTimeoutSec > 600 || packet.cancellationSec > 60 || packet.adjudicationSec > 120 || packet.workflowTimeoutSec > 7200) fail('packet duration exceeds the bounded contract');
  return Object.freeze(structuredClone(packet));
}
export function validateVerificationPacket(packet: VerificationPacket, plan: ResolvedReproductionPlan, actual: VerificationBinding): void {
  if (!isResolvedReproductionPlan(plan) || !packet || packet.version !== 'sutura-verification-packet-v1' || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(packet.id)) fail('validated protected profile and bounded packet ID required');
  parseVerificationPacket(packet);
  for (const key of ['repository','runId','attempt','sourceSha','policyBaseSha','engineSha'] as const) if (packet[key] !== actual[key]) fail(`actual ${key} differs from packet`);
  if (!/^[\w.-]+\/[\w.-]+$/u.test(actual.repository) || !/^[1-9]\d*$/u.test(actual.runId) || !Number.isSafeInteger(actual.attempt) || actual.attempt < 1 || ![actual.sourceSha,actual.policyBaseSha,actual.engineSha].every(sha => /^[a-f0-9]{40}$/u.test(sha))) fail('exact source/policy/engine identity required');
  if (packet.sourceSha !== plan.native.binding.sourceSha || packet.repository !== plan.native.binding.repository || packet.runId !== plan.native.binding.runId || packet.attempt !== plan.native.binding.attempt || packet.policySha256 !== plan.policySha256 || packet.profileSha256 !== plan.profileSha256 || packet.nativeLogSha256 !== plan.native.logSha256 || packet.nativeBindingSha256 !== hash(canonicalJson(plan.native.binding)) || packet.fullCommand !== plan.fullCommand || packet.fullTimeoutSec !== plan.profile.fullTimeoutSec) fail('source, protected policy/profile or full command differs');
  for (const key of ['fullTimeoutSec','finalAllowanceSec','policyTimeoutSec','challengeTimeoutSec','cancellationSec','adjudicationSec','providerMaxTimeoutSec','workflowTimeoutSec'] as const) if (!Number.isSafeInteger(packet[key]) || packet[key] < 1) fail(`positive integer ${key} required`);
  if (packet.finalAllowanceSec > 3600 || packet.policyTimeoutSec > 600 || packet.challengeTimeoutSec > 600 || packet.cancellationSec < 15 || packet.cancellationSec > 60 || packet.adjudicationSec < 60 || packet.adjudicationSec > 120) fail('phase/operation limits exceed bounded contract');
  const challengeRuns = plan.policy.verification?.mode !== 'disabled' && (plan.policy.verification?.contracts.length ?? 0) > 0 ? 6 : 0;
  const required = packet.fullTimeoutSec + plan.policy.requiredCommands.length * 2 * packet.policyTimeoutSec + challengeRuns * packet.challengeTimeoutSec + packet.cancellationSec + packet.adjudicationSec;
  if (required > packet.finalAllowanceSec) fail(`required full/baseline/candidate/challenge/cancellation/adjudication obligations need ${required}s; packet supplies ${packet.finalAllowanceSec}s`);
  if (packet.providerMaxTimeoutSec < Math.max(packet.fullTimeoutSec, packet.policyTimeoutSec, packet.challengeTimeoutSec, plan.profile.probeTimeoutSec)) fail('provider deadline support is unavailable');
  if (packet.workflowTimeoutSec < 600 + packet.finalAllowanceSec) fail('workflow wall timeout cannot contain ordinary and final phases');
  if (!Number.isFinite(packet.sandboxUsdPerSecond) || packet.sandboxUsdPerSecond <= 0 || !Number.isFinite(packet.sandboxReservationUsd) || packet.sandboxReservationUsd <= 0 || packet.sandboxReservationUsd > 100 || packet.sandboxReservationUsd < packet.sandboxUsdPerSecond * (40 * 600 + packet.finalAllowanceSec)) fail('bounded provider price/cost reservation is missing or inadequate');
}
function issue(packet: VerificationPacket, provenance: string, now: () => number): VerificationAllowance {
  const frozen = Object.freeze(structuredClone(packet));
  const capability = Object.freeze({ version: 'sutura-verification-allowance-v1' as const, packet: frozen, provenance });
  allowances.set(capability, { packet: frozen, consumed: false, now }); return capability;
}
/** Adapter-owned operator boundary. The durable reservation must complete before any paid work. */
export async function authorizeCliVerification(input: { packet: VerificationPacket; plan: ResolvedReproductionPlan; actual: VerificationBinding; operatorDigest: string | undefined; reserveGrant(id: string, digest: string): Promise<void>; now?: () => number }): Promise<VerificationAllowance> {
  const packet = parseVerificationPacket(input.packet);
  validateVerificationPacket(packet, input.plan, input.actual);
  const digest = canonicalPacketDigest(packet);
  if (!input.operatorDigest || input.operatorDigest !== digest) fail('separate explicit operator digest is required');
  await input.reserveGrant(packet.id, digest);
  return issue(packet, `cli:${digest}`, input.now ?? Date.now);
}
export function isVerificationAllowance(value: unknown): value is VerificationAllowance { return typeof value === 'object' && value !== null && allowances.has(value as VerificationAllowance); }
export function consumeVerificationAllowance(capability: VerificationAllowance, candidate: { imageId: string; diffSha256: string }): FinalVerificationPhase {
  const state = allowances.get(capability); if (!state || state.consumed) fail('grant is fabricated or already consumed');
  if (!candidate.imageId || candidate.imageId.length > 256 || !/^[a-f0-9]{64}$/u.test(candidate.diffSha256)) fail('selected repair image/diff identity is invalid');
  state.consumed = true;
  const phase = Object.freeze({ version: 'sutura-final-verification-phase-v1' as const, ...candidate });
  phases.set(phase, { allowance: state, deadline: state.now() + state.packet.finalAllowanceSec * 1000, fullUsed: false }); return phase;
}
export function remainingFinalVerificationSec(phase: FinalVerificationPhase): number {
  const state = phases.get(phase); if (!state) fail('final phase is fabricated');
  return Math.max(0, (state.deadline - state.allowance.now()) / 1000);
}
export function verificationOperationPermit(phase: FinalVerificationPhase, imageId: string, command: string, seconds: number): VerificationOperationPermit {
  const state = phases.get(phase); if (!state || state.fullUsed || imageId !== phase.imageId || command !== state.allowance.packet.fullCommand || seconds <= 0 || seconds > state.allowance.packet.fullTimeoutSec || seconds > remainingFinalVerificationSec(phase)) fail('full command/selected candidate/deadline differs or was already attempted');
  state.fullUsed = true;
  const permit = Object.freeze({ version: 'sutura-verification-operation-v1' as const }); operations.set(permit, { phase, imageId, command, seconds, used: false }); return permit;
}
/** Called by the live provider boundary, once. JSON/replay lookalikes cannot expand polling. */
export function authorizedOperationTimeout(permit: VerificationOperationPermit, imageId: string, command: string, seconds: number): number {
  const state = operations.get(permit); if (!state || state.used || state.imageId !== imageId || state.command !== command || state.seconds !== seconds || seconds > remainingFinalVerificationSec(state.phase)) fail('operation authority is fabricated, expired, reused or differently bound');
  state.used = true;
  return seconds * 1000 + 15_000;
}

export function allowanceMatchesPlan(value: VerificationAllowance | undefined, plan: ResolvedReproductionPlan): value is VerificationAllowance {
  if (!value || !isVerificationAllowance(value) || !isResolvedReproductionPlan(plan)) return false;
  const state = allowances.get(value)!;
  if (state.consumed) return false;
  const p = state.packet;
  return p.policySha256 === plan.policySha256 && p.profileSha256 === plan.profileSha256 && p.nativeLogSha256 === plan.native.logSha256 && p.nativeBindingSha256 === hash(canonicalJson(plan.native.binding)) && p.sourceSha === plan.native.binding.sourceSha && p.repository === plan.native.binding.repository && p.runId === plan.native.binding.runId && p.attempt === plan.native.binding.attempt && p.fullCommand === plan.fullCommand;
}

export async function authorizeActionVerification(input: { packet: VerificationPacket; plan: ResolvedReproductionPlan; authority: AuthenticatedActionAuthority; now?: () => number }): Promise<VerificationAllowance> {
  if (!isAuthenticatedActionAuthority(input.authority) || input.authority.packetDigest !== canonicalPacketDigest(input.packet)) fail('authenticated Action authority differs from packet');
  const packet = parseVerificationPacket(input.packet);
  validateVerificationPacket(packet, input.plan, input.authority.actual);
  await input.authority.reserveGrant();
  return issue(packet, input.authority.provenance, input.now ?? Date.now);
}
/** Offline evidence may be simulated only with the owned recorded executor. */
export function authorizeRecordedVerification(input: { packet: VerificationPacket; plan: ResolvedReproductionPlan; executor: unknown; now?: () => number }): VerificationAllowance {
  if (!(input.executor instanceof RecordedExecutor)) fail('recorded approval cannot authorize a custom/live executor');
  validateVerificationPacket(input.packet, input.plan, input.packet);
  return issue(input.packet, `offline-recorded:${canonicalPacketDigest(input.packet)}`, input.now ?? Date.now);
}
