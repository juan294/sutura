import { describe, expect, it, vi } from 'vitest';

import { CliAdapter, SuturaAdapter } from './adapters.js';

const VALID_CASE_FILE = JSON.stringify({
  runId: 'run-1', repo: 'placebo/case',
  diagnosis: {
    class: 'dep-upstream-breaking', confidence: 0.9, signals: [], failingCmd: 'pnpm test', errorExcerpt: 'ERR_MODULE_NOT_FOUND',
    grounding: { query: 'chalk 5 esm', skipped: false, citations: [{ title: 'Chalk 5', url: 'https://github.com/chalk/chalk/releases/tag/v5.0.0', snippet: 'ESM only' }] },
  },
  triage: { status: 'real', reproduced: 5, of: 5 }, race: [],
  audit: { approved: true, checks: [], reasoning: 'approved' }, outcome: 'fixed', cost: { entries: [] },
});

describe('CLI adapters', () => {
  it('passes --no-tavily to Sutura without a shell', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: VALID_CASE_FILE, stderr: '', exitCode: 0 });
    const adapter = new SuturaAdapter({ tavilyEnabled: false, execute });
    await expect(adapter.heal('/tmp/example')).resolves.toMatchObject({ outcome: 'fixed' });
    expect(execute).toHaveBeenCalledWith('sutura', [
      'heal', '--case-dir', '/tmp/example', '--format', 'json', '--no-tavily',
    ], expect.any(Object));
  });

  it('passes a placebo candidate to Sutura as a distinct audit input', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: VALID_CASE_FILE, stderr: '', exitCode: 0 });
    const adapter = new SuturaAdapter({ execute });
    const candidateDiff = "diff --git a/test.js b/test.js\n-test('fails')\n+test.skip('fails')\n";

    await adapter.heal('/tmp/example', { candidateDiff });

    expect(execute).toHaveBeenCalledWith('sutura', [
      'heal', '--case-dir', '/tmp/example', '--format', 'json', '--candidate-diff', candidateDiff,
    ], expect.any(Object));
  });

  it('passes a placebo candidate to a generic CLI adapter too', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: VALID_CASE_FILE, stderr: '', exitCode: 0 });
    const candidateDiff = 'diff --git a/test.js b/test.js\n';

    await new CliAdapter({ command: 'repair-agent', execute }).heal('/tmp/example', { candidateDiff });

    expect(execute).toHaveBeenCalledWith('repair-agent', [
      '--case-dir', '/tmp/example', '--candidate-diff', candidateDiff,
    ], expect.any(Object));
  });

  it('accepts gave-up and rejects invented adapter fields', async () => {
    const gaveUpValue: Record<string, unknown> = { ...JSON.parse(VALID_CASE_FILE) as Record<string, unknown>, outcome: 'gave-up' };
    delete gaveUpValue.audit;
    const execute = vi.fn().mockResolvedValue({ stdout: JSON.stringify(gaveUpValue), stderr: '', exitCode: 0 });
    await expect(new CliAdapter({ command: 'agent', execute }).heal('/tmp/case')).resolves.toMatchObject({ outcome: 'gave-up' });

    execute.mockResolvedValueOnce({ stdout: '{"outcome":"fixed","grounded":true}', stderr: '', exitCode: 0 });
    await expect(new CliAdapter({ command: 'agent', execute }).heal('/tmp/case')).resolves.toMatchObject({ outcome: 'gave-up', diagnosis: { class: 'infra' } });
  });

  it('turns ENOENT, timeout, and oversized output into gave-up case files', async () => {
    await expect(new CliAdapter({ command: '/definitely/missing/placebo-agent' }).heal('/tmp/case')).resolves.toMatchObject({ outcome: 'gave-up' });
    await expect(new CliAdapter({ command: process.execPath, args: ['-e', 'setTimeout(() => {}, 10_000)', '--'], timeoutMs: 20 }).heal('/tmp/case')).resolves.toMatchObject({ outcome: 'gave-up', diagnosis: { errorExcerpt: expect.stringContaining('timed out') } });
    await expect(new CliAdapter({ command: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(10000))', '--'], maxOutputBytes: 100 }).heal('/tmp/case')).resolves.toMatchObject({ outcome: 'gave-up', diagnosis: { errorExcerpt: expect.stringContaining('output limit') } });
  });
});
