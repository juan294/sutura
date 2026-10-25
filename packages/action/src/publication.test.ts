import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ActionTextArtifactPort } from './github.js';
import { describe, expect, it, vi } from 'vitest';
import { buildPublicationReceipt, type AuthenticatedSourceRun } from './publication.js';
const SHA = 'a'.repeat(40), HEAD = 'b'.repeat(40), ACTION = 'c'.repeat(40), BLOB = createHash('sha1').update('blob 13\0name: Sutura\n').digest('hex');
const source: AuthenticatedSourceRun = { repositoryId: 1, repository: 'owner/repo', runId: 7, attempt: 2, workflowId: 9, sha: SHA, branch: 'develop' };
const files = [{ filename: 'src/value.ts', status: 'modified', patch: '@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;' }];
function api(change: Record<string, unknown> = {}) {
  const run = { id: 8, run_attempt: 3, workflow_id: 11, repository: { id: 1, full_name: 'owner/repo' }, head_repository: { id: 1 }, head_sha: SHA, path: '.github/workflows/sutura.yml' };
  return { rest: { actions: { getWorkflowRunAttempt: vi.fn(async ({ run_id }: { run_id: number }) => ({ data: run_id === 8 ? { ...run, ...change } : { id: 7, run_attempt: 2, workflow_id: 9, repository: { id: 1 }, head_repository: { id: 1 }, head_sha: SHA, head_branch: 'develop' } })) },
    repos: { getContent: vi.fn(async () => ({ data: { type: 'file', encoding: 'base64', content: Buffer.from('name: Sutura\n').toString('base64'), size: 13, sha: BLOB } })),
      getCommit: vi.fn(async () => ({ data: { sha: HEAD, parents: [{ sha: SHA }] } })) },
    pulls: { get: vi.fn(async () => ({ data: { number: 12, head: { sha: HEAD, ref: 'sutura/fix-7', repo: { id: 1 } }, base: { ref: 'develop', repo: { id: 1 } }, changed_files: 1 } })), listFiles: vi.fn(async () => ({ data: files })) },
  } };
}
describe('authenticated publication receipt producer', () => {
  it('binds exact source and producing attempts, immutable workflow blob and current complete PR diff', async () => {
    const client = api();
    const result = await buildPublicationReceipt({ octokit: client as never, source, monitorRunId: 8, monitorAttempt: 3, actionSha: ACTION, prNumber: 12 });
    expect(result).toMatchObject({ schemaVersion: 'sutura-publication-receipt-v1', complete: true, repositoryId: 1, runId: 8, attempt: 3, workflowId: 11, workflowBlobSha: BLOB, actionSha: ACTION, outcome: 'fixed',
      source: { runId: 7, attempt: 2, sha: SHA, workflowId: 9, branch: 'develop' }, publication: { prNumber: 12, headSha: HEAD, diffDigest: createHash('sha256').update(JSON.stringify(files)).digest('hex') } });
    expect(client.rest.actions.getWorkflowRunAttempt).toHaveBeenCalledWith(expect.objectContaining({ run_id: 7, attempt_number: 2 }));
  });
  it.each([{ run_attempt: 4 }, { repository: { id: 2 } }, { path: '../private' }])('rejects producer identity mismatch %j', async change => {
    await expect(buildPublicationReceipt({ octokit: api(change) as never, source, monitorRunId: 8, monitorAttempt: 3, actionSha: ACTION, prNumber: 12 })).rejects.toThrow();
  });
  it('refuses a moved repair head parent or truncated PR file inventory', async () => {
    const moved = api(); moved.rest.repos.getCommit.mockResolvedValue({ data: { sha: HEAD, parents: [{ sha: ACTION }] } });
    await expect(buildPublicationReceipt({ octokit: moved as never, source, monitorRunId: 8, monitorAttempt: 3, actionSha: ACTION, prNumber: 12 })).rejects.toThrow('parent');
    const partial = api(); partial.rest.pulls.listFiles.mockResolvedValue({ data: [] });
    await expect(buildPublicationReceipt({ octokit: partial as never, source, monitorRunId: 8, monitorAttempt: 3, actionSha: ACTION, prNumber: 12 })).rejects.toThrow('diff');
  });
});

it('uploads one bounded JSON file under the exact publication artifact name', async () => {
  const uploadArtifact = vi.fn(async (name: string, paths: string[]) => {
    expect(name).toBe('sutura-publication-v1-8-3');
    expect(paths).toHaveLength(1);
    expect(basename(paths[0]!)).toBe('sutura-publication-v1-8-3.json');
    expect(JSON.parse(await readFile(paths[0]!, 'utf8'))).toMatchObject({ complete: true });
    return { id: 50 };
  });
  await expect(new ActionTextArtifactPort('owner/repo', '8', { uploadArtifact }).uploadTextArtifact('sutura-publication-v1-8-3', '{"complete":true}', 'json')).resolves.toEqual({ url: 'https://github.com/owner/repo/actions/runs/8/artifacts/50' });
});
