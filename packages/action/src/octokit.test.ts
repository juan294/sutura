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
