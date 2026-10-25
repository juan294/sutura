import { describe, expect, it, vi } from 'vitest';

import { capturedJobLog } from './__fixtures__/captured/test-helper.js';
import { createGitHubApi } from './octokit.js';

function apiReturning(data: unknown) {
  const downloadJobLogsForWorkflowRun = vi.fn().mockResolvedValue({ data });
  const octokit = {
    rest: { actions: { downloadJobLogsForWorkflowRun } },
  };
  return {
    api: createGitHubApi(octokit as never, 'juan294', 'sutura'),
    downloadJobLogsForWorkflowRun,
  };
}

describe('createGitHubApi job logs', () => {
  it('retains native job and step identifiers', async () => {
    const octokit = {
      paginate: vi.fn().mockResolvedValue([{ id: 81, name: 'checks', conclusion: 'failure',
        steps: [{ number: 7, name: 'Run tests', conclusion: 'failure' }] }]),
      rest: { actions: { listJobsForWorkflowRun: vi.fn() } },
    };
    const api = createGitHubApi(octokit as never, 'acme', 'widget');
    await expect(api.listJobsForWorkflowRun(42)).resolves.toMatchObject([
      { id: 81, steps: [{ number: 7, name: 'Run tests' }] },
    ]);
  });
  const captured = capturedJobLog('33239848825');
  const bytes = Buffer.from(captured, 'utf8');

  it.each([
    ['string', captured],
    ['ArrayBuffer', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)],
    ['Uint8Array', new Uint8Array(bytes)],
  ])('decodes captured B4 logs returned as %s', async (_shape, data) => {
    const { api, downloadJobLogsForWorkflowRun } = apiReturning(data);

    await expect(api.downloadJobLogs(42)).resolves.toBe(captured);
    expect(downloadJobLogsForWorkflowRun).toHaveBeenCalledWith({
      owner: 'juan294',
      repo: 'sutura',
      job_id: 42,
    });
  });

  it('rejects an unsupported captured-log response shape', async () => {
    const { api } = apiReturning({ captured });

    await expect(api.downloadJobLogs(42)).rejects.toThrow(
      'GitHub returned job logs in an unsupported format',
    );
  });
});

it('captures authenticated source attempt metadata before normalizing the legacy run port', async () => {
  const observed = vi.fn();
  const data = { id: 42, run_attempt: 3, workflow_id: 5, head_sha: 'a'.repeat(40), head_branch: 'develop', event: 'push', conclusion: 'failure', repository: { id: 7, full_name: 'acme/widget' }, pull_requests: [] };
  const octokit = { rest: { actions: { getWorkflowRun: vi.fn(async () => ({ data })) } } };
  const api = createGitHubApi(octokit as never, 'acme', 'widget', { onSourceRun: observed });
  await api.getWorkflowRun(42);
  expect(observed).toHaveBeenCalledWith({ repositoryId: 7, repository: 'acme/widget', runId: 42, attempt: 3, workflowId: 5, sha: 'a'.repeat(40), branch: 'develop' });
});
