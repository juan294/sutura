import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { completedTriageVerdict, notRunTriageVerdict, type AuditFile, type CaseFile } from '@sutura/core';

import { runCli } from './cli.js';

function fixed(): CaseFile {
  return {
    runId: 'case-1',
    repo: 'placebo/case',
    runtime: 'node',
    diagnosis: {
      class: 'test-assertion', confidence: 1, signals: [],
      failingCmd: 'pnpm test', errorExcerpt: 'failed',
    },
    triage: completedTriageVerdict([1, 1, 1, 1], 5),
    race: [],
    audit: { approved: true, checks: [], reasoning: 'approved' },
    outcome: 'fixed',
    cost: { entries: [], totalUsd: () => 0 },
    policy: { baseRef: 'local', baseSha: 'local', policySha: 'default' },
    stages: [],
  };
}

describe('runCli', () => {
  it('prints replayed CaseFile JSON and forwards an explicit runtime', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const replay = vi.fn().mockResolvedValue(fixed());

    const exitCode = await runCli([
      'replay', '--bundle', '/tmp/replay.json', '--format', 'json', '--runtime', 'node',
    ], {
      write: (value) => stdout.push(value),
      writeError: (value) => stderr.push(value),
    }, { replay });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toMatchObject({ outcome: 'fixed' });
    expect(replay).toHaveBeenCalledWith({
      command: 'replay', bundle: '/tmp/replay.json', format: 'json', runtime: 'node',
    });
  });

  it('returns replay failures on stderr without CaseFile output', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const replay = vi.fn().mockRejectedValue(new Error(
      'Replay outcome mismatch: recorded gave-up, replayed fixed',
    ));

    const exitCode = await runCli([
      'replay', '--bundle', '/tmp/replay.json', '--format', 'json',
    ], {
      write: (value) => stdout.push(value),
      writeError: (value) => stderr.push(value),
    }, { replay });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toContain('recorded gave-up, replayed fixed');
  });

  it('prints only reduced-assurance AuditFile JSON', async () => {
    const stdout: string[] = [];
    const auditFile = {
      assurance: 'reduced', outcome: 'audit-refused',
      diagnosis: { before: fixed().diagnosis, after: fixed().diagnosis },
      policy: fixed().policy,
      audit: { approved: false, checks: [], reasoning: 'refused' },
      cost: { entries: [], totalUsd: () => 0 },
    } satisfies AuditFile;
    const audit = vi.fn().mockResolvedValue(auditFile);
    const exitCode = await runCli([
      'audit', '--case-dir', '/tmp/case', '--candidate-diff', '/tmp/fix.diff',
      '--before-log', '/tmp/before.log', '--after-log', '/tmp/after.log', '--format', 'json',
    ], { write: (value) => stdout.push(value) }, { audit });
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(''))).toMatchObject({ assurance: 'reduced', outcome: 'audit-refused' });
    expect(stdout.join('')).not.toMatch(/fixed|verified|flaky-no-patch/u);
  });

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
      triage: notRunTriageVerdict(),
    });
    expect(stdout.join('')).not.toContain('private');
    expect(stdout.join('')).not.toContain('abc123');
  });

  it('reports an auto-detected Python runtime when local healing fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-cli-python-failure-'));
    const stdout: string[] = [];
    try {
      await writeFile(join(directory, 'pyproject.toml'), '[project]\nname = "fixture"\n');
      await writeFile(join(directory, 'uv.lock'), 'version = 1\n');
      const heal = vi.fn().mockRejectedValue(new Error('sandbox failed'));

      await runCli(
        ['heal', '--case-dir', directory, '--format', 'json'],
        { write: (value) => stdout.push(value) },
        { heal },
      );

      expect(JSON.parse(stdout.join(''))).toMatchObject({
        outcome: 'infra-stop',
        runtime: 'python',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
