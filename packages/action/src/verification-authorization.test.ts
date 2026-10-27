import { expect, it, vi } from 'vitest';
import type { ActionGrantBinding } from '@sutura/core';
import { actionVerificationApi } from './verification-authorization.js';
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
