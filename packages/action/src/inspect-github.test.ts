import { describe, expect, it, vi } from 'vitest';
import { inspectionFetch } from './inspect-github.js';
describe('bounded inspection transport', () => {
  it('preserves read responses and adds a deterministic timeout signal', async () => {
    const fetcher = vi.fn(async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
    const response = await inspectionFetch(fetcher)('https://api.github.com/repos/owner/repo');
    expect(await response.json()).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it('cancels oversized response streams and refuses further unbounded reads', async () => {
    const cancel = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(4_194_305)); }, cancel })));
    await expect(inspectionFetch(fetcher)('https://api.github.com/log')).rejects.toThrow('byte limit');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('bounds total requests, including pagination', async () => {
    const fetcher = vi.fn(async () => new Response('{}')), fetch = inspectionFetch(fetcher);
    for (let count = 0; count < 80; count += 1) await fetch('https://api.github.com/page');
    await expect(fetch('https://api.github.com/page')).rejects.toThrow('request limit');
    expect(fetcher).toHaveBeenCalledTimes(80);
  });
});

const octokitClient = vi.fn();
vi.mock('@actions/github', () => ({ getOctokit: (...args: unknown[]) => octokitClient(...args) }));
import { inspectAction } from './inspect-github.js';
const SHA = 'a'.repeat(40);
function client(jobOverride: Record<string, unknown> = {}) {
  const files: Record<string, string> = { '.github/workflows/ci.yml': 'name: CI\non: [push]\njobs:\n  unit:\n    steps: [{ run: pnpm test }]\n',
    'package.json': '{"engines":{"node":">=22"},"scripts":{"test":"vitest run"}}', 'pnpm-lock.yaml': 'lockfileVersion: "9.0"\nimporters: { .: {} }\n' };
  const data = { id: 7, run_attempt: 1, head_sha: SHA, head_branch: 'main', repository: { id: 1, full_name: 'owner/repo' }, workflow_id: 9, path: '.github/workflows/ci.yml', event: 'push', conclusion: 'failure', pull_requests: [] };
  const getContent = vi.fn(async ({ path }: { path: string }) => ({ data: { type: 'file', encoding: 'base64', content: Buffer.from(files[path]!).toString('base64'), size: Buffer.byteLength(files[path]!) } }));
  return { rest: { actions: {
    getWorkflowRun: vi.fn(async () => ({ data })),
    listJobsForWorkflowRun: vi.fn(async () => ({ data: { total_count: 1, jobs: [{ id: 3, run_id: 7, run_attempt: 1, head_sha: SHA, name: 'unit', conclusion: 'failure',
      steps: [{ number: 2, name: 'Test', conclusion: 'failure', started_at: '2026-10-25T10:00:00Z', completed_at: '2026-10-25T10:00:10Z' }], ...jobOverride }] } })),
    downloadJobLogsForWorkflowRun: vi.fn(async () => ({ data: '2026-10-25T10:00:00Z ##[group]Run pnpm test\n2026-10-25T10:00:01Z FAIL src/value.test.ts > adds\n2026-10-25T10:00:02Z AssertionError: expected 1 to be 2' })),
  }, repos: { getContent, getCommit: vi.fn(async () => ({ data: { sha: SHA } })) }, git: {
    getRef: vi.fn(async () => ({ data: { object: { sha: SHA } } })),
    getTree: vi.fn(async () => ({ data: { truncated: false, tree: Object.entries(files).map(([path, value]) => ({ path, size: Buffer.byteLength(value), type: 'blob', mode: '100644' })) } })),
  } } };
}
const inputs = { mode: 'inspect' as const, runId: '7', githubToken: 'read-only', environment: {}, triageN: 0, requireFixed: false, captureReplay: false };
const context = { owner: 'owner', repo: 'repo', environment: { GITHUB_ACTION_REF: 'b'.repeat(40) } };
it('runs the actual inspection adapter with authenticated immutable metadata and no mutation methods', async () => {
  octokitClient.mockReturnValue(client());
  await expect(inspectAction(inputs, context)).resolves.toMatchObject({ repairEligible: true, executionAuthorized: false });
});
it.each([{ run_id: 8 }, { run_attempt: 2 }, { head_sha: 'c'.repeat(40) }])('rejects mismatched job scope before source inspection: %j', async override => {
  const api = client(override); octokitClient.mockReturnValue(api);
  await expect(inspectAction(inputs, context)).rejects.toThrow('job');
  expect(api.rest.repos.getContent).not.toHaveBeenCalled();
});
