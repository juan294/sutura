import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { canonicalJson } from '../replay/canonical-json.js';
import { reproductionProfile } from '../policy/reproduction-profile.test-helper.js';
import type { VerificationPacket } from './verification-allowance.js';
import type { ActionAuthorityApi, ActionAuthorityRun } from './action-verification-authority.js';

export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export const blob = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
export const engineSha = 'd'.repeat(40), sourceSha = 'a'.repeat(40), policyBaseSha = 'b'.repeat(40), callerSha = 'c'.repeat(40);
export const packetExpression = "${{ inputs['verification-packet'] }}";
const digestExpression = "${{ inputs['verification-packet-digest'] }}";
export const incident = "${{ fromJSON(inputs['verification-packet']).repository }}-${{ fromJSON(inputs['verification-packet']).runId }}-${{ fromJSON(inputs['verification-packet']).attempt }}";
function workflow() {
  return `on:\n  workflow_dispatch:\n    inputs:\n      verification-packet:\n        required: true\n        type: string\n      verification-packet-digest:\n        required: true\n        type: string\nconcurrency:\n  group: sutura-long-${incident}\n  cancel-in-progress: false\njobs:\n  repair:\n    name: Reviewed repair\n    runs-on: ubuntu-latest\n    timeout-minutes: 60\n    steps:\n      - name: Sutura repair\n        uses: juan294/sutura@${engineSha}\n        with:\n          run-id: \${{ fromJSON(inputs['verification-packet']).runId }}\n          verification-packet: ${packetExpression}\n          authorize-long-verification: ${digestExpression}\n`;
}
export function fixture(changeWorkflow: (value: string) => string = value => value) {
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

