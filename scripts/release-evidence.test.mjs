import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { contentHash } from './evidence-contract.mjs';

import {
  analyzeReleaseEvidence,
  assertReleaseReady,
  createGitHubEvidenceVerifier,
  main,
  verifyDogfoodStreak,
} from './release-evidence.mjs';

const SHA = 'c'.repeat(40);

function remoteEvidence(index) {
  const runId = String(1000 + index);
  const artifactName = `release-evidence-${runId}.json`;
  return {
    reference: `https://github.com/juan294/sutura/actions/runs/${runId}`,
    contentHash: createHash('sha256').update(`artifact-${runId}`).digest('hex'),
    candidate: SHA,
    runId,
    artifactName,
  };
}

const remoteVerifier = ({ runId, artifactName }) => ({
  headSha: SHA,
  artifactName,
  artifactBytes: Buffer.from(`artifact-${runId}`),
});

function analyze(value) {
  return analyzeReleaseEvidence(value, { verifyRemoteEvidence: remoteVerifier });
}

function evidence(overrides = {}) {
  return {
    releaseCommit: SHA,
    checks: [
      { id: 'local-gate', required: true, status: 'passed', candidate: SHA, evidence: [remoteEvidence(1)] },
      { id: 'candidate-matrix', required: true, status: 'passed', candidate: SHA, evidence: [remoteEvidence(2)] },
      { id: 'public-matrix', required: true, status: 'pending', candidate: SHA, evidence: [], authorizationGate: 'public artifact matrix' },
      { id: 'npm', required: true, status: 'pending', candidate: SHA, evidence: [], authorizationGate: 'npm publication' },
      { id: 'marketplace', required: true, status: 'pending', candidate: SHA, evidence: [], authorizationGate: 'Marketplace publication' },
      { id: 'github-release', required: true, status: 'pending', candidate: SHA, evidence: [], authorizationGate: 'tag and GitHub release' },
      { id: 'demo', required: true, status: 'pending', candidate: SHA, evidence: [], authorizationGate: 'demo repository and provider credits' },
      { id: 'dogfood', required: true, status: 'pending', candidate: SHA, evidence: [], authorizationGate: 'live-dogfood-streak' },
      { id: 'benchmark', required: true, status: 'pending', candidate: SHA, evidence: [], authorizationGate: 'live provider benchmark' },
      { id: 'feedback', required: true, status: 'passed', candidate: SHA, evidence: [remoteEvidence(3)] },
      { id: 'devpost', required: true, status: 'pending', candidate: SHA, evidence: [], authorizationGate: 'Devpost update' },
    ],
    ...overrides,
  };
}

test('records real authorization gates as pending and cannot declare release readiness', () => {
  const report = analyze(evidence());
  assert.equal(report.passedCount, 3);
  assert.equal(report.ready, false);
  assert.deepEqual(report.requiredMisses, [
    'benchmark', 'demo', 'devpost', 'dogfood', 'github-release', 'marketplace', 'npm', 'public-matrix',
  ]);
  assert.match(report.resultHash, /^[a-f0-9]{64}$/u);
  assert.throws(() => assertReleaseReady(report), /not ready/u);
});

test('dogfood evidence requires 10 trailing fixed entries on one matching packages tree', async () => {
  const tree = 'b'.repeat(40);
  const entry = (index, overrides = {}) => ({
    attempt: index,
    ciRunId: String(1000 + index),
    suturaRunId: String(2000 + index),
    prUrl: `https://github.com/juan294/sutura/pull/${index}`,
    dogfoodSha: index.toString(16).padStart(40, '0'),
    outcome: 'fixed',
    actionSha: 'a'.repeat(40),
    packagesTreeHash: tree,
    sandboxUsd: 0.2,
    inferenceUsd: 0.3,
    bundleSha256: 'd'.repeat(64),
    recordedAt: new Date(Date.parse('2026-08-30T08:00:00.000Z') + index).toISOString(),
    ...overrides,
  });
  const ledger = (entries) => ({
    schemaVersion: 'sutura-dogfood-ledger-v1',
    entries,
    resultHash: contentHash(entries),
  });
  assert.equal(verifyDogfoodStreak(ledger(Array.from({ length: 9 }, (_, index) => entry(index + 1))), SHA, {
    packagesTreeHash: tree,
    actionPackagesTreeHash: tree,
  }).status, 'pending');
  const passed = verifyDogfoodStreak(ledger(Array.from({ length: 10 }, (_, index) => entry(index + 1))), SHA, {
    packagesTreeHash: tree,
    actionPackagesTreeHash: tree,
  });
  assert.equal(passed.status, 'passed');
  assert.deepEqual(passed.evidence[0], {
    reference: 'docs/demo/dogfood-ledger.json',
    contentHash: passed.evidence[0].contentHash,
    candidate: SHA,
  });
  assert.match(passed.evidence[0].contentHash, /^[a-f0-9]{64}$/u);
  assert.equal(verifyDogfoodStreak(ledger(Array.from({ length: 10 }, (_, index) =>
    entry(index + 1, index === 4 ? { packagesTreeHash: 'c'.repeat(40) } : {}))), SHA, {
    packagesTreeHash: tree,
    actionPackagesTreeHash: tree,
  }).status, 'pending');
  const splitCandidates = [
    ...Array.from({ length: 5 }, (_, index) => entry(index + 1, {
      actionSha: 'e'.repeat(40),
      ciRunId: String(3000 + index),
      suturaRunId: String(4000 + index),
      dogfoodSha: (100 + index).toString(16).padStart(40, '0'),
      prUrl: `https://github.com/juan294/sutura/pull/${100 + index}`,
    })),
    ...Array.from({ length: 5 }, (_, index) => entry(index + 1, {
      ciRunId: String(5000 + index),
      suturaRunId: String(6000 + index),
      dogfoodSha: (200 + index).toString(16).padStart(40, '0'),
      prUrl: `https://github.com/juan294/sutura/pull/${200 + index}`,
    })),
  ];
  assert.equal(verifyDogfoodStreak(ledger(splitCandidates), SHA, {
    packagesTreeHash: tree,
    actionPackagesTreeHash: tree,
  }).status, 'pending');

  const directory = await mkdtemp(join(tmpdir(), 'sutura-dogfood-status-'));
  try {
    const path = join(directory, 'ledger.json');
    await writeFile(path, JSON.stringify(ledger([])));
    let output = '';
    const result = await main(['dogfood-status', '--ledger', path, '--candidate', SHA], {
      packagesTreeHash: tree,
      actionPackagesTreeHash: tree,
      stdout: { write: (value) => { output += value; } },
    });
    assert.equal(result.status, 'pending');
    assert.match(output, /live-dogfood-streak/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('requires at least one pass, complete required evidence, and one exact candidate', () => {
  assert.throws(() => analyze(evidence({ checks: [] })), /at least one check/u);
  assert.throws(() => analyze(evidence({
    checks: [{ id: 'only', required: true, status: 'failed', candidate: SHA, evidence: [] }],
  })), /at least one passed/u);
  assert.throws(() => analyze(evidence({
    checks: evidence().checks.map((check, index) => index === 0
      ? { ...check, candidate: 'd'.repeat(40) }
      : check),
  })), /candidate/u);
  assert.throws(() => analyze(evidence({
    checks: evidence().checks.map((check, index) => index === 0
      ? { ...check, evidence: [] }
      : check),
  })), /passed check.*evidence/u);
});

test('approves only a complete release set and hashes it deterministically', () => {
  const complete = evidence({
    checks: evidence().checks.map((check, index) => ({
      ...check, status: 'passed', evidence: [remoteEvidence(index + 1)],
      authorizationGate: undefined,
    })),
  });
  const first = analyze(complete);
  const second = analyze({ ...complete, checks: [...complete.checks].reverse() });
  assert.equal(first.ready, true);
  assert.equal(first.resultHash, second.resultHash);
  assert.doesNotThrow(() => assertReleaseReady(first));
});

test('verifies local content hashes and candidate-bound public run identities', async () => {
  const reference = 'docs/demo/sutura-v0.2.0-release-evidence-requirements.json';
  const contentHash = createHash('sha256').update(await readFile(reference)).digest('hex');
  const value = evidence();
  value.checks[0].evidence = [{ reference, contentHash, candidate: SHA }];
  assert.doesNotThrow(() => analyze(value));
  value.checks[0].evidence[0].contentHash = 'f'.repeat(64);
  assert.throws(() => analyze(value), /content hash/u);
  value.checks[0].evidence = [{
    reference: 'https://github.com/juan294/sutura/actions/runs/42',
    contentHash,
    candidate: 'd'.repeat(40),
    runId: '42',
  }];
  assert.throws(() => analyze(value), /candidate/u);
  const remote = evidence();
  assert.throws(() => analyzeReleaseEvidence(remote), /verifier/u);
  assert.throws(() => analyzeReleaseEvidence(remote, {
    verifyRemoteEvidence: ({ runId, artifactName }) => ({
      headSha: 'd'.repeat(40), artifactName, artifactBytes: Buffer.from(`artifact-${runId}`),
    }),
  }), /run candidate/u);
});

test('production verifier reads exact run metadata and one named artifact through an injectable API', () => {
  const calls = [];
  const artifactBytes = Buffer.from('verified archive');
  const verifier = createGitHubEvidenceVerifier((endpoint, binary) => {
    calls.push([endpoint, binary]);
    if (endpoint.endsWith('/artifacts?per_page=100')) {
      return JSON.stringify({
        total_count: 1,
        artifacts: [{ id: 77, name: 'release-proof', expired: false }],
      });
    }
    if (endpoint.endsWith('/artifacts/77/zip')) return artifactBytes;
    return JSON.stringify({ head_sha: SHA });
  });
  const expected = {
    headSha: SHA,
    artifactName: 'release-proof',
    artifactBytes,
  };
  assert.deepEqual(verifier({ runId: '42', artifactName: 'release-proof' }), expected);
  assert.deepEqual(verifier({ runId: '42', artifactName: 'release-proof' }), expected);
  assert.deepEqual(calls, [
    ['repos/juan294/sutura/actions/runs/42', false],
    ['repos/juan294/sutura/actions/runs/42/artifacts?per_page=100', false],
    ['repos/juan294/sutura/actions/artifacts/77/zip', true],
  ]);
});

test('CLI validates bounded input before exclusively writing a deterministic manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-release-evidence-'));
  const input = join(directory, 'input.json');
  const output = join(directory, 'output.json');
  try {
    await writeFile(input, JSON.stringify(evidence()));
    const manifest = await main(['--input', input, '--output', output], {
      verifyRemoteEvidence: remoteVerifier,
    });
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), manifest);
    await assert.rejects(() => main(['--input', input, '--output', output], {
      verifyRemoteEvidence: remoteVerifier,
    }), /exist/u);
    await writeFile(input, Buffer.alloc(1024 * 1024 + 1));
    await assert.rejects(() => main(['--input', input, '--output', join(directory, 'large.json')]), /exceed/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
