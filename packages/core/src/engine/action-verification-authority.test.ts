import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '../replay/canonical-json.js';
import { reproductionProfile } from '../policy/reproduction-profile.test-helper.js';
import { InMemoryExecutor } from '../executor/memory.js';
import type { VerificationPacket } from './verification-allowance.js';
import {
  authenticateActionVerification, isAuthenticatedActionAuthority, recordedActionReadAuthority,
  permitsActionPolicyRead, permitsActionSourceRead,
  type ActionAuthorityApi, type ActionAuthorityRun,
} from './action-verification-authority.js';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const blob = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
const engineSha = 'd'.repeat(40), sourceSha = 'a'.repeat(40), policyBaseSha = 'b'.repeat(40), callerSha = 'c'.repeat(40);
const packetExpression = "${{ inputs['verification-packet'] }}";
const digestExpression = "${{ inputs['verification-packet-digest'] }}";
const incident = "${{ fromJSON(inputs['verification-packet']).repository }}-${{ fromJSON(inputs['verification-packet']).runId }}-${{ fromJSON(inputs['verification-packet']).attempt }}";
function workflow() {
  return `on:\n  workflow_dispatch:\n    inputs:\n      verification-packet:\n        required: true\n        type: string\n      verification-packet-digest:\n        required: true\n        type: string\nconcurrency:\n  group: sutura-long-${incident}\n  cancel-in-progress: false\njobs:\n  repair:\n    name: Reviewed repair\n    runs-on: ubuntu-latest\n    timeout-minutes: 60\n    steps:\n      - name: Sutura repair\n        uses: juan294/sutura@${engineSha}\n        with:\n          run-id: \${{ fromJSON(inputs['verification-packet']).runId }}\n          verification-packet: ${packetExpression}\n          authorize-long-verification: ${digestExpression}\n`;
}
function fixture(changeWorkflow: (value: string) => string = value => value) {
  const content = changeWorkflow(workflow());
  const profile = reproductionProfile({ callers: [{ workflowId: 8, path: '.github/workflows/long.yml', blobSha: blob(content), protectedRef: 'refs/heads/main', engineSha }], approverIds: [11] });
  const policy = JSON.stringify({ version: 1, reproductionProfiles: [profile] });
  const packet: VerificationPacket = { version: 'sutura-verification-packet-v1', id: 'pilot-one', repository: 'example/project', runId: '42', attempt: 2, sourceSha, policyBaseSha, engineSha,
    policySha256: digest(policy), profileSha256: digest(canonicalJson(profile)), nativeLogSha256: 'e'.repeat(64), nativeBindingSha256: 'f'.repeat(64),
    fullCommand: profile.fullCommand, fullTimeoutSec: 1800, finalAllowanceSec: 2100, policyTimeoutSec: 120, challengeTimeoutSec: 120, cancellationSec: 15, adjudicationSec: 60,
    providerMaxTimeoutSec: 3600, workflowTimeoutSec: 3000, sandboxUsdPerSecond: 0.00001, sandboxReservationUsd: 20 };
  const caller: ActionAuthorityRun = { id: 99, attempt: 1, repository: packet.repository, repositoryId: 10, headRepositoryId: 10, headSha: callerSha, headBranch: 'main', event: 'workflow_dispatch', actorId: 11, triggeringActorId: 11, workflowId: 8, workflowPath: '.github/workflows/long.yml', conclusion: null };
  const source: ActionAuthorityRun = { ...caller, id: 42, attempt: 2, headSha: sourceSha, event: 'pull_request', workflowId: 9, workflowPath: '.github/workflows/ci.yml', conclusion: 'failure' };
  const grants = new Set<string>();
  const api: ActionAuthorityApi = {
    getRun: vi.fn(async (_repository, id) => structuredClone(id === 99 ? caller : source)),
    getProtectedRef: vi.fn(async () => ({ repositoryId: 10, ref: 'refs/heads/main', protected: true, sha: callerSha })),
    compareCommits: vi.fn(async (_repository, base, head) => ({ baseSha: base, mergeBaseSha: base, headSha: head, status: 'ahead', behindBy: 0 })),
    getFileBlob: vi.fn(async (repository, path, commitSha) => { const text = path === '.sutura.json' ? policy : content; return { repository, path, commitSha, content: text, blobSha: blob(text), size: Buffer.byteLength(text) }; }),
    getJobs: vi.fn(async () => ({ complete: true, totalCount: 1, jobs: [{ id: 100, runId: 99, attempt: 1, headSha: callerSha, name: 'Reviewed repair', status: 'in_progress', steps: [{ name: 'Sutura repair', number: 2, status: 'in_progress' }] }] })),
    claimGrant: vi.fn(async grant => { if (grants.has(grant.id)) throw new Error('grant already consumed'); grants.add(grant.id); }),
  };
  const input = { packet, profile, callerRunId: 99, callerJobId: 100, packetInput: canonicalJson(packet), packetDigestInput: digest(canonicalJson(packet)), api };
  return { input, caller, source, api, profile, packet, grants };
}

describe('authenticated Action verification authority', () => {
  it('authenticates read-only, binds separate historical source/policy reads and reserves one durable grant', async () => {
    const f = fixture();
    const authority = await authenticateActionVerification(f.input);
    expect(isAuthenticatedActionAuthority(authority)).toBe(true);
    expect(isAuthenticatedActionAuthority(JSON.parse(JSON.stringify(authority)))).toBe(false);
    expect(f.api.claimGrant).not.toHaveBeenCalled();
    expect(authority.actual).toEqual({ repository: f.packet.repository, runId: '42', attempt: 2, sourceSha, policyBaseSha, engineSha });
    expect(permitsActionSourceRead(authority.readPermit, { repository: f.packet.repository, runId: '42', attempt: 2, sourceSha })).toBe(true);
    expect(permitsActionSourceRead(authority.readPermit, { repository: f.packet.repository, runId: '42', attempt: 2, sourceSha: policyBaseSha })).toBe(false);
    expect(permitsActionPolicyRead(authority.readPermit, { repository: f.packet.repository, policyBaseSha })).toBe(true);
    expect(permitsActionPolicyRead(authority.readPermit, { repository: f.packet.repository, policyBaseSha: sourceSha })).toBe(false);
    expect(permitsActionPolicyRead(JSON.parse(JSON.stringify(authority.readPermit)), { repository: f.packet.repository, policyBaseSha })).toBe(false);
    await authority.reserveGrant();
    await expect(authority.reserveGrant()).rejects.toThrow(/consumed/);
    expect(f.api.claimGrant).toHaveBeenCalledTimes(1);
    expect(authority.provenance).toContain('authenticated-workflow-dispatch');
  });

  it.each([
    ['rerun', { attempt: 2 }], ['automatic event', { event: 'workflow_run' }], ['actor', { actorId: 12 }], ['trigger', { triggeringActorId: 12 }],
    ['fork', { headRepositoryId: 12 }], ['repository', { repository: 'foreign/project' }], ['workflow', { workflowId: 12 }], ['path', { workflowPath: '.github/workflows/other.yml' }],
    ['caller commit', { headSha: 'f'.repeat(40) }],
  ])('rejects %s before a durable grant', async (_name, change) => {
    const f = fixture(); Object.assign(f.caller, change);
    await expect(authenticateActionVerification(f.input)).rejects.toThrow();
    expect(f.api.claimGrant).not.toHaveBeenCalled();
  });

  it.each([
    ['source SHA', { headSha: 'f'.repeat(40) }], ['source attempt', { attempt: 3 }], ['source fork', { headRepositoryId: 12 }], ['source success', { conclusion: 'success' }],
  ])('rejects changed %s', async (_name, change) => {
    const f = fixture(); Object.assign(f.source, change);
    await expect(authenticateActionVerification(f.input)).rejects.toThrow();
  });

  it.each([
    ['matrix', (s: string) => s.replace('    runs-on:', '    strategy:\n      matrix: { version: [22, 24] }\n    runs-on:')],
    ['extra job', (s: string) => s + '  duplicate:\n    uses: other/workflow@main\n'],
    ['extra step', (s: string) => s.replace('    steps:\n', '    steps:\n      - run: echo extra\n')],
    ['unpinned Action', (s: string) => s.replace(`juan294/sutura@${engineSha}`, 'juan294/sutura@main')],
    ['cancel in progress', (s: string) => s.replace('cancel-in-progress: false', 'cancel-in-progress: true')],
    ['nonincident concurrency', (s: string) => s.replace(`sutura-long-${incident}`, 'sutura-long-global')],
    ['short timeout', (s: string) => s.replace('timeout-minutes: 60', 'timeout-minutes: 20')],
    ['short Action timeout', (s: string) => s.replace('        uses:', '        timeout-minutes: 5\n        uses:')],
    ['literal packet mapping', (s: string) => s.replace(packetExpression, 'source-file.json')],
  ])('rejects enrolled but unsafe workflow %s', async (_name, change) => {
    const f = fixture(change);
    await expect(authenticateActionVerification(f.input)).rejects.toThrow();
  });

  it('rejects altered blob bytes, unprotected refs and incomplete job inventories', async () => {
    const bytes = fixture(); vi.mocked(bytes.api.getFileBlob).mockImplementation(async (repository, path, commitSha) => ({ repository, path, commitSha, content: 'altered', size: 7, blobSha: 'f'.repeat(40) }));
    await expect(authenticateActionVerification(bytes.input)).rejects.toThrow();
    const ref = fixture(); vi.mocked(ref.api.getProtectedRef).mockResolvedValue({ repositoryId: 10, ref: 'refs/heads/main', protected: false, sha: callerSha });
    await expect(authenticateActionVerification(ref.input)).rejects.toThrow();
    const jobs = fixture(); vi.mocked(jobs.api.getJobs).mockResolvedValue({ complete: false, totalCount: 2, jobs: [] });
    await expect(authenticateActionVerification(jobs.input)).rejects.toThrow();
  });

  it('rejects a valid but changed protected policy and unrelated policy ancestry', async () => {
    const f = fixture(), original = vi.mocked(f.api.getFileBlob).getMockImplementation()!;
    vi.mocked(f.api.getFileBlob).mockImplementation(async (repository, path, commitSha) => {
      const value = await original(repository, path, commitSha);
      if (path !== '.sutura.json' || commitSha !== callerSha) return value;
      const content = JSON.stringify({ ...JSON.parse(value.content), maxDiffBytes: 1024 });
      return { ...value, content, size: Buffer.byteLength(content), blobSha: blob(content) };
    });
    await expect(authenticateActionVerification(f.input)).rejects.toThrow(/policy changed/);
    const unrelated = fixture();
    vi.mocked(unrelated.api.compareCommits).mockResolvedValue({ baseSha: policyBaseSha, mergeBaseSha: 'f'.repeat(40), headSha: callerSha, status: 'diverged', behindBy: 1 });
    await expect(authenticateActionVerification(unrelated.input)).rejects.toThrow(/ancestry/);
  });

  it('rejects copied invocation strings, packet/profile changes and ambiguous caller jobs', async () => {
    const f = fixture();
    await expect(authenticateActionVerification({ ...f.input, packetInput: JSON.stringify(f.packet) })).rejects.toThrow(/packet/);
    await expect(authenticateActionVerification({ ...f.input, packetDigestInput: 'f'.repeat(64) })).rejects.toThrow(/digest/);
    const p = { ...f.packet, engineSha: 'f'.repeat(40) };
    await expect(authenticateActionVerification({ ...f.input, packet: p, packetInput: canonicalJson(p), packetDigestInput: digest(canonicalJson(p)) })).rejects.toThrow();
    await expect(authenticateActionVerification({ ...f.input, profile: { ...f.profile, probeTimeoutSec: 1 } })).rejects.toThrow();
    await expect(authenticateActionVerification({ ...f.input, callerJobId: 101 })).rejects.toThrow();
  });

  it('revalidates caller/ref identity at reservation and never refunds a failed or duplicate grant', async () => {
    const changed = fixture(), authority = await authenticateActionVerification(changed.input);
    changed.caller.actorId = 12;
    await expect(authority.reserveGrant()).rejects.toThrow();
    await expect(authority.reserveGrant()).rejects.toThrow(/consumed/);
    expect(changed.api.claimGrant).not.toHaveBeenCalled();
    const f = fixture();
    const a = await authenticateActionVerification(f.input), b = await authenticateActionVerification(f.input);
    expect((await Promise.allSettled([a.reserveGrant(), b.reserveGrant()])).filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.grants.size).toBe(1);
  });
});

it('rejects a live executor at the serialized read-authority boundary', () => {
  const executor = new InMemoryExecutor(() => ({ exitCode: 0, stdout: '', stderr: '', truncated: false, metrics: {} }));
  expect(() => recordedActionReadAuthority({ packet: fixture().packet, provenance: 'recorded-only', executor })).toThrow('Recorded read authority requires the owned offline executor');
  expect(executor.calls).toEqual([]);
});
