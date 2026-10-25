import { describe, expect, it } from 'vitest';
import { diagnoseRun } from './diagnose.js';
import type { CommandRunner } from './command.js';
import { parseArgs } from './args.js';
const sha = 'a'.repeat(40);
const runData = { id: 7, run_attempt: 2, head_sha: sha, repository: { full_name: 'example/project' }, conclusion: 'failure' };
const job = { id: 9, run_id: 7, run_attempt: 2, head_sha: sha, name: 'tests', conclusion: 'failure', steps: [{ number: 3, name: 'Run pnpm test', conclusion: 'failure', started_at: '2026-10-25T10:00:00Z', completed_at: '2026-10-25T10:00:03Z' }] };
const request = { command: 'diagnose' as const, repository: 'example/project', runId: 7, json: true };
function adapter(jobs = [job], source = runData): CommandRunner {
  return async (command, args, options) => {
    expect(command).toBe('gh'); expect(args[0]).toBe('api');
    expect(options?.timeoutMs).toBe(10_000); expect(options?.maxOutputBytes).toBe(2 * 1024 * 1024);
    if (args[1]?.endsWith('/logs')) return '2026-10-25T10:00:01Z ##[group]Run pnpm test\n2026-10-25T10:00:02Z FAIL test/a.test.ts > addition\n2026-10-25T10:00:02Z AssertionError: expected 1 to equal 2\n2026-10-25T10:00:02Z ##[error]Process completed with exit code 1.\n2026-10-25T10:00:05Z SECRET_UNRELATED';
    if (args[1]?.includes('/jobs')) return JSON.stringify({ total_count: jobs.length, jobs });
    return JSON.stringify(source);
  };
}
describe('selected run read-only diagnosis', () => {
  it('parses explicit repository and run scope', () => {
    expect(parseArgs(['diagnose', '--repo', 'example/project', '--run-id', '7', '--json'])).toEqual(request);
  });
  it('binds the selected step without returning unrelated or raw log content', async () => {
    const result = await diagnoseRun(request, adapter());
    expect(result.source.sourceSha).toBe(sha);
    expect(result.selectedStep?.stepNumber).toBe(3);
    expect(result.evidenceStage).toBe('diagnosed');
    expect(result.reproduction).toBe('unmeasured');
    expect(JSON.stringify(result)).not.toContain('SECRET_UNRELATED');
  });
  it('keeps ambiguous failures unknown and rejects wrong source identity', async () => {
    expect((await diagnoseRun(request, adapter([job, { ...job, id: 10 }]))).reason).toBe('selected-step-ambiguous');
    await expect(diagnoseRun(request, adapter([job], { ...runData, id: 8 }))).rejects.toThrow('identity');
  });
});
