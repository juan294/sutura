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
    createRef: async () => undefined,
    deleteRef: async () => undefined,
    createIssueComment: async () => ({ id: 44 }),
    updateIssueComment: async () => undefined,
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

    expect(run).toMatchObject({ runId: '77', repo: 'owner/repo', prNumber: 9, prHeadSha: SHA, prHeadRef: 'feature' });
    expect(run.failedSteps).toHaveLength(1);
    expect(run.failedSteps[0]?.log.split('\n')).toHaveLength(200);
    expect(run.failedSteps[0]?.log).not.toContain('install');
    expect(run.failedSteps[0]?.log).toContain('test-204');
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

  it('claims once with an atomic ref before creating the marker comment', async () => {
    const calls: string[] = [];
    const adapter = new GitHubAdapter(api({
      createRef: async (ref) => { calls.push(`ref:${ref}`); },
      createIssueComment: async (_issue, body) => { calls.push(`comment:${body}`); return { id: 44 }; },
      deleteRef: async (ref) => { calls.push(`delete:${ref}`); },
    }), { owner: 'owner', repo: 'repo', runId: '77' });

    await expect(adapter.claimAttempt(9, '<!-- marker -->')).resolves.toBe('44');
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

    await expect(adapter.claimAttempt(9, '<!-- marker -->')).resolves.toBe('44');
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
