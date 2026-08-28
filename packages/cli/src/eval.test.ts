import { link, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createEvaluationManifest } from '@sutura/evaluation';
import type { TraceEvent } from '@sutura/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MAX_EVALUATION_MANIFEST_BYTES,
  atifOutputPaths,
  runEvaluationCommand,
} from './eval.js';

const roots: string[] = [];

function events(runId: string, outcome: 'fixed' | 'refused'): TraceEvent[] {
  return [
    { schemaVersion: 'sutura-trace-v1', runId, sequence: 1, timestampMs: 0, type: 'run-start', stage: 'run', summary: 'start' },
    { schemaVersion: 'sutura-trace-v1', runId, sequence: 2, timestampMs: 1, type: 'run-finish', stage: 'run', outcome },
  ];
}

function fixture() {
  return createEvaluationManifest({
    evaluationId: 'eval-cli', suturaCommit: 'a'.repeat(40), repositoryClean: true,
    corpusName: 'placebo', corpusVersion: '0.1', corpusHash: 'b'.repeat(64),
    adapterVersion: '0.1.1', modelCatalogSnapshot: [], routingProfile: 'adaptive-default',
    budgetProfile: 'default', startedAt: '2026-08-29T00:00:00.000Z',
    completedAt: '2026-08-29T00:01:00.000Z',
    cases: [
      { caseId: 'fixed/case', outcome: 'fixed', trace: events('fixed-run', 'fixed') },
      { caseId: 'refused case', outcome: 'refused', trace: events('refused-run', 'refused') },
    ],
  });
}

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'sutura-eval-cli-'));
  roots.push(value);
  return value;
}

afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe('evaluation CLI operations', () => {
  it('validates a bounded manifest and exports deterministic adjacent ATIF files', async () => {
    const directory = await root();
    const manifest = join(directory, 'manifest.json');
    const output = join(directory, 'trajectory.atif.json');
    await writeFile(manifest, JSON.stringify(fixture()));

    await expect(runEvaluationCommand({ command: 'eval-validate', manifest }))
      .resolves.toEqual(['Valid evaluation manifest: eval-cli']);
    const lines = await runEvaluationCommand({
      command: 'eval-export', manifest, format: 'atif', output, force: false,
    });
    const paths = atifOutputPaths(output, ['fixed/case', 'refused case']);
    expect(lines).toEqual(paths.map((path) => `Exported ATIF trajectory to ${path}`));
    await expect(Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, 'utf8')))))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ schema_version: 'ATIF-v1.7', trajectory_id: 'fixed-run' }),
        expect.objectContaining({ schema_version: 'ATIF-v1.7', trajectory_id: 'refused-run' }),
      ]));
  });

  it('preflights every multi-case output before writing unless force is explicit', async () => {
    const directory = await root();
    const manifest = join(directory, 'manifest.json');
    const output = join(directory, 'trajectory.atif.json');
    const paths = atifOutputPaths(output, ['fixed/case', 'refused case']);
    await writeFile(manifest, JSON.stringify(fixture()));
    await writeFile(paths[1]!, 'occupied');

    await expect(runEvaluationCommand({
      command: 'eval-export', manifest, format: 'atif', output, force: false,
    })).rejects.toThrow(/already exists/u);
    await expect(readFile(paths[0]!, 'utf8')).rejects.toThrow();
    expect(await readFile(paths[1]!, 'utf8')).toBe('occupied');
  });

  it('rolls back published outputs when a later no-clobber publication loses a race', async () => {
    const directory = await root();
    const manifest = join(directory, 'manifest.json');
    const output = join(directory, 'trajectory.atif.json');
    const paths = atifOutputPaths(output, ['fixed/case', 'refused case']);
    await writeFile(manifest, JSON.stringify(fixture()));
    let publications = 0;

    await expect(runEvaluationCommand({
      command: 'eval-export', manifest, format: 'atif', output, force: false,
    }, {
      async link(temporary, target) {
        publications += 1;
        if (publications === 2) await writeFile(target, 'racer');
        await link(temporary, target);
      },
    })).rejects.toThrow();

    await expect(readFile(paths[0]!, 'utf8')).rejects.toThrow();
    expect(await readFile(paths[1]!, 'utf8')).toBe('racer');
    expect((await readdir(directory)).filter((name) => name.includes('.sutura-eval-'))).toEqual([]);
  });

  it('rejects oversized input before output creation', async () => {
    const directory = await root();
    const manifest = join(directory, 'manifest.json');
    const output = join(directory, 'data.jsonl');
    await writeFile(manifest, 'x'.repeat(MAX_EVALUATION_MANIFEST_BYTES + 1));

    await expect(runEvaluationCommand({
      command: 'eval-export', manifest, format: 'jsonl', output, force: false,
    })).rejects.toThrow(/exceeds/u);
    await expect(readFile(output)).rejects.toThrow();
  });
});
