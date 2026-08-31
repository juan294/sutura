import { describe, expect, it } from 'vitest';

import {
  capturedFailingRun,
  capturedRun,
} from '../__fixtures__/captured/captured-live-run.test-helper.js';
import { GitHubAdapter, GitHubAdapterError } from './adapter.js';
import type { GitHubApi, WorkflowJobRecord, WorkflowRunRecord } from './types.js';

const CAPTURED_RUN_ID = '33169026068';

function capturedApi(overrides: Partial<GitHubApi> = {}): GitHubApi {
  const captured = capturedRun('A1/B2', CAPTURED_RUN_ID);
  const workflowRun = structuredClone(captured.runMetadata.result) as WorkflowRunRecord;
  const jobs = structuredClone(captured.bundle.github.find(
    ({ method }) => method === 'listJobsForWorkflowRun',
  )?.result) as WorkflowJobRecord[];
  return {
    getWorkflowRun: async () => workflowRun,
    listPullRequestsForCommit: async () => [],
    getPullRequest: async (number) => ({
      number,
      headSha: workflowRun.headSha,
      headRef: 'feature/captured',
      headRepo: workflowRun.repository,
      baseSha: workflowRun.headSha,
      baseRef: 'develop',
    }),
    listJobsForWorkflowRun: async () => jobs,
    downloadJobLogs: async () => captured.jobLogText,
    listIssueComments: async () => [],
    listCommitComments: async () => [],
    createRef: async () => undefined,
    deleteRef: async () => undefined,
    createIssueComment: async () => ({ id: 44 }),
    createCommitComment: async () => ({ id: 44 }),
    updateIssueComment: async () => undefined,
    updateCommitComment: async () => undefined,
    getRefSha: async () => workflowRun.headSha,
    getCommitParents: async () => [workflowRun.headSha],
    getCommitSha: async (sha) => sha,
    createPullRequest: async () => ({ number: 10, url: 'https://example.test/pull/10' }),
    listCheckRunsForRef: async () => [],
    createCheckRun: async () => ({ id: 55 }),
    updateCheckRun: async () => undefined,
    ...overrides,
  };
}

function adapter(api: GitHubApi = capturedApi()): GitHubAdapter {
  return new GitHubAdapter(api, {
    owner: 'juan294',
    repo: 'sutura',
    runId: CAPTURED_RUN_ID,
  });
}

function preFixRunEventGuard(event: string): void {
  if (!new Set(['pull_request', 'workflow_dispatch']).has(event)) {
    throw new GitHubAdapterError('Workflow run metadata does not match the action event');
  }
}

describe('captured GitHub adapter regressions', () => {
  it('replays A1 push metadata as a direct run while the pre-fix guard rejects it', async () => {
    const captured = await capturedFailingRun('A1', '33169026068');
    const metadata = captured.runMetadata.result as { event: string };

    expect(() => preFixRunEventGuard(metadata.event)).toThrow(
      'Workflow run metadata does not match the action event',
    );
    expect(metadata.event).toBe('push');
    expect(captured.run).toMatchObject({
      runId: '33169026068',
      repo: 'juan294/sutura',
      headRef: 'develop',
      baseRef: 'develop',
    });
    expect(captured.run.prNumber).toBeUndefined();
  });

  it('replays A3 with the current command retention and reproduces pre-fix slicing', async () => {
    const captured = await capturedFailingRun('A3', '33239848825');
    const currentLog = captured.run.failedSteps.map(({ log }) => log).join('\n');
    const preFixLog = currentLog.split(/\r?\n/u).slice(1).join('\n');

    expect(currentLog).toContain('##[group]Run pnpm run test');
    expect(currentLog).toContain('Hook timed out in 10000ms');
    expect(preFixLog).not.toContain('##[group]Run pnpm run test');
    expect(preFixLog).toContain('Hook timed out in 10000ms');
  });

  it.each(['', '0', '../1'])('rejects invalid workflow run id %j', (runId) => {
    expect(() => new GitHubAdapter(capturedApi(), {
      owner: 'juan294', repo: 'sutura', runId,
    })).toThrow('Workflow run id is invalid');
  });

  it('rejects an unsafe integer workflow run id', () => {
    expect(() => new GitHubAdapter(capturedApi(), {
      owner: 'juan294', repo: 'sutura', runId: '9007199254740992',
    })).toThrow('Workflow run id is invalid');
  });

  it('rejects an invalid repository identifier', () => {
    expect(() => new GitHubAdapter(capturedApi(), {
      owner: '../juan294', repo: 'sutura', runId: CAPTURED_RUN_ID,
    })).toThrow('GitHub repository identifier is invalid');
  });

  it('rejects a requested run that differs from the captured Action event', async () => {
    await expect(adapter().getFailingRun('1')).rejects.toThrow(
      'Requested workflow run differs from the action event',
    );
  });

  it('rejects captured workflow metadata that changes identity', async () => {
    const api = capturedApi();
    const recorded = await api.getWorkflowRun(Number(CAPTURED_RUN_ID));
    api.getWorkflowRun = async () => ({ ...recorded, repository: 'attacker/fork' });

    await expect(adapter(api).getFailingRun(CAPTURED_RUN_ID)).rejects.toThrow(
      'Workflow run metadata does not match the action event',
    );
  });

  it.each([
    ['no timestamp bounds', null, '2026-01-01T00:00:02Z', 'has no timestamp bounds'],
    ['invalid timestamp bounds', 'bad', '2026-01-01T00:00:02Z', 'has invalid timestamp bounds'],
    ['reversed timestamp bounds', '2026-01-01T00:00:03Z', '2026-01-01T00:00:02Z', 'has invalid timestamp bounds'],
  ])('rejects failed-step logs with %s', async (_case, startedAt, completedAt, message) => {
    const api = capturedApi({
      listJobsForWorkflowRun: async () => [{
        id: 5,
        name: 'captured checks',
        conclusion: 'failure',
        steps: [{ name: 'Run tests', conclusion: 'failure', startedAt, completedAt }],
      }],
    });

    await expect(adapter(api).getFailingRun(CAPTURED_RUN_ID)).rejects.toThrow(message);
  });

  it('rejects a failed step with no timestamped log lines in its bounds', async () => {
    const api = capturedApi({
      listJobsForWorkflowRun: async () => [{
        id: 5,
        name: 'captured checks',
        conclusion: 'failure',
        steps: [{
          name: 'Run tests',
          conclusion: 'failure',
          startedAt: '2026-01-01T00:00:01Z',
          completedAt: '2026-01-01T00:00:02Z',
        }],
      }],
    });

    await expect(adapter(api).getFailingRun(CAPTURED_RUN_ID)).rejects.toThrow(
      'Job logs contain no lines for failed step Run tests',
    );
  });

  it('rejects a captured run with no failed-step logs', async () => {
    const api = capturedApi({ listJobsForWorkflowRun: async () => [] });

    await expect(adapter(api).getFailingRun(CAPTURED_RUN_ID)).rejects.toThrow(
      'Workflow run has no failed-step logs',
    );
  });

  it.each([
    ['ambiguous PRs', async () => [{ number: 9 }, { number: 10 }], undefined, 'Could not resolve one pull request'],
    ['different PR number', async () => [{ number: 9 }], { number: 10 }, 'GitHub returned a different pull request'],
    ['changed PR head', async () => [{ number: 9 }], { headSha: 'b'.repeat(40) }, 'Pull request head no longer matches'],
    ['fork PR', async () => [{ number: 9 }], { headRepo: 'attacker/fork' }, 'fork pull requests'],
    ['invalid PR branch', async () => [{ number: 9 }], { headRef: '../unsafe' }, 'head branch is invalid'],
    ['invalid PR base', async () => [{ number: 9 }], { baseSha: 'bad' }, 'base commit is invalid'],
  ] as const)('rejects captured pull-request metadata with %s', async (
    _case,
    listPullRequestsForCommit,
    pullOverride,
    message,
  ) => {
    const base = capturedApi();
    const recorded = await base.getWorkflowRun(Number(CAPTURED_RUN_ID));
    const api = capturedApi({
      getWorkflowRun: async () => ({ ...recorded, event: 'pull_request', pullRequests: [] }),
      listPullRequestsForCommit,
      getPullRequest: async (number) => ({
        number,
        headSha: recorded.headSha,
        headRef: 'feature/captured',
        headRepo: recorded.repository,
        baseSha: recorded.headSha,
        baseRef: 'develop',
        ...pullOverride,
      }),
    });

    await expect(adapter(api).getFailingRun(CAPTURED_RUN_ID)).rejects.toThrow(message);
  });

  it('rejects an invalid direct-run branch', async () => {
    const base = capturedApi();
    const recorded = await base.getWorkflowRun(Number(CAPTURED_RUN_ID));
    base.getWorkflowRun = async () => ({ ...recorded, headBranch: '../unsafe' });

    await expect(adapter(base).getFailingRun(CAPTURED_RUN_ID)).rejects.toThrow(
      'Workflow run head branch is invalid',
    );
  });

  it('rejects a direct branch that moved after the captured run', async () => {
    const api = capturedApi({ getRefSha: async () => 'b'.repeat(40) });

    await expect(adapter(api).getFailingRun(CAPTURED_RUN_ID)).rejects.toThrow(
      'Workflow run head branch no longer matches the failing SHA',
    );
  });

  it('rejects multiple matching Sutura checks', async () => {
    const recorded = await capturedApi().getWorkflowRun(Number(CAPTURED_RUN_ID));
    const matching = {
      id: 55,
      headSha: recorded.headSha,
      externalId: `sutura:juan294/sutura:workflow-run:${CAPTURED_RUN_ID}`,
      name: 'Sutura repair audit',
      status: 'in_progress',
      conclusion: null,
    };
    const api = capturedApi({ listCheckRunsForRef: async () => [matching, { ...matching, id: 56 }] });

    await expect(adapter(api).claimAttempt(undefined, '<!-- marker -->')).rejects.toThrow(
      'Multiple Sutura checks match this workflow run',
    );
  });

  it('rejects workflow metadata that changes before the atomic claim', async () => {
    const api = capturedApi();
    const recorded = await api.getWorkflowRun(Number(CAPTURED_RUN_ID));
    api.getWorkflowRun = async () => ({ ...recorded, conclusion: 'success' });

    await expect(adapter(api).claimAttempt(undefined, '<!-- marker -->')).rejects.toThrow(
      'Workflow run metadata changed before claim',
    );
  });

  it('wraps a non-422 atomic-claim failure', async () => {
    const api = capturedApi({ createRef: async () => { throw new Error('forbidden'); } });

    await expect(adapter(api).claimAttempt(undefined, '<!-- marker -->')).rejects.toThrow(
      'Could not claim the workflow run atomically',
    );
  });

  it('rejects an invalid created check id', async () => {
    const api = capturedApi({ createCheckRun: async () => ({ id: 0 }) });

    await expect(adapter(api).claimAttempt(undefined, '<!-- marker -->')).rejects.toThrow(
      'GitHub returned an invalid check-run id',
    );
  });

  it('rejects a completion target that differs from the atomic claim', async () => {
    const value = adapter();
    const target = await value.claimAttempt(undefined, '<!-- marker -->');
    expect(target).not.toBeNull();

    await expect(value.completeCheck(
      { ...target!, checkRunId: 999 },
      {} as never,
    )).rejects.toThrow('Check target differs from the atomic attempt claim');
  });

  it.each([
    ['invalid fix branch', { branch: '../unsafe' }, 'Fix or base branch is invalid'],
    ['invalid base branch', { baseRef: '../unsafe' }, 'Fix or base branch is invalid'],
    ['invalid base SHA', { headSha: 'bad' }, 'Fix base SHA is invalid'],
  ])('rejects %s before creating a pull request', async (_case, override, message) => {
    await expect(adapter().createFixPullRequest({
      branch: `sutura/fix-${CAPTURED_RUN_ID}`,
      baseRef: 'develop',
      body: 'captured repair',
      headSha: 'a'.repeat(40),
      title: 'fix: captured',
      ...override,
    })).rejects.toThrow(message);
  });

  it('rejects a fix branch that is not based on the captured failing SHA', async () => {
    const api = capturedApi({ getCommitParents: async () => ['b'.repeat(40)] });

    await expect(adapter(api).createFixPullRequest({
      branch: `sutura/fix-${CAPTURED_RUN_ID}`,
      baseRef: 'develop',
      body: 'captured repair',
      headSha: 'a'.repeat(40),
      title: 'fix: captured',
    })).rejects.toThrow('Fix branch is not based on the exact failing SHA');
  });

  it('requires an artifact port', () => {
    expect(() => adapter().uploadCaseFile('case.html', '<html></html>')).toThrow(
      'Artifact client is unavailable',
    );
  });

  it.each(['../case.html', 'case.json'])('rejects invalid case-file artifact name %j', (name) => {
    const value = new GitHubAdapter(capturedApi(), {
      owner: 'juan294', repo: 'sutura', runId: CAPTURED_RUN_ID,
      artifact: { uploadTextArtifact: async () => ({ url: 'https://example.test/artifact' }) },
    });

    expect(() => value.uploadCaseFile(name, '<html></html>')).toThrow(
      'Artifact name is invalid',
    );
  });
});
