import { readNativeFailureForVerification } from './diagnose.js';
import { runCommand, type CommandRunner } from './command.js';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { promisify } from 'node:util';
import { authorizeCliVerification, canonicalPacketDigest, canonicalJson, parseVerificationPacket, captureNodeDiagnostics,
  type DiagnosticBinding, type NativeFailureEvidence, type RepositoryPolicy,
  type ResolvedReproductionPlan, type VerificationBinding, type VerificationPacket } from '@sutura/core';
import { reserveVerificationGrant } from '../../../scripts/verification-packet-spend.mjs';
import { requireEngineSha } from './engine-identity.js';
import { assertCleanCheckoutAt, readTrustedPolicyAtCommit } from './verify-source.js';
const exec = promisify(execFile), SHA = /^[a-f0-9]{40}$/u, HASH = /^[a-f0-9]{64}$/u;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
interface Envelope { packet: VerificationPacket; nativeLog: string; nativeBinding: DiagnosticBinding }
export interface CliVerificationAuthorizationInput { caseDir: string; envelopePath: string; operatorDigest?: string | undefined }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
async function readEnvelope(path: string): Promise<Envelope> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || (before.mode & 0o077) !== 0 || (process.getuid !== undefined && before.uid !== process.getuid())) throw new Error('Authorization envelope must be a private operator-owned regular file');
    if (before.size > 2_097_152) throw new Error('Authorization envelope exceeds its bounded size');
    const bytes = Buffer.alloc(before.size + 1), result = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat();
    if (result.bytesRead !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Authorization envelope changed while reading');
    const content = bytes.subarray(0, before.size), text = content.toString('utf8');
    if (!Buffer.from(text).equals(content)) throw new Error('Authorization envelope must be UTF-8');
    const value: unknown = JSON.parse(text);
    if (!object(value) || Object.keys(value).length !== 3 || !object(value.packet) || typeof value.nativeLog !== 'string' || Buffer.byteLength(value.nativeLog) > 1_048_576 || !object(value.nativeBinding)) throw new Error('Authorization envelope requires packet, nativeLog and nativeBinding only');
    return value as unknown as Envelope;
  } finally { await handle.close(); }
}
function repositoryFromOrigin(origin: string): string {
  const ssh = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/u.exec(origin);
  if (ssh) return ssh[1]!;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) throw new Error();
    const path = url.pathname.replace(/^\//u, '').replace(/\.git$/u, '');
    if (/^[\w.-]+\/[\w.-]+$/u.test(path)) return path;
  } catch { /* Keep credentials and arbitrary remote text out of diagnostics. */ }
  throw new Error('Long verification requires a canonical GitHub origin repository');
}
async function git(caseDir: string, args: string[]): Promise<string> {
  return (await exec('git', ['-C', caseDir, ...args], { timeout: 15_000, maxBuffer: 262_144 })).stdout.trim();
}
/** Prepare trusted evidence only. The callback durably consumes approval before paid execution. */
export async function prepareCliVerificationAuthorization(input: CliVerificationAuthorizationInput, dependencies: { run?: CommandRunner } = {}) {
  input = Object.freeze({ ...input });
  if (!input.operatorDigest || !HASH.test(input.operatorDigest)) throw new Error('Explicit --authorize-long-verification operator digest is required');
  const envelope = await readEnvelope(input.envelopePath);
  const packet = parseVerificationPacket(envelope.packet), { nativeLog, nativeBinding } = envelope;
  if (canonicalPacketDigest(packet) !== input.operatorDigest) throw new Error('Explicit operator digest differs from canonical verification packet digest');
  if (![packet.sourceSha, packet.policyBaseSha, packet.engineSha].every(value => typeof value === 'string' && SHA.test(value))) throw new Error('Exact source, protected policy and engine commits are required');
  const engineSha = requireEngineSha();
  if (packet.engineSha !== engineSha) throw new Error('Approved engine commit differs from this clean CLI build');
  const repository = repositoryFromOrigin(await git(input.caseDir, ['remote', 'get-url', 'origin']));
  if (packet.repository !== repository) throw new Error('Approved repository differs from actual Git origin');
  await assertCleanCheckoutAt(input.caseDir, packet.sourceSha);
  const loaded = await readTrustedPolicyAtCommit(input.caseDir, packet.policyBaseSha);
  if (loaded.sha !== packet.policySha256) throw new Error('Protected policy digest differs from approved packet');
  const profiles = loaded.policy.reproductionProfiles?.filter(profile => profile.nativeCommand === packet.fullCommand) ?? [];
  if (profiles.length !== 1) throw new Error('Approved command requires one protected reproduction profile');
  const protectedRefs = [...new Set(profiles[0]!.callers.map(caller => caller.protectedRef))];
  const verifyProtectedRefs = async () => {
    for (const ref of protectedRefs) {
      let sha: string;
      try { sha = await git(input.caseDir, ['rev-parse', '--verify', ref]); }
      catch { throw new Error(`Protected policy ref ${ref} is unavailable locally; reconcile before execution`); }
      if (sha !== packet.policyBaseSha) throw new Error(`Protected policy ref ${ref} differs from approved policy base`);
    }
  };
  await verifyProtectedRefs();
  if (hash(nativeLog) !== packet.nativeLogSha256) throw new Error('Native log digest differs from approved packet');
  for (const key of ['repository', 'sourceSha', 'runId', 'attempt'] as const) if (nativeBinding[key] !== packet[key]) throw new Error(`Native binding ${key} differs from approved packet`);
  const diagnostics = captureNodeDiagnostics(nativeLog, nativeBinding, 'normal');
  if (hash(canonicalJson(diagnostics.binding)) !== packet.nativeBindingSha256) throw new Error('Native source/job/step/runtime binding differs from approved packet');
  if (!diagnostics.complete || !diagnostics.summary || diagnostics.summary.failed < 1) throw new Error(`Complete native diagnostics required: ${diagnostics.reason}`);
  const actual: VerificationBinding = Object.freeze({ repository, sourceSha: packet.sourceSha, policyBaseSha: packet.policyBaseSha, engineSha, runId: diagnostics.binding.runId, attempt: diagnostics.binding.attempt });
  const trustedPacket = Object.freeze(structuredClone(packet));
  const policy: RepositoryPolicy = loaded.policy;
  const nativeFailure: NativeFailureEvidence = await readNativeFailureForVerification(diagnostics.binding, packet.fullCommand, dependencies.run ?? runCommand);
  if (nativeFailure.diagnostics?.logSha256 !== packet.nativeLogSha256 || hash(canonicalJson(nativeFailure.diagnostics.binding)) !== packet.nativeBindingSha256) throw new Error('Authenticated native log or job/step binding differs from approved packet');
  return {
    packet: trustedPacket,
    policy, policyEvidence: { baseRef: protectedRefs[0] ?? packet.policyBaseSha, baseSha: packet.policyBaseSha, policySha: loaded.sha },
    nativeFailure, sourceIdentity: { kind: 'git' as const, sourceSha: packet.sourceSha, policyBaseSha: packet.policyBaseSha, snapshotSha256: null },
    failureCommand: packet.fullCommand,
    authorizeVerification: async (plan: ResolvedReproductionPlan) => {
      await assertCleanCheckoutAt(input.caseDir, actual.sourceSha);
      await verifyProtectedRefs();
      if (repositoryFromOrigin(await git(input.caseDir, ['remote', 'get-url', 'origin'])) !== actual.repository) throw new Error('Git origin changed before verification grant issuance');
      return authorizeCliVerification({ packet: trustedPacket, plan, actual, operatorDigest: input.operatorDigest,
        reserveGrant: (id, digest) => reserveVerificationGrant({ caseDir: input.caseDir, packetId: id, packetDigest: digest, repository: actual.repository, runId: actual.runId, attempt: actual.attempt, sourceSha: actual.sourceSha, reservationUsd: trustedPacket.sandboxReservationUsd }) });
    },
  };
}
