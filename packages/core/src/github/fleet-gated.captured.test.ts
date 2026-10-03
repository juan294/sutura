import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { classifyMechanically } from '../diagnose/classify.js';
import { diagnosisLog, extractSourceReferences, rankFailedSteps } from '../orchestrate.js';
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

// gh-glance CI run 36969419519 (monitor run 36971022530, Action v0.3.5): an
// unnamed multi-line `run:` step whose TAP output prints the only failure
// about 700 lines before the step ends. The pre-fix window kept the header
// line and the last 199 lines, so diagnosis saw `files=()` as the command and
// no source path, and the attempt gave up with no anchorable repair source.
const LONG_TAP_RUN: GatedRun = {
  repository: 'juan294/gh-glance',
  expectedFailingCmd: [
    'files=()',
    'for file in test/pty/*.test.mjs; do',
    'if [[ "$file" != test/pty/governor.test.mjs ]]; then',
    'files+=("$file")',
    'fi',
    'done',
    'test "${#files[@]}" -gt 0',
    'node --test --test-concurrency=1 --test-timeout=900000 "${files[@]}"',
  ].join('\n'),
  monitorRunId: '36971022530',
  ciRunId: '36969419519',
  jobs: [
    {
      id: 110720064182,
      name: 'PTY other files',
      log: 'gh-glance-110720064182.log',
      step: { name: 'Run files=()', startedAt: '2026-10-02T05:33:03Z', completedAt: '2026-10-02T05:53:59Z' },
    },
    {
      id: 110724788079,
      name: 'PTY',
      log: 'gh-glance-110724788079.log',
      step: { name: 'Require both PTY shards', startedAt: '2026-10-02T05:54:06Z', completedAt: '2026-10-02T05:54:06Z' },
    },
  ],
};

describe('a long TAP step whose failure precedes the retained tail (gh-glance 36969419519)', () => {
  async function shardStep() {
    const steps = await gatedFailedSteps(LONG_TAP_RUN);
    const step = steps.find(({ jobName }) => jobName === 'PTY other files');
    if (step === undefined) throw new Error('PTY other files step was not collected');
    return step;
  }

  it('keeps the multi-line script, the failure block and the tail within 200 lines', async () => {
    const window = readFileSync(new URL('gh-glance-110720064182.log', FIXTURES), 'utf8').trimEnd().split('\n');
    const retained = (await shardStep()).log.split('\n');

    expect(window.length).toBeGreaterThan(200);
    expect(retained).toHaveLength(200);
    expect(retained[0]).toMatch(/##\[group\]Run files=\(\)$/u);
    expect(retained.some((line) => /shell: \/usr\/bin\/bash -e \{0\}$/u.test(line))).toBe(true);
    expect(retained.some((line) => line.endsWith('not ok 2 - POLL-02 a quiet list waits its 30s interval and is checked within two seconds of it'))).toBe(true);
    expect(retained.some((line) => line.includes('test/pty/adaptive-polling.test.mjs:122:10'))).toBe(true);
    expect(retained.at(-1)).toBe(window.at(-1));
    // Retained lines keep their original order.
    const positions = retained.map((line) => window.indexOf(line));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('reads the whole script as the failing command', async () => {
    const diagnosis = classifyMechanically(await gatedDiagnosisLog(LONG_TAP_RUN));

    expect(diagnosis.failingCmd).toBe(LONG_TAP_RUN.expectedFailingCmd);
  });

  it('finds the failing test file as a repair source', async () => {
    const references = extractSourceReferences((await shardStep()).log);

    expect(references.map(({ path }) => path)).toContain('test/pty/adaptive-polling.test.mjs');
  });
});

// cirujano CI run 37018518357 (2026-10-02): `pnpm -r --workspace-concurrency=1
// test:coverage` runs vitest once per package. Each run announces its package
// on a `RUN v4.1.11 /home/runner/work/cirujano/cirujano/packages/<name>` line
// and then names files relative to that package, so the only failure appears
// as `src/bundle.test.ts`, a path that does not exist at the repository root.
const PACKAGE_RELATIVE_RUN: GatedRun = {
  repository: 'juan294/cirujano',
  expectedFailingCmd: 'pnpm run test:coverage',
  monitorRunId: '37020000000',
  ciRunId: '37018518357',
  jobs: [{
    id: 110875289871,
    name: 'checks',
    log: 'cirujano-110875289871.log',
    step: { name: 'Run pnpm run test:coverage', startedAt: '2026-10-02T14:15:35Z', completedAt: '2026-10-02T14:18:55Z' },
  }],
};

describe('a per-package vitest run in a workspace (cirujano 37018518357)', () => {
  it('resolves the failing test file inside the package vitest announced', async () => {
    const [step] = await gatedFailedSteps(PACKAGE_RELATIVE_RUN);
    // The Action reads references latest-first (packages/action/src/main.ts); the
    // local CLI reads them first-first. Both must reach the failing file.
    for (const order of ['latest', 'first'] as const) {
      const references = extractSourceReferences(step?.log ?? '', order);
      expect(references).toContainEqual({ path: 'packages/cli/src/bundle.test.ts', line: 19 });
      expect(references.map(({ path }) => path)).not.toContain('src/bundle.test.ts');
    }
  });
});
