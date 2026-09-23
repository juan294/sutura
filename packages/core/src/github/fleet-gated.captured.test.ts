import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { classifyMechanically } from '../diagnose/classify.js';
import { diagnosisLog, rankFailedSteps } from '../orchestrate.js';
import { githubApi } from '../replay/replay-fixtures.test-helper.js';
import { GitHubAdapter } from './adapter.js';
import type { GitHubApi } from './types.js';

// Failed-step windows of the consumer CI runs that died at the
// failing-command gate (docs/research/2026-09-22-fleet-dogfood-metrics.md).
// Each log is the job log trimmed to the failed step's time window, which is
// every line the adapter reads, with credential-shaped values (Supabase local
// keys, CI test secrets) replaced by `[redacted]`. The private archy run is not
// committed.
const FIXTURES = new URL('../__fixtures__/fleet-gated/', import.meta.url);

interface GatedRun {
  repository: string;
  expectedFailingCmd: string;
  monitorRunId: string;
  ciRunId: string;
  jobs: Array<{
    id: number;
    name: string;
    log: string;
    step: { name: string; startedAt: string; completedAt: string };
  }>;
}

const RUNS = JSON.parse(readFileSync(new URL('runs.json', FIXTURES), 'utf8')) as GatedRun[];
const SHA = 'a'.repeat(40);

function gatedApi(run: GatedRun): GitHubApi {
  const logs = new Map(run.jobs.map(({ id, log }) => [id, readFileSync(new URL(log, FIXTURES), 'utf8')]));
  return {
    ...githubApi({ logLines: [], startedAt: '', completedAt: '' }),
    getWorkflowRun: async () => ({
      id: Number(run.ciRunId), headSha: SHA, repository: run.repository,
      event: 'push', conclusion: 'failure', headBranch: 'develop', pullRequests: [],
    }),
    getRefSha: async () => SHA,
    listJobsForWorkflowRun: async () => run.jobs.map(({ id, name, step }) => ({
      id, name, conclusion: 'failure',
      steps: [{ name: step.name, conclusion: 'failure', startedAt: step.startedAt, completedAt: step.completedAt }],
    })),
    downloadJobLogs: async (id) => logs.get(id) ?? '',
  };
}

// The log orchestrate diagnoses: failed steps ranked earliest-first (#151).
async function gatedDiagnosisLog(run: GatedRun) {
  return diagnosisLog(rankFailedSteps(await gatedFailedSteps(run)), 0);
}

async function gatedFailedSteps(run: GatedRun) {
  const [owner = '', repo = ''] = run.repository.split('/');
  const adapter = new GitHubAdapter(gatedApi(run), { owner, repo, runId: run.ciRunId });
  return (await adapter.getFailingRun(run.ciRunId)).failedSteps;
}

function gatedRun(monitorRunId: string): GatedRun {
  const run = RUNS.find((candidate) => candidate.monitorRunId === monitorRunId);
  if (run === undefined) throw new Error(`No fleet-gated fixture for monitor run ${monitorRunId}`);
  return run;
}

describe('fleet runs gated on an unobserved failing command', () => {
  it('covers every committed gated run', () => {
    expect(RUNS).toHaveLength(15);
  });

  it.each(RUNS.map((run) => [run.repository, run.monitorRunId, run] as const))(
    'recovers the failing command for %s monitor run %s',
    async (_repository, _monitorRunId, run) => {
      const diagnosis = classifyMechanically(await gatedDiagnosisLog(run));

      expect(diagnosis.failingCmd).toBe(run.expectedFailingCmd);
    },
  );

  it('retains the command header for a step with a custom display name (layalga 35590192744)', async () => {
    const run = gatedRun('35590192744');
    const acceptance = run.jobs.find(({ id }) => id === 106300682270);
    const window = readFileSync(new URL(acceptance?.log ?? '', FIXTURES), 'utf8').trimEnd().split('\n');
    const [browser] = (await gatedFailedSteps({ ...run, jobs: acceptance ? [acceptance] : [] }));
    const retained = browser?.log.split('\n') ?? [];

    // The step is displayed as "Run browser tests"; no `##[group]Run browser tests`
    // marker exists, so the pre-fix adapter kept only the last 200 lines.
    expect(window.some((line) => line.includes('##[group]Run browser tests'))).toBe(false);
    expect(window.length).toBeGreaterThan(200);
    expect(retained[0]).toMatch(/##\[group\]Run pnpm run test:e2e$/u);
    expect(retained.at(-1)).toBe(window.at(-1));
    expect(retained).toHaveLength(200);
  });

  it('never reads the display name as the command (layalga 35590192744)', async () => {
    const diagnosis = classifyMechanically(await gatedDiagnosisLog(gatedRun('35590192744')));

    expect(diagnosis.failingCmd).not.toBe('browser tests');
    expect(diagnosis.failingCmd).not.toBe('integration tests');
  });
});
