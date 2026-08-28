import { describe, expect, it, vi } from 'vitest';

import type { CaseFile } from '@sutura/core';

import { runCli } from './cli.js';

function fixed(): CaseFile {
  return {
    runId: 'case-1',
    repo: 'placebo/case',
    diagnosis: {
      class: 'test-assertion', confidence: 1, signals: [],
      failingCmd: 'pnpm test', errorExcerpt: 'failed',
    },
    triage: { status: 'real', reproduced: 5, of: 5 },
    race: [],
    audit: { approved: true, checks: [], reasoning: 'approved' },
    outcome: 'fixed',
    cost: { entries: [], totalUsd: () => 0 },
  };
}

describe('runCli', () => {
  it('prints only valid CaseFile JSON on stdout', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const heal = vi.fn().mockResolvedValue(fixed());

    const exitCode = await runCli(
      ['heal', '--case-dir', '/tmp/case', '--format', 'json', '--no-tavily'],
      { write: (value) => stdout.push(value), writeError: (value) => stderr.push(value) },
      { heal },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toMatchObject({ outcome: 'fixed', cost: { entries: [] } });
    expect(heal).toHaveBeenCalledWith(expect.objectContaining({ caseDir: '/tmp/case', tavilyEnabled: false }));
  });

  it('returns usage errors on stderr without starting a heal', async () => {
    const stderr: string[] = [];
    const heal = vi.fn();
    const exitCode = await runCli(['heal', '--case-dir', '/tmp/case'], {
      writeError: (value) => stderr.push(value),
    }, { heal });

    expect(exitCode).toBe(2);
    expect(stderr.join('')).toContain('sutura heal --case-dir');
    expect(heal).not.toHaveBeenCalled();
  });

  it('fails closed as infra-stop JSON when runtime configuration or ConTree fails', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const heal = vi.fn().mockRejectedValue(
      new Error('CONTREE_TOKEN is required; token=private Bearer abc123'),
    );

    const exitCode = await runCli(
      ['heal', '--case-dir', '/tmp/case', '--format', 'json'],
      { write: (value) => stdout.push(value), writeError: (value) => stderr.push(value) },
      { heal },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      outcome: 'infra-stop',
      diagnosis: { class: 'infra', errorExcerpt: expect.stringContaining('CONTREE_TOKEN is required') },
      triage: { status: 'not-run', reproduced: 0, of: 0 },
    });
    expect(stdout.join('')).not.toContain('private');
    expect(stdout.join('')).not.toContain('abc123');
  });
});
