import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { captureRun, parseCaptureArguments } from './capture-run.mjs';
import { MAX_REPLAY_BYTES } from './replay-contract.mjs';

const SHA = 'a'.repeat(40);
const CAPTURE_SHA = 'c'.repeat(40);

function exchange(boundary, sequence) {
  return {
    sequence,
    boundary,
    request: { method: 'POST', url: `https://example.test/${boundary}`, headers: {}, body: '{}' },
    response: { status: 200, headers: {}, body: '{}' },
    latencyMs: 1,
  };
}

function completeArtifact() {
  return {
    schemaVersion: 'sutura-replay-v1',
    runId: '33268037618',
    repo: 'juan294/sutura',
    actionSha: 'b'.repeat(40),
    capturedAt: '2026-08-30T08:00:00.000Z',
    github: [{
      sequence: 1,
      method: 'getWorkflowRun',
      args: [1],
      result: {
        id: 1,
        headSha: 'a'.repeat(40),
        repository: 'juan294/sutura',
        event: 'push',
        conclusion: 'failure',
        headBranch: 'develop',
        pullRequests: [],
      },
    }],
    repository: [{ sequence: 2, method: 'readPolicyAtSha', args: [], result: null }],
    executor: [{
      sequence: 1,
      method: 'operationCapacity',
      args: [],
      result: { limit: 1, active: 0, available: 1 },
    }],
    http: [exchange('nebius', 1), exchange('tavily', 2), exchange('contree', 3)],
    configuration: {
      triageN: 1, raceK: 1,
      models: { nano: 'nano', super: 'super', ultra: 'ultra' },
      routingProfileId: 'test', maxOps: 1,
    },
    completeness: { complete: true, overflowedBoundaries: [], pendingBoundaries: [] },
    outcome: 'fixed',
  };
}

test('capture-run records adapter call order, raw logs, branch drift, and manifest hash', async () => {
  const output = await mkdtemp(join(tmpdir(), 'sutura-capture-run-'));
  const calls = [];
  const responses = new Map([
    ['repos/juan294/sutura/actions/runs/33239848825', {
      id: 33239848825,
      head_sha: SHA,
      head_branch: 'develop',
      event: 'workflow_dispatch',
      conclusion: 'failure',
      repository: { full_name: 'juan294/sutura' },
      pull_requests: [],
    }],
    ['repos/juan294/sutura/commits/' + SHA + '/pulls?per_page=100', []],
    ['repos/juan294/sutura/actions/runs/33239848825/jobs?filter=latest&per_page=100', {
      jobs: [{
        id: 901,
        name: 'checks',
        conclusion: 'failure',
        steps: [{
          name: 'Run pnpm run test',
          conclusion: 'failure',
          started_at: '2026-08-29T07:02:26Z',
          completed_at: '2026-08-29T07:02:46Z',
        }],
      }],
    }],
    ['repos/juan294/sutura/actions/jobs/901/logs',
      '\u001b[31m❯\u001b[39m packages/cli/src/bundle.test.ts\nHook timed out in 10000ms\n'],
    ['repos/juan294/sutura/actions/runs/33239910020/artifacts?per_page=100', {
      artifacts: [],
    }],
  ]);
  const api = async (endpoint) => {
    calls.push(endpoint);
    if (endpoint.includes('/git/ref/heads/')) {
      const error = new Error('Not Found');
      error.status = 404;
      throw error;
    }
    assert.ok(responses.has(endpoint), `unexpected endpoint ${endpoint}`);
    return responses.get(endpoint);
  };

  try {
    const result = await captureRun({
      workflowRunId: '33239848825',
      targetRunId: '33239848825',
      suturaRunId: '33239910020',
      outDir: output,
      kind: 'ci-failure',
      notes: 'A3: bundle.test.ts hook timeout',
      api,
      captureSource: async () => CAPTURE_SHA,
      now: () => new Date('2026-08-30T08:00:00.000Z'),
    });
    const bytes = await readFile(join(output, '33239848825', 'bundle.json'));
    const bundle = JSON.parse(bytes);
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));

    assert.equal(bundle.runId, '33239848825');
    assert.deepEqual(bundle.github.map(({ method }) => method), [
      'getWorkflowRun',
      'listPullRequestsForCommit',
      'getRefSha',
      'listJobsForWorkflowRun',
      'downloadJobLogs',
    ]);
    assert.match(bundle.github.at(-1).result, /\u001b\[31m❯\u001b\[39m/u);
    assert.match(bundle.github.at(-1).result, /Hook timed out in 10000ms/u);
    assert.deepEqual(bundle.completeness.pendingBoundaries, [
      'contree', 'executor', 'nebius', 'repository', 'tavily',
    ]);
    assert.deepEqual(manifest.entries, [{
      workflowRunId: '33239848825',
      targetRunId: '33239848825',
      suturaRunId: '33239910020',
      kind: 'ci-failure',
      headSha: SHA,
      capturedAt: '2026-08-30T08:00:00.000Z',
      source: CAPTURE_SHA,
      capturedBy: 'local',
      bundleSha256: createHash('sha256').update(bytes).digest('hex'),
      boundaries: ['github'],
      notes: 'A3: bundle.test.ts hook timeout; branch develop no longer exists; getRefSha derived from immutable workflow run head_sha',
    }]);
    assert.equal(result.entry.bundleSha256, manifest.entries[0].bundleSha256);
    assert.deepEqual(calls, [
      'repos/juan294/sutura/actions/runs/33239848825',
      'repos/juan294/sutura/commits/' + SHA + '/pulls?per_page=100',
      'repos/juan294/sutura/git/ref/heads/develop',
      'repos/juan294/sutura/actions/runs/33239848825/jobs?filter=latest&per_page=100',
      'repos/juan294/sutura/actions/jobs/901/logs',
      'repos/juan294/sutura/actions/runs/33239910020/artifacts?per_page=100',
    ]);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('capture arguments keep workflow, target, and Sutura run ids distinct', () => {
  assert.deepEqual(parseCaptureArguments([
    '33239848825', '--target-run', '33238191746', '--sutura-run', '33239910020',
    '--out', '/tmp/captured', '--kind', 'dogfood-gave-up', '--notes', 'historical case',
  ]), {
    workflowRunId: '33239848825',
    targetRunId: '33238191746',
    suturaRunId: '33239910020',
    outDir: '/tmp/captured',
    kind: 'dogfood-gave-up',
    notes: 'historical case',
  });
  assert.throws(() => parseCaptureArguments(['33239848825']), /--out/u);
  assert.throws(
    () => parseCaptureArguments(['33239848825', '--out', '/tmp/x', '--unknown']),
    /Unknown capture option/u,
  );
});

test('capture-run keeps run roles distinct and merges an available Sutura HTTP artifact', async () => {
  const output = await mkdtemp(join(tmpdir(), 'sutura-capture-artifact-'));
  const workflowRunId = '33268672246';
  const targetRunId = '33268037618';
  const suturaRunId = '33270000000';
  const responses = new Map([
    [`repos/juan294/sutura/actions/runs/${workflowRunId}`, {
      id: Number(workflowRunId), head_sha: SHA, head_branch: 'develop',
      event: 'push', conclusion: 'failure', repository: { full_name: 'juan294/sutura' },
      pull_requests: [],
    }],
    ['repos/juan294/sutura/git/ref/heads/develop', { object: { sha: SHA } }],
    [`repos/juan294/sutura/actions/runs/${workflowRunId}/jobs?filter=latest&per_page=100`, {
      jobs: [],
    }],
    [`repos/juan294/sutura/actions/runs/${suturaRunId}/artifacts?per_page=100`, {
      artifacts: [{
        id: 44, name: `sutura-replay-${targetRunId}.json`, expired: false,
      }],
    }],
  ]);
  const api = async (endpoint) => {
    assert.ok(responses.has(endpoint), `unexpected endpoint ${endpoint}`);
    return responses.get(endpoint);
  };
  const artifactBundle = completeArtifact();

  try {
    const { bundle, entry } = await captureRun({
      workflowRunId,
      targetRunId,
      suturaRunId,
      outDir: output,
      notes: 'artifact merge',
      api,
      captureSource: async () => CAPTURE_SHA,
      loadArtifact: async (_api, artifact) => {
        assert.equal(artifact.id, 44);
        return artifactBundle;
      },
    });

    assert.equal(bundle.runId, targetRunId);
    assert.equal(bundle.actionSha, 'b'.repeat(40));
    assert.deepEqual(bundle.http, artifactBundle.http);
    assert.deepEqual(bundle.completeness.pendingBoundaries, [
      'executor', 'repository',
    ]);
    assert.deepEqual(entry.boundaries, ['contree', 'github', 'nebius', 'tavily']);
    assert.equal(entry.workflowRunId, workflowRunId);
    assert.equal(entry.targetRunId, targetRunId);
    assert.equal(entry.suturaRunId, suturaRunId);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('capture-run rejects invalid, partial, lossy, or incomplete replay artifacts', async (t) => {
  const valid = completeArtifact();
  const cases = [
    ['malformed JSON', '{"schemaVersion":', /not JSON/u],
    ['over byte limit', ' '.repeat(MAX_REPLAY_BYTES + 1), /16 MiB/u],
    ['unknown schema', { ...valid, schemaVersion: 'future' }, /schemaVersion/u],
    ['partial', {
      ...valid,
      completeness: { complete: false, overflowedBoundaries: [], pendingBoundaries: ['tavily'] },
    }, /complete/u],
    ['overflow', {
      ...valid,
      completeness: { complete: true, overflowedBoundaries: ['http'], pendingBoundaries: [] },
    }, /overflow|inconsistent/u],
    ['truncated', {
      ...valid,
      http: valid.http.map((item, index) => index === 0 ? {
        ...item,
        response: { status: 200, headers: {}, body: {
          truncated: true, bytes: 2_000_000, sha256: 'd'.repeat(64),
        } },
      } : item),
    }, /truncated/u],
    ['malformed', { ...valid, actionSha: 'not-a-sha' }, /actionSha/u],
    ['wrong target run', { ...valid, runId: '33268037619' }, /target run id/u],
    ['missing completed exchange', {
      ...valid,
      http: valid.http.filter(({ boundary }) => boundary !== 'tavily'),
    }, /tavily/u],
  ];

  for (const [name, artifactBundle, expected] of cases) {
    await t.test(name, async () => {
      const output = await mkdtemp(join(tmpdir(), 'sutura-invalid-artifact-'));
      const api = async (endpoint) => {
        if (endpoint.endsWith('/actions/runs/33268672246')) return {
          id: 33268672246, head_sha: SHA, head_branch: 'develop', event: 'push',
          conclusion: 'failure', repository: { full_name: 'juan294/sutura' }, pull_requests: [],
        };
        if (endpoint.endsWith('/git/ref/heads/develop')) return { object: { sha: SHA } };
        if (endpoint.includes('/jobs?')) return { jobs: [] };
        if (endpoint.includes('/artifacts?')) return {
          artifacts: [{ id: 44, name: 'sutura-replay-33268037618.json', expired: false }],
        };
        assert.fail(`unexpected endpoint ${endpoint}`);
      };
      try {
        await assert.rejects(captureRun({
          workflowRunId: '33268672246',
          targetRunId: '33268037618',
          suturaRunId: '33270000000',
          outDir: output,
          notes: 'invalid artifact',
          api,
          captureSource: async () => CAPTURE_SHA,
          loadArtifact: async () => artifactBundle,
        }), expected);
      } finally {
        await rm(output, { recursive: true, force: true });
      }
    });
  }
});

test('pull-request capture resolves exactly one associated PR before jobs', async () => {
  const output = await mkdtemp(join(tmpdir(), 'sutura-pull-capture-'));
  const calls = [];
  const api = async (endpoint) => {
    calls.push(endpoint);
    if (endpoint.endsWith('/actions/runs/77')) return {
      id: 77, head_sha: SHA, head_branch: 'feature', event: 'pull_request',
      conclusion: 'failure', repository: { full_name: 'juan294/sutura' }, pull_requests: [],
    };
    if (endpoint.includes(`/commits/${SHA}/pulls?`)) return [{ number: 19 }];
    if (endpoint.endsWith('/pulls/19')) return {
      number: 19,
      head: { sha: SHA, ref: 'feature', repo: { full_name: 'juan294/sutura' } },
      base: { sha: 'b'.repeat(40), ref: 'develop' },
    };
    if (endpoint.endsWith(`/commits/${'b'.repeat(40)}`)) return { sha: 'b'.repeat(40) };
    if (endpoint.includes('/jobs?')) return { jobs: [] };
    assert.fail(`unexpected endpoint ${endpoint}`);
  };
  try {
    const { bundle } = await captureRun({
      workflowRunId: '77', outDir: output, notes: 'one PR', api,
      captureSource: async () => CAPTURE_SHA,
    });
    assert.deepEqual(bundle.github.map(({ method }) => method), [
      'getWorkflowRun', 'listPullRequestsForCommit', 'getPullRequest',
      'getCommitSha', 'listJobsForWorkflowRun',
    ]);
    assert.equal(calls.some((endpoint) => endpoint.includes('/git/ref/')), false);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('pull-request capture fails after zero or multiple associated PRs', async (t) => {
  for (const candidates of [[], [{ number: 19 }, { number: 20 }]]) {
    await t.test(`${candidates.length} associations`, async () => {
      const output = await mkdtemp(join(tmpdir(), 'sutura-pull-ambiguous-'));
      const calls = [];
      const api = async (endpoint) => {
        calls.push(endpoint);
        if (endpoint.endsWith('/actions/runs/77')) return {
          id: 77, head_sha: SHA, head_branch: 'feature', event: 'pull_request',
          conclusion: 'failure', repository: { full_name: 'juan294/sutura' }, pull_requests: [],
        };
        if (endpoint.includes(`/commits/${SHA}/pulls?`)) return candidates;
        assert.fail(`capture continued after ambiguous PR resolution: ${endpoint}`);
      };
      try {
        await assert.rejects(captureRun({
          workflowRunId: '77', outDir: output, notes: 'ambiguous PR', api,
          captureSource: async () => CAPTURE_SHA,
        }), /one pull request/u);
        assert.deepEqual(calls, [
          'repos/juan294/sutura/actions/runs/77',
          `repos/juan294/sutura/commits/${SHA}/pulls?per_page=100`,
        ]);
      } finally {
        await rm(output, { recursive: true, force: true });
      }
    });
  }
});
