import { describe, expect, it } from 'vitest';

import { ReplayRecorder } from '@sutura/core';

import { GitHubAdapter, type GitHubApi } from './github.js';
import { withFailureSafeCheck } from './failure-safe.js';

const SHA = 'a'.repeat(40);
const REPLAY_CONFIG = {
  triageN: 1, raceK: 1,
  models: { nano: 'nano', super: 'super', ultra: 'ultra' },
  routingProfileId: 'test', maxOps: 1,
} as const;

describe('action check failure safety', () => {
  it('completes the same created check when orchestration throws', async () => {
    const checks: Array<{ id: number; headSha: string; externalId: string; name: string; status: string; conclusion: string | null }> = [];
    const updates: Array<Record<string, unknown>> = [];
    const api = {
      getWorkflowRun: async () => ({ id: 77, headSha: SHA, repository: 'owner/repo', event: 'pull_request', conclusion: 'failure', pullRequests: [{ number: 9 }] }),
      listCheckRunsForRef: async () => checks.map((check) => ({ ...check })),
      listIssueComments: async () => [],
      createRef: async () => undefined,
      deleteRef: async () => undefined,
      createCheckRun: async (input: { headSha: string; externalId: string; name: string }) => {
        checks.push({ id: 91, headSha: input.headSha, externalId: input.externalId, name: input.name, status: 'in_progress', conclusion: null });
        return { id: 91 };
      },
      createIssueComment: async () => ({ id: 44 }),
      updateCheckRun: async (input: Record<string, unknown>) => { updates.push(input); },
    } as unknown as GitHubApi;
    const adapter = new GitHubAdapter(api, { owner: 'owner', repo: 'repo', runId: '77' });
    let claimedCheckRunId: number | undefined;

    await expect(withFailureSafeCheck(
      adapter,
      async () => {
        claimedCheckRunId = (await adapter.claimAttempt(9, '<!-- marker -->'))?.checkRunId;
        throw new Error('artifact serialization failed');
      },
    )).rejects.toThrow('artifact serialization failed');

    expect(claimedCheckRunId).toBe(91);
    expect(updates).toEqual([expect.objectContaining({
      checkRunId: claimedCheckRunId,
      status: 'completed',
      conclusion: 'action_required',
    })]);
  });

  it('preserves the orchestration failure when terminal check completion also fails', async () => {
    const warnings: string[] = [];
    await expect(withFailureSafeCheck(
      { completeUnexpectedFailure: async () => { throw new Error('checks API unavailable'); } },
      async () => { throw new Error('provider failed'); },
      (message) => warnings.push(message),
    )).rejects.toThrow('provider failed');
    expect(warnings).toEqual([
      'Sutura could not complete its GitHub check after an unexpected failure.',
    ]);
  });

  it('uploads an infra-stop replay bundle when orchestration crashes', async () => {
    const uploads: Array<{ name: string; json: string }> = [];
    const recorder = new ReplayRecorder('77', 'owner/repo', SHA, REPLAY_CONFIG);

    await expect(withFailureSafeCheck(
      {
        completeUnexpectedFailure: async () => undefined,
        uploadReplayBundle: async (name, json) => {
          uploads.push({ name, json });
          return { url: 'https://example.test/replay' };
        },
      },
      async () => { throw new Error('provider failed'); },
      () => undefined,
      recorder,
    )).rejects.toThrow('provider failed');

    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.name).toBe('sutura-replay-77.json');
    expect(JSON.parse(uploads[0]?.json ?? '{}')).toMatchObject({
      schemaVersion: 'sutura-replay-v1',
      outcome: 'infra-stop',
    });
  });
});
