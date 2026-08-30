#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  completedReplayBoundaries,
  parseCapturedFixturesManifest,
  parseCompleteReplayArtifact,
} from './replay-contract.mjs';

const execFileAsync = promisify(execFile);
const REPOSITORY = 'juan294/sutura';
const MANIFEST_SCHEMA = 'sutura-captured-fixtures-v1';
const BUNDLE_SCHEMA = 'sutura-replay-v1';
const MAX_BUNDLE_BYTES = 16 * 1_024 * 1_024;
const MAX_COMMAND_BYTES = 32 * 1_024 * 1_024;
const RUN_ID_PATTERN = /^[1-9]\d*$/u;
const KINDS = new Set([
  'ci-failure',
  'ci-success',
  'provider-capture',
  'tavily-capture',
  'sandbox-capture',
  'dogfood-gave-up',
]);

function runId(value, label) {
  if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a positive decimal id`);
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) throw new Error(`${label} is outside the safe range`);
  return value;
}

function valueAfter(args, index, option) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseCaptureArguments(args) {
  const workflowRunId = runId(args[0], 'CI run id');
  let targetRunId = workflowRunId;
  let suturaRunId;
  let outDir;
  let kind;
  let notes = '';
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--target-run') {
      targetRunId = runId(valueAfter(args, index, option), 'Target run id');
      index += 1;
    } else if (option === '--sutura-run') {
      suturaRunId = runId(valueAfter(args, index, option), 'Sutura run id');
      index += 1;
    } else if (option === '--out') {
      outDir = valueAfter(args, index, option);
      index += 1;
    } else if (option === '--kind') {
      kind = valueAfter(args, index, option);
      if (!KINDS.has(kind)) throw new Error(`Unknown capture kind: ${kind}`);
      index += 1;
    } else if (option === '--notes') {
      notes = valueAfter(args, index, option);
      index += 1;
    } else {
      throw new Error(`Unknown capture option: ${option}`);
    }
  }
  if (!outDir) throw new Error('--out is required');
  return {
    workflowRunId,
    targetRunId,
    ...(suturaRunId ? { suturaRunId } : {}),
    outDir,
    ...(kind ? { kind } : {}),
    notes,
  };
}

async function defaultGhApi(endpoint, options = {}) {
  const arguments_ = [
    'api',
    '-H', 'Accept: application/vnd.github+json',
    endpoint,
    ...(options.raw ? ['--allow-escape-sequences'] : []),
  ];
  const { stdout } = await execFileAsync('gh', arguments_, {
    encoding: options.raw ? 'buffer' : 'utf8',
    maxBuffer: MAX_COMMAND_BYTES,
  });
  return options.raw ? stdout : JSON.parse(stdout);
}

async function defaultCaptureSource() {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  const source = stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(source)) {
    throw new Error('Capture source must be an exact lowercase commit SHA');
  }
  return source;
}

function apiStatus(error) {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = error.status;
  if (typeof status === 'number') return status;
  const stderr = typeof error.stderr === 'string' ? error.stderr : '';
  return /HTTP 404|Not Found/u.test(stderr) ? 404 : undefined;
}

function mapWorkflowRun(data) {
  return {
    id: data.id,
    headSha: data.head_sha,
    repository: data.repository?.full_name,
    event: data.event,
    conclusion: data.conclusion,
    headBranch: data.head_branch,
    pullRequests: (data.pull_requests ?? []).map(({ number }) => ({ number })),
  };
}

function mapPullRequest(data) {
  return {
    number: data.number,
    headSha: data.head?.sha,
    headRef: data.head?.ref,
    headRepo: data.head?.repo?.full_name ?? null,
    baseSha: data.base?.sha,
    baseRef: data.base?.ref,
  };
}

function mapJobs(data) {
  return (data.jobs ?? []).map((job) => ({
    id: job.id,
    name: job.name,
    conclusion: job.conclusion,
    steps: (job.steps ?? []).map((step) => ({
      name: step.name,
      conclusion: step.conclusion,
      startedAt: step.started_at ?? null,
      completedAt: step.completed_at ?? null,
    })),
  }));
}

function asLog(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  throw new Error('GitHub returned job logs in an unsupported format');
}

function replayConfiguration() {
  return {
    triageN: 5,
    raceK: 3,
    models: {
      nano: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
      super: 'nvidia/nemotron-3-super-120b-a12b',
      ultra: 'nvidia/Nemotron-3-Ultra-550b-a55b',
    },
    routingProfileId: 'production-baseline-v1',
    maxOps: 40,
  };
}

function appendNote(notes, addition) {
  return notes ? `${notes}; ${addition}` : addition;
}

async function artifactReplayBundle(api, suturaRunId, targetRunId, loadArtifact) {
  if (!suturaRunId) return undefined;
  const data = await api(
    `repos/${REPOSITORY}/actions/runs/${suturaRunId}/artifacts?per_page=100`,
  );
  const expected = `sutura-replay-${targetRunId}.json`;
  const artifacts = (data.artifacts ?? []).filter(({ name, expired }) =>
    name === expected && expired !== true,
  );
  if (artifacts.length === 0) return undefined;
  if (artifacts.length !== 1) throw new Error(`Sutura run has multiple ${expected} artifacts`);
  const bundle = parseCompleteReplayArtifact(await loadArtifact(api, artifacts[0]));
  if (bundle.runId !== targetRunId) {
    throw new Error('Replay artifact runId differs from the target run id');
  }
  return bundle;
}

async function defaultArtifactLoader(api, artifact) {
  const archive = await api(
    `repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`,
    { raw: true },
  );
  const directory = await mkdtemp(join(tmpdir(), 'sutura-replay-artifact-'));
  const zip = join(directory, 'artifact.zip');
  try {
    await writeFile(zip, archive);
    const { stdout: listing } = await execFileAsync('unzip', ['-Z1', zip], {
      encoding: 'utf8', maxBuffer: MAX_COMMAND_BYTES,
    });
    const candidates = listing.split(/\r?\n/u).filter((name) => name.endsWith('.json'));
    if (candidates.length !== 1) throw new Error('Replay artifact must contain one JSON file');
    const { stdout } = await execFileAsync('unzip', ['-p', zip, candidates[0]], {
      encoding: 'utf8', maxBuffer: MAX_COMMAND_BYTES,
    });
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readManifest(path) {
  try {
    return parseCapturedFixturesManifest(await readFile(path));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return parseCapturedFixturesManifest({ schemaVersion: MANIFEST_SCHEMA, entries: [] });
    }
    throw error;
  }
}

export async function captureRun({
  workflowRunId,
  targetRunId = workflowRunId,
  suturaRunId,
  outDir,
  kind,
  notes = '',
  api = defaultGhApi,
  loadArtifact = defaultArtifactLoader,
  capturedBy = 'local',
  captureSource = defaultCaptureSource,
  now = () => new Date(),
}) {
  runId(workflowRunId, 'Workflow run id');
  runId(targetRunId, 'Target run id');
  if (suturaRunId) runId(suturaRunId, 'Sutura run id');
  if (kind !== undefined && !KINDS.has(kind)) throw new Error(`Unknown capture kind: ${kind}`);
  if (capturedBy !== 'local' && capturedBy !== 'workflow') {
    throw new Error('capturedBy must be local or workflow');
  }
  const capturedAt = now().toISOString();
  const github = [];
  const record = (method, args, result) => {
    github.push({ sequence: github.length + 1, method, args, result });
    return result;
  };

  const rawRun = await api(`repos/${REPOSITORY}/actions/runs/${workflowRunId}`);
  const workflowRun = record('getWorkflowRun', [Number(workflowRunId)], mapWorkflowRun(rawRun));
  if (workflowRun.id !== Number(workflowRunId) || workflowRun.repository !== REPOSITORY) {
    throw new Error('GitHub returned a different workflow run');
  }
  if (!/^[a-f0-9]{40}$/u.test(workflowRun.headSha ?? '')) {
    throw new Error('Workflow run head_sha is not an exact lowercase commit');
  }
  if (typeof workflowRun.headBranch !== 'string' || workflowRun.headBranch.length === 0) {
    throw new Error('Workflow run head_branch is unavailable');
  }

  let branchDriftNote;
  let resolvedByPullRequest = false;
  if (workflowRun.event === 'pull_request' || workflowRun.event === 'workflow_dispatch') {
    let candidates = workflowRun.pullRequests;
    if (candidates.length === 0) {
      const associated = await api(
        `repos/${REPOSITORY}/commits/${workflowRun.headSha}/pulls?per_page=100`,
      );
      candidates = record(
        'listPullRequestsForCommit',
        [workflowRun.headSha],
        associated.map(({ number }) => ({ number })),
      );
    }
    const unique = [...new Set(candidates.map(({ number }) => number))];
    if (workflowRun.event === 'pull_request' &&
      (unique.length !== 1 || !Number.isSafeInteger(unique[0]) || (unique[0] ?? 0) <= 0)) {
      throw new Error('Could not resolve one pull request for the failing SHA');
    }
    if (unique.length === 1 && Number.isSafeInteger(unique[0])) {
      const rawPull = await api(`repos/${REPOSITORY}/pulls/${unique[0]}`);
      const pull = record('getPullRequest', [unique[0]], mapPullRequest(rawPull));
      const commit = await api(`repos/${REPOSITORY}/commits/${pull.baseSha}`);
      record('getCommitSha', [pull.baseSha], commit.sha);
      resolvedByPullRequest = true;
    }
  }
  if (!resolvedByPullRequest) {
    const ref = `heads/${workflowRun.headBranch}`;
    try {
      const current = await api(`repos/${REPOSITORY}/git/ref/${ref}`);
      const currentSha = current.object?.sha;
      if (currentSha !== workflowRun.headSha) {
        branchDriftNote = `branch ${workflowRun.headBranch} changed; getRefSha derived from immutable workflow run head_sha`;
      }
    } catch (error) {
      if (apiStatus(error) !== 404) throw error;
      branchDriftNote = `branch ${workflowRun.headBranch} no longer exists; getRefSha derived from immutable workflow run head_sha`;
    }
    record('getRefSha', [ref], workflowRun.headSha);
  }

  const rawJobs = await api(
    `repos/${REPOSITORY}/actions/runs/${workflowRunId}/jobs?filter=latest&per_page=100`,
  );
  const jobs = record('listJobsForWorkflowRun', [Number(workflowRunId)], mapJobs(rawJobs));
  for (const job of jobs) {
    if (!['failure', 'timed_out'].includes(job.conclusion ?? '')) continue;
    const log = asLog(await api(`repos/${REPOSITORY}/actions/jobs/${job.id}/logs`, { raw: true }));
    record('downloadJobLogs', [job.id], log);
  }

  const artifactBundle = await artifactReplayBundle(api, suturaRunId, targetRunId, loadArtifact);
  const http = artifactBundle?.http ?? [];
  const artifactBoundaries = artifactBundle
    ? completedReplayBoundaries(artifactBundle)
    : new Set();
  const capturedHttpBoundaries = new Set(
    [...artifactBoundaries].filter((boundary) =>
      boundary === 'nebius' || boundary === 'tavily' || boundary === 'contree'),
  );
  const pendingBoundaries = [
    'contree', 'executor', 'nebius', 'repository', 'tavily',
  ].filter((boundary) => !capturedHttpBoundaries.has(boundary));
  const bundle = {
    schemaVersion: BUNDLE_SCHEMA,
    runId: targetRunId,
    repo: REPOSITORY,
    actionSha: artifactBundle?.actionSha ?? workflowRun.headSha,
    capturedAt,
    github,
    repository: [],
    executor: [],
    http,
    configuration: artifactBundle?.configuration ?? replayConfiguration(),
    completeness: {
      complete: false,
      overflowedBoundaries: [],
      pendingBoundaries,
    },
  };
  const bundleBytes = Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`);
  if (bundleBytes.byteLength > MAX_BUNDLE_BYTES) {
    throw new Error('Captured replay bundle exceeds 16 MiB');
  }
  const fixtureDirectory = join(outDir, workflowRunId);
  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(join(fixtureDirectory, 'bundle.json'), bundleBytes);

  const boundaries = ['github', ...capturedHttpBoundaries].sort();
  const entry = {
    workflowRunId,
    targetRunId,
    ...(suturaRunId ? { suturaRunId } : {}),
    kind: kind ?? (workflowRun.conclusion === 'success' ? 'ci-success' : 'ci-failure'),
    headSha: workflowRun.headSha,
    capturedAt,
    source: capturedBy === 'workflow'
      ? `https://github.com/${REPOSITORY}/actions/runs/${workflowRunId}`
      : await captureSource(),
    capturedBy,
    bundleSha256: sha256(bundleBytes),
    boundaries,
    notes: branchDriftNote ? appendNote(notes, branchDriftNote) : notes,
  };
  const manifestPath = join(outDir, 'manifest.json');
  const manifest = await readManifest(manifestPath);
  manifest.entries = manifest.entries
    .filter(({ workflowRunId: existing }) => existing !== workflowRunId)
    .concat(entry)
    .sort((left, right) => Number(left.workflowRunId) - Number(right.workflowRunId));
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { bundle, entry };
}

async function main() {
  const options = parseCaptureArguments(process.argv.slice(2));
  const { entry } = await captureRun(options);
  process.stdout.write(`${entry.workflowRunId} ${entry.bundleSha256}\n`);
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
