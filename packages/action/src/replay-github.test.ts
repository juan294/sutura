import { describe, expect, it, vi } from 'vitest';

import { ReplayRecorder } from '@sutura/core';

import type { GitHubApi } from './github.js';
import { recordingGitHubApi } from './replay-github.js';

const CONFIG = {
  triageN: 1, raceK: 1,
  models: { nano: 'nano', super: 'super', ultra: 'ultra' },
  routingProfileId: 'test', maxOps: 1,
} as const;

describe('recordingGitHubApi', () => {
  it('proxies and records every GitHub API method', async () => {
    const method = () => vi.fn(async () => ({ ok: true }));
    const api = {
      getWorkflowRun: method(),
      listPullRequestsForCommit: method(),
      getPullRequest: method(),
      listJobsForWorkflowRun: method(),
      downloadJobLogs: method(),
      listIssueComments: method(),
      listCommitComments: method(),
      createRef: method(),
      deleteRef: method(),
      createIssueComment: method(),
      createCommitComment: method(),
      updateIssueComment: method(),
      updateCommitComment: method(),
      getRefSha: method(),
      getCommitParents: method(),
      getCommitSha: method(),
      createPullRequest: method(),
      listCheckRunsForRef: method(),
      createCheckRun: method(),
      updateCheckRun: method(),
    } as unknown as GitHubApi;
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const wrapped = recordingGitHubApi(api, recorder) as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;

    for (const name of Object.keys(api)) await wrapped[name]?.('argument');

    const bundle = recorder.finish('fixed');
    expect(bundle.github.map(({ method: name }) => name)).toEqual(Object.keys(api));
    for (const value of Object.values(api)) expect(value).toHaveBeenCalledOnce();
  });

  it('records and rethrows an API error', async () => {
    const failure = new Error('GitHub unavailable');
    const api = { getWorkflowRun: vi.fn(async () => { throw failure; }) } as unknown as GitHubApi;
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);

    await expect(recordingGitHubApi(api, recorder).getWorkflowRun(77)).rejects.toBe(failure);
    expect(recorder.finish('infra-stop').github[0]?.result).toEqual({
      error: 'GitHub unavailable',
    });
  });

  it('keeps invocation sequence when concurrent calls finish out of order', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    let resolveSecond: ((value: unknown) => void) | undefined;
    const api = {
      getWorkflowRun: vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; })),
    } as unknown as GitHubApi;
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const wrapped = recordingGitHubApi(api, recorder);

    const first = wrapped.getWorkflowRun(1);
    const second = wrapped.getWorkflowRun(2);
    resolveSecond?.({ id: 2 });
    await second;
    resolveFirst?.({ id: 1 });
    await first;

    expect(recorder.finish('fixed').github.map(({ sequence, args, result }) => ({
      sequence, args, result,
    }))).toEqual([
      { sequence: 1, args: [1], result: { id: 1 } },
      { sequence: 2, args: [2], result: { id: 2 } },
    ]);
  });
});
