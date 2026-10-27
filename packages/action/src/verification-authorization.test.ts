import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalJson, canonicalPacketDigest, type ActionGrantBinding, type VerificationPacket } from '@sutura/core';
import { reproductionProfile } from '../../core/src/policy/reproduction-profile.test-helper.js';
import { actionVerificationApi, prepareActionVerificationAuthorization } from './verification-authorization.js';
const binding: ActionGrantBinding = { id: 'action:example/project:99:1', repository: 'example/project', repositoryId: 1, callerRunId: 99, callerJobId: 100, callerAttempt: 1,
  actual: { repository: 'example/project', runId: '42', attempt: 1, sourceSha: 'a'.repeat(40), policyBaseSha: 'b'.repeat(40), engineSha: 'c'.repeat(40) }, packetDigest: 'd'.repeat(64), policySha256: 'e'.repeat(64), profileSha256: 'f'.repeat(64), sandboxReservationUsd: 10 };
it('persists pending source history and a durable dispatch grant before paid work, refusing another grant until reconciled', async () => {
  const comments: Array<{ id: number; body: string; user: { id: number } }> = [];
  const createRef = vi.fn(async () => ({}));
  const octokit = { rest: { repos: { listCommentsForCommit: vi.fn(async () => ({ data: comments })), createCommitComment: vi.fn(async ({ body }: { body: string }) => { comments.push({ id: comments.length + 1, body, user: { id: 10 } }); return { data: comments.at(-1) }; }) }, git: { createRef } } } as unknown as Parameters<typeof actionVerificationApi>[0];
  const api = actionVerificationApi(octokit, 'example', 'project');
  await api.claimGrant(binding);
  expect(createRef).toHaveBeenCalledExactlyOnceWith({ owner: 'example', repo: 'project', ref: 'refs/tags/sutura-long-99-100-1', sha: binding.actual.sourceSha });
  expect(comments[0]?.body).toContain('"state":"pending"');
  const next = { ...binding, id: 'action:example/project:101:1', callerRunId: 101, callerJobId: 102, actual: { ...binding.actual, runId: '43' } };
  await expect(api.claimGrant(next)).rejects.toThrow(/pending/);
  expect(createRef).toHaveBeenCalledTimes(1);
  comments.push({ id: 2, user: { id: 11 }, body: `<!-- sutura-long-source:42:1 -->\n${JSON.stringify({ state: 'reconciled', pendingCommentId: 1, packetDigest: binding.packetDigest, billingComplete: true, billingReceiptSha256: '1'.repeat(64), billingReceiptReference: 'https://provider.example/billing/receipt', actualUsd: 1 })}` });
  await expect(api.claimGrant(next)).rejects.toThrow(/pending/);
  comments[1]!.user.id = 10;
  await api.claimGrant(next);
  expect(createRef).toHaveBeenCalledTimes(2);
  expect(comments).toHaveLength(3);
});
it('refuses an incomplete source account without creating a grant or executing anything', async () => {
  const createRef = vi.fn(), createCommitComment = vi.fn();
  const octokit = { rest: { repos: { listCommentsForCommit: vi.fn(async () => ({ data: Array.from({ length: 100 }, (_, id) => ({ id, body: 'ordinary' })) })), createCommitComment }, git: { createRef } } } as unknown as Parameters<typeof actionVerificationApi>[0];
  await expect(actionVerificationApi(octokit, 'example', 'project').claimGrant(binding)).rejects.toThrow(/incomplete/);
  expect(createRef).not.toHaveBeenCalled(); expect(createCommitComment).not.toHaveBeenCalled();
});

it('rejects a foreign repository before contacting the GitHub run API', async () => {
  const getWorkflowRunAttempt = vi.fn(), getWorkflowRun = vi.fn();
  const octokit = { rest: { actions: { getWorkflowRunAttempt, getWorkflowRun } } } as unknown as Parameters<typeof actionVerificationApi>[0];
  await expect(actionVerificationApi(octokit, 'example', 'project').getRun('foreign/project', 99, 1)).rejects.toThrow('Authorization API repository differs');
  expect(getWorkflowRunAttempt).not.toHaveBeenCalled();
  expect(getWorkflowRun).not.toHaveBeenCalled();
});

function preparationFixture(includeProfile: boolean, jobs: { total_count: number; jobs: Array<{ id: number }> }) {
  const profile = reproductionProfile();
  const policyContent = JSON.stringify({ version: 1, ...(includeProfile ? { reproductionProfiles: [profile] } : {}) });
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const packet: VerificationPacket = { ...binding.actual, version: 'sutura-verification-packet-v1', id: 'guard-approval',
    policySha256: hash(policyContent), profileSha256: hash(canonicalJson(profile)), nativeLogSha256: '1'.repeat(64), nativeBindingSha256: '2'.repeat(64),
    fullCommand: profile.fullCommand, fullTimeoutSec: profile.fullTimeoutSec, finalAllowanceSec: 2100, policyTimeoutSec: 120, challengeTimeoutSec: 120,
    cancellationSec: 15, adjudicationSec: 60, providerMaxTimeoutSec: 3600, workflowTimeoutSec: 3000, sandboxUsdPerSecond: 0.00001, sandboxReservationUsd: 10 };
  const getContent = vi.fn(async () => ({ data: { type: 'file', path: '.sutura.json', encoding: 'base64', content: Buffer.from(policyContent).toString('base64'), size: Buffer.byteLength(policyContent), sha: '3'.repeat(40) } }));
  const listJobsForWorkflowRunAttempt = vi.fn(async () => ({ data: jobs }));
  const createCommitComment = vi.fn(), createRef = vi.fn();
  const octokit = { rest: { repos: { getContent, createCommitComment }, actions: { listJobsForWorkflowRunAttempt }, git: { createRef } } } as unknown as Parameters<typeof actionVerificationApi>[0];
  return { input: { octokit, owner: 'example', repo: 'project', callerRunId: 99, packetInput: canonicalJson(packet), packetDigestInput: canonicalPacketDigest(packet) }, getContent, listJobsForWorkflowRunAttempt, createCommitComment, createRef };
}

it('rejects an oversized verification packet before parsing or reading protected GitHub state', async () => {
  const f = preparationFixture(true, { total_count: 1, jobs: [{ id: 100 }] });
  await expect(prepareActionVerificationAuthorization({ ...f.input, packetInput: ' '.repeat(16_385) })).rejects.toThrow('Verification packet exceeds bound');
  expect(f.getContent).not.toHaveBeenCalled();
  expect(f.listJobsForWorkflowRunAttempt).not.toHaveBeenCalled();
  expect(f.createCommitComment).not.toHaveBeenCalled();
  expect(f.createRef).not.toHaveBeenCalled();
});

it('rejects a packet whose profile is absent from the actual protected policy', async () => {
  const f = preparationFixture(false, { total_count: 1, jobs: [{ id: 100 }] });
  await expect(prepareActionVerificationAuthorization(f.input)).rejects.toThrow('Packet requires one exact protected profile');
  expect(f.getContent).toHaveBeenCalledExactlyOnceWith({ owner: 'example', repo: 'project', path: '.sutura.json', ref: binding.actual.policyBaseSha });
  expect(f.listJobsForWorkflowRunAttempt).not.toHaveBeenCalled();
  expect(f.createCommitComment).not.toHaveBeenCalled();
  expect(f.createRef).not.toHaveBeenCalled();
});

it.each([
  ['incomplete', { total_count: 2, jobs: [] }],
  ['multiple', { total_count: 2, jobs: [{ id: 100 }, { id: 101 }] }],
] as const)('rejects %s authenticated caller-job inventory before issuing authority', async (_name, inventory) => {
  const f = preparationFixture(true, { total_count: inventory.total_count, jobs: [...inventory.jobs] });
  await expect(prepareActionVerificationAuthorization(f.input)).rejects.toThrow('Authenticated caller requires one complete job');
  expect(f.getContent).toHaveBeenCalledTimes(1);
  expect(f.listJobsForWorkflowRunAttempt).toHaveBeenCalledExactlyOnceWith({ owner: 'example', repo: 'project', run_id: 99, attempt_number: 1, per_page: 100 });
  expect(f.createCommitComment).not.toHaveBeenCalled();
  expect(f.createRef).not.toHaveBeenCalled();
});
