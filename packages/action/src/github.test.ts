import { describe, expect, it } from 'vitest';

import { GitHubAdapter, GitHubAdapterError, type GitHubApi } from './github.js';

const SHA = 'a'.repeat(40);

function api(overrides: Partial<GitHubApi> = {}): GitHubApi {
  return {
    getWorkflowRun: async () => ({
      id: 77,
      headSha: SHA,
      repository: 'owner/repo',
      event: 'pull_request',
      conclusion: 'failure',
      pullRequests: [{ number: 9 }],
    }),
    listPullRequestsForCommit: async () => [],
    getPullRequest: async () => ({
      number: 9,
      headSha: SHA,
      headRef: 'feature',
      headRepo: 'owner/repo',
    }),
    listJobsForWorkflowRun: async () => [{
      id: 5,
      name: 'checks',
      conclusion: 'failure',
      steps: [
        { name: 'Install', conclusion: 'success', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:10Z' },
        { name: 'Test', conclusion: 'failure', startedAt: '2026-01-01T00:00:11Z', completedAt: '2026-01-01T00:00:20Z' },
      ],
    }],
    downloadJobLogs: async () => [
      '2026-01-01T00:00:05Z install',
      ...Array.from({ length: 205 }, (_, index) => `2026-01-01T00:00:12Z test-${index}`),
    ].join('\n'),
    listIssueComments: async () => [],
    listCommitComments: async () => [],
    createRef: async () => undefined,
    deleteRef: async () => undefined,
    createIssueComment: async () => ({ id: 44 }),
    createCommitComment: async () => ({ id: 44 }),
    updateIssueComment: async () => undefined,
    updateCommitComment: async () => undefined,
    getRefSha: async () => SHA,
    getCommitParents: async () => [SHA],
    createPullRequest: async () => ({ number: 10, url: 'https://example.test/pr/10' }),
    ...overrides,
  };
}

describe('GitHubAdapter', () => {
  it('returns the exact PR head and last 200 lines for each failed step', async () => {
    const adapter = new GitHubAdapter(api(), { owner: 'owner', repo: 'repo', runId: '77' });

    const run = await adapter.getFailingRun('77');

    expect(run).toMatchObject({ runId: '77', repo: 'owner/repo', prNumber: 9, headSha: SHA, headRef: 'feature' });
    expect(run.failedSteps).toHaveLength(1);
    expect(run.failedSteps[0]?.log.split('\n')).toHaveLength(200);
    expect(run.failedSteps[0]?.log).not.toContain('install');
    expect(run.failedSteps[0]?.log).toContain('test-204');
  });

  it('keeps the full completion second and trims a shared-second prior step', async () => {
    const adapter = new GitHubAdapter(api({
      listJobsForWorkflowRun: async () => [{
        id: 5,
        name: 'checks',
        conclusion: 'failure',
        steps: [{
          name: 'Run pnpm run test',
          conclusion: 'failure',
          startedAt: '2026-01-01T00:00:11Z',
          completedAt: '2026-01-01T00:00:20Z',
        }],
      }],
      downloadJobLogs: async () => [
        '2026-01-01T00:00:11.001Z eslint prior-step noise',
        '2026-01-01T00:00:11.100Z ##[group]Run pnpm run test',
        '2026-01-01T00:00:20.999Z src/value.ts:1 expected 2 to be 3',
        '2026-01-01T00:00:21.000Z post-step noise',
      ].join('\n'),
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    const run = await adapter.getFailingRun('77');

    expect(run.failedSteps[0]?.log).toContain('src/value.ts:1');
    expect(run.failedSteps[0]?.log).not.toContain('eslint prior-step noise');
    expect(run.failedSteps[0]?.log).not.toContain('post-step noise');
  });

  it('uses the commit-associated PR fallback and rejects fork PRs', async () => {
    const fallback = api({
      getWorkflowRun: async () => ({ id: 77, headSha: SHA, repository: 'owner/repo', event: 'pull_request', conclusion: 'failure', pullRequests: [] }),
      listPullRequestsForCommit: async () => [{ number: 12 }],
      getPullRequest: async () => ({ number: 12, headSha: SHA, headRef: 'fork-feature', headRepo: 'fork/repo' }),
    });
    const adapter = new GitHubAdapter(fallback, { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.getFailingRun('77')).rejects.toThrowError(/fork pull requests/i);
  });

  it('allows an explicit workflow dispatch through the exact-SHA PR fallback', async () => {
    let fallbackSha = '';
    const dispatched = api({
      getWorkflowRun: async () => ({
        id: 77,
        headSha: SHA,
        repository: 'owner/repo',
        event: 'workflow_dispatch',
        conclusion: 'failure',
        pullRequests: [],
      }),
      listPullRequestsForCommit: async (sha) => {
        fallbackSha = sha;
        return [{ number: 12 }];
      },
      getPullRequest: async () => ({
        number: 12,
        headSha: SHA,
        headRef: 'demo/break-me',
        headRepo: 'owner/repo',
      }),
    });
    const adapter = new GitHubAdapter(dispatched, {
      owner: 'owner',
      repo: 'repo',
      runId: '77',
    });

    await expect(adapter.getFailingRun('77')).resolves.toMatchObject({
      prNumber: 12,
      headSha: SHA,
      headRef: 'demo/break-me',
    });
    expect(fallbackSha).toBe(SHA);
    await expect(adapter.claimAttempt(12, '<!-- marker -->')).resolves.toEqual({
      kind: 'pull-request',
      commentId: 44,
    });
  });

  it.each(['push', 'schedule', 'workflow_dispatch'])('repairs a failed %s run from its exact branch', async (event) => {
    const calls: string[] = [];
    const direct = api({
      getWorkflowRun: async () => ({
        id: 77,
        headSha: SHA,
        repository: 'owner/repo',
        event,
        conclusion: 'failure',
        headBranch: 'develop',
        pullRequests: [],
      }),
      listCommitComments: async () => {
        calls.push('commit-comments');
        return [];
      },
      createRef: async (ref) => { calls.push(`ref:${ref}`); },
      createCommitComment: async (_sha, body) => {
        calls.push(`commit-comment:${body}`);
        return { id: 44 };
      },
      deleteRef: async (ref) => { calls.push(`delete:${ref}`); },
      updateCommitComment: async (id, body) => { calls.push(`update:${id}:${body}`); },
    });
    const adapter = new GitHubAdapter(direct, {
      owner: 'owner',
      repo: 'repo',
      runId: '77',
    });

    await expect(adapter.getFailingRun('77')).resolves.toMatchObject({
      runId: '77',
      repo: 'owner/repo',
      headSha: SHA,
      headRef: 'develop',
    });
    await expect(adapter.claimAttempt(undefined, '<!-- marker -->')).resolves.toEqual({
      kind: 'commit',
      commentId: 44,
    });
    await expect(adapter.updateAttempt(
      { kind: 'commit', commentId: 44 },
      'report',
    )).resolves.toBeUndefined();
    expect(calls).toEqual([
      'commit-comments',
      'ref:refs/tags/sutura-attempt-77',
      'commit-comment:<!-- marker -->\nSutura claimed this failed run and is starting analysis.',
      'delete:tags/sutura-attempt-77',
      'update:44:report',
    ]);
  });

  it('fails closed when a direct run has no valid head branch', async () => {
    const direct = api({
      getWorkflowRun: async () => ({
        id: 77,
        headSha: SHA,
        repository: 'owner/repo',
        event: 'push',
        conclusion: 'failure',
        headBranch: null,
        pullRequests: [],
      }),
    });
    const adapter = new GitHubAdapter(direct, {
      owner: 'owner',
      repo: 'repo',
      runId: '77',
    });

    await expect(adapter.getFailingRun('77')).rejects.toThrowError(/head branch/i);
  });

  it('fails closed when a direct run branch advances beyond the failing SHA', async () => {
    const direct = api({
      getWorkflowRun: async () => ({
        id: 77,
        headSha: SHA,
        repository: 'owner/repo',
        event: 'push',
        conclusion: 'failure',
        headBranch: 'develop',
        pullRequests: [],
      }),
      getRefSha: async () => 'b'.repeat(40),
    });
    const adapter = new GitHubAdapter(direct, {
      owner: 'owner',
      repo: 'repo',
      runId: '77',
    });

    await expect(adapter.getFailingRun('77')).rejects.toThrowError(/no longer matches/i);
  });

  it('claims once with an atomic ref before creating the marker comment', async () => {
    const calls: string[] = [];
    const adapter = new GitHubAdapter(api({
      createRef: async (ref) => { calls.push(`ref:${ref}`); },
      createIssueComment: async (_issue, body) => { calls.push(`comment:${body}`); return { id: 44 }; },
      deleteRef: async (ref) => { calls.push(`delete:${ref}`); },
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.claimAttempt(9, '<!-- marker -->')).resolves.toEqual({
      kind: 'pull-request',
      commentId: 44,
    });
    expect(calls).toEqual([
      'ref:refs/tags/sutura-attempt-77',
      'comment:<!-- marker -->\nSutura claimed this failed run and is starting analysis.',
      'delete:tags/sutura-attempt-77',
    ]);
  });

  it('retains the atomic ref if marker comment creation fails', async () => {
    let deleted = false;
    const adapter = new GitHubAdapter(api({
      createIssueComment: async () => { throw new Error('comment failed'); },
      deleteRef: async () => { deleted = true; },
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.claimAttempt(9, '<!-- marker -->')).rejects.toThrow(/comment failed/);
    expect(deleted).toBe(false);
  });

  it('returns null when the atomic claim already exists', async () => {
    const duplicate = Object.assign(new Error('Reference already exists'), { status: 422 });
    const adapter = new GitHubAdapter(api({ createRef: async () => { throw duplicate; } }), { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.claimAttempt(9, '<!-- marker -->')).resolves.toBeNull();
  });

  it('ignores an untrusted comment that spoofs the idempotency marker', async () => {
    let claimed = false;
    const adapter = new GitHubAdapter(api({
      listIssueComments: async () => [{ id: 1, body: '<!-- marker -->', authorLogin: 'attacker' }],
      createRef: async () => { claimed = true; },
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.claimAttempt(9, '<!-- marker -->')).resolves.toEqual({
      kind: 'pull-request',
      commentId: 44,
    });
    expect(claimed).toBe(true);
  });

  it('fails closed on an ambiguous associated-PR fallback', async () => {
    const adapter = new GitHubAdapter(api({
      getWorkflowRun: async () => ({ id: 77, headSha: SHA, repository: 'owner/repo', event: 'pull_request', conclusion: 'failure', pullRequests: [] }),
      listPullRequestsForCommit: async () => [{ number: 1 }, { number: 2 }],
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.getFailingRun('77')).rejects.toThrowError(GitHubAdapterError);
  });

  it('links uploaded artifacts to the current Sutura action run', async () => {
    const artifact = { uploadArtifact: async () => ({ id: 321 }) };
    const adapter = new GitHubAdapter(api(), {
      owner: 'owner',
      repo: 'repo',
      runId: '77',
      actionRunId: '88',
      artifact,
    });

    await expect(adapter.uploadCaseFile('case.html', '<html></html>')).resolves.toEqual({
      url: 'https://github.com/owner/repo/actions/runs/88/artifacts/321',
    });
  });
});
