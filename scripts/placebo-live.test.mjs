import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  appendPlaceboLedger,
  assertPublicArtifactSafe,
  createPlaceboCaseArtifact,
  createPlaceboLedger,
  finalizePlaceboEvidence,
  placeboSpendDecision,
  redactPublicArtifact,
  runPlaceboStreak,
  validatePlaceboCaseArtifact,
  validatePlaceboLedger,
} from './placebo-live.mjs';

const CONTROLLER_SHA = 'a'.repeat(40);
const SUBJECT_SHA = 'a943ded4c734aed75c5c63f2b2dd63a2f44556c2';
const PACKAGE_HASH = '999e189d91dc52383361e739f075056622308da6360b5d9187fea8f303330572';
const PACKAGE_INTEGRITY = '6365ab9af9cfcef0cdfe1441b95c9de2ff504e2181e77fdf5669ff92eef3937f';
const RECORDED_AT = '2026-08-31T12:00:00.000Z';
const corpus = JSON.parse(await readFile('docs/demo/placebo-v0.2-corpus.json', 'utf8'));

test('v0.2.1 controller state is ignored before the lock-protected gate runs', async () => {
  const ignore = await readFile('.gitignore', 'utf8');
  assert.match(ignore, /^\.sutura\/placebo-v0\.2\.1-live-ledger\.json$/mu);
  assert.match(ignore, /^\.sutura\/placebo-v0\.2\.1-live\.lock$/mu);
  assert.match(ignore, /^\.sutura\/placebo-v0\.2\.1-live-artifacts\/$/mu);
  assert.match(ignore, /^\.sutura\/placebo-v0\.2\.1-failed-runs\/$/mu);
});

function result(corpusCase, tavilyEnabled = true, overrides = {}) {
  return {
    caseId: corpusCase.id,
    kind: corpusCase.metadata.kind,
    language: corpusCase.metadata.language,
    tavilyEnabled,
    elapsedTimeMs: 1_000,
    caseFile: {
      outcome: corpusCase.metadata.kind === 'trap' ? 'refused' :
        corpusCase.metadata.kind === 'flaky' ? 'flaky-no-patch' : 'fixed',
      audit: {
        approved: corpusCase.metadata.kind !== 'trap', checks: [], reasoning: 'fixture',
      },
      cost: { entries: [{ role: 'super', model: 'model', inTok: 1, outTok: 1, reasoningTok: 0, usd: 0.01 }] },
      stages: [{
        stage: 'reproduction', attempt: 1, nodeId: 'node-001', metrics: { cost: 0.02 },
        network: 'disabled', operationId: `operation-${corpusCase.id}`,
      }],
      trace: [{ type: 'run-finish', stage: 'run', outcome: 'fixed' }],
      ...overrides,
    },
  };
}

function artifact(caseId, overrides = {}) {
  const corpusCase = corpus.cases.find((value) => value.id === caseId);
  const caseIndex = corpus.cases.findIndex((value) => value.id === caseId);
  const results = corpusCase.metadata.kind === 'upstream'
    ? [result(corpusCase, true), result(corpusCase, false)]
    : [result(corpusCase)];
  return createPlaceboCaseArtifact({
    controllerSha: CONTROLLER_SHA,
    githubRunId: String(1000 + caseIndex),
    subjectVersion: '0.2.1',
    subjectSha: SUBJECT_SHA,
    packageContentHash: PACKAGE_HASH,
    packageIntegrity: PACKAGE_INTEGRITY,
    caseId,
    results,
    evaluationManifest: {
      schemaVersion: 'sutura-evaluation-v1', suturaCommit: CONTROLLER_SHA,
      corpusHash: corpus.corpusHash, cases: results.map(({ tavilyEnabled }) => ({
        caseId: `${caseId}:${tavilyEnabled ? 'with-tavily' : 'without-tavily'}`,
      })),
    },
    artifactName: `sutura-placebo-live-test-${caseId}`,
    ...overrides,
  }, { corpus });
}

function append(ledger, value, index) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  return appendPlaceboLedger(ledger, value, {
    artifactBytes: bytes,
    runUrl: `https://github.com/juan294/sutura/actions/runs/${value.githubRunId}`,
    recordedAt: new Date(Date.parse(RECORDED_AT) + index).toISOString(),
  }, { corpus });
}

test('case artifacts bind exact identities, costs, and one canonical case', () => {
  const value = artifact('repair-off-by-one');
  assert.equal(value.evaluationCount, 1);
  assert.equal(value.inferenceUsd, 0.01);
  assert.equal(value.sandboxUsd, 0.02);
  assert.equal(value.totalUsd, 0.03);
  assert.match(value.resultHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(validatePlaceboCaseArtifact(value, { corpus }), value);
  assert.throws(() => validatePlaceboCaseArtifact({ ...value, subjectSha: CONTROLLER_SHA }, { corpus }), /resultHash|subject/u);
  assert.throws(() => createPlaceboCaseArtifact({
    ...value, caseId: 'unknown-case', evaluationManifest: {
      schemaVersion: 'sutura-evaluation-v1', suturaCommit: CONTROLLER_SHA,
      corpusHash: corpus.corpusHash, cases: value.results.map(({ tavilyEnabled }) => ({
        caseId: `unknown-case:${tavilyEnabled ? 'with-tavily' : 'without-tavily'}`,
      })),
    },
  }, { corpus }), /canonical case/u);
});

test('public artifact safety rejects credential values and private local paths', () => {
  assert.equal(assertPublicArtifactSafe({ result: 'safe' }).result, 'safe');
  assert.throws(() => assertPublicArtifactSafe({ value: 'secret-value' }, ['secret-value']), /credential/u);
  assert.throws(() => assertPublicArtifactSafe({ path: '/Users/person/private' }), /private local path/u);
});

test('public artifact redaction removes sensitive strings before fail-closed validation', () => {
  const input = {
    diagnosis: 'Authorization: Bearer bearer-token /Users/person/private secret-value',
    trace: [
      'C:\\Users\\person\\private',
      'github_pat_abcdefghijklmnopqrstuvwxyz',
      'sk-abcdefghijklmnopqrstuvwxyz',
    ],
  };
  const redacted = redactPublicArtifact(input, ['secret-value']);
  assert.deepEqual(redacted.summary, { credentialValues: 4, privatePaths: 2 });
  assert.doesNotMatch(JSON.stringify(redacted.value), /secret-value|\/Users\/person|C:\\Users\\person|github_pat_|sk-/u);
  assert.equal(redacted.value.diagnosis.endsWith('[REDACTED_PRIVATE_PATH] [REDACTED_CREDENTIAL]'), true);
  assert.equal(redacted.value.trace[0], '[REDACTED_PRIVATE_PATH]');
  assert.deepEqual(assertPublicArtifactSafe(redacted.value, ['secret-value']), redacted.value);
  assert.equal(input.diagnosis.endsWith('secret-value'), true);
});

test('case artifacts bind a deterministic public redaction summary', () => {
  const value = artifact('repair-off-by-one', {
    redactions: { credentialValues: 2, privatePaths: 1 },
  });
  assert.deepEqual(value.redactions, { credentialValues: 2, privatePaths: 1 });
  assert.deepEqual(validatePlaceboCaseArtifact(value, { corpus }), value);
  assert.throws(() => validatePlaceboCaseArtifact({
    ...value, redactions: { credentialValues: -1, privatePaths: 0 },
  }, { corpus }), /redaction summary/u);
});

test('upstream artifacts require their exact Tavily pair', () => {
  const value = artifact('upstream-client-release');
  assert.equal(value.evaluationCount, 2);
  assert.deepEqual(value.results.map(({ tavilyEnabled }) => tavilyEnabled), [true, false]);
  assert.throws(() => createPlaceboCaseArtifact({
    ...value, results: value.results.slice(0, 1), evaluationManifest: {
      schemaVersion: 'sutura-evaluation-v1', suturaCommit: CONTROLLER_SHA,
      corpusHash: corpus.corpusHash,
      cases: [{ caseId: `${value.caseId}:with-tavily` }],
    },
  }, { corpus }), /Tavily pair/u);
});

test('ledger append is deterministic, resumable, and mutation-safe', () => {
  const first = artifact('flaky-timer-race');
  const second = artifact('repair-off-by-one');
  const once = append(createPlaceboLedger([]), first, 1);
  const twice = append(once, second, 2);
  assert.deepEqual(validatePlaceboLedger(twice), twice);
  assert.equal(twice.entries.length, 2);
  assert.throws(() => append(twice, first, 3), /duplicate/u);
  assert.throws(() => validatePlaceboLedger({
    ...twice,
    entries: [{ ...twice.entries[0], caseId: 'repair-missing-await' }, ...twice.entries.slice(1)],
  }), /resultHash/u);
});

test('spend reserve stops before dispatch can exceed the cap', () => {
  assert.deepEqual(placeboSpendDecision({ spentUsd: 1, observedMaximumUsd: 0.4, initialReserveUsd: 0.5, capUsd: 1.5 }), {
    reserveUsd: 0.5, mayDispatch: true,
  });
  assert.deepEqual(placeboSpendDecision({ spentUsd: 1.1, observedMaximumUsd: 0.6, initialReserveUsd: 0.5, capUsd: 1.5 }), {
    reserveUsd: 0.6, mayDispatch: false,
  });
});

test('streak resumes and stops immediately after a false approval', async () => {
  const ids = ['flaky-timer-race', 'trap-skipped-test', 'repair-off-by-one'];
  let ledger = createPlaceboLedger([]);
  const dispatched = [];
  const resultValue = await runPlaceboStreak({
    controllerSha: CONTROLLER_SHA, subjectSha: SUBJECT_SHA, authorize: true,
    capUsd: 10, initialReserveUsd: 0.5, caseIds: ids,
  }, {
    readLedger: async () => ledger,
    runCase: async (caseId) => {
      dispatched.push(caseId);
      const value = caseId === 'trap-skipped-test'
        ? artifact(caseId, { results: [result(corpus.cases.find(({ id }) => id === caseId), true, {
            outcome: 'fixed', audit: { approved: true, checks: [], reasoning: 'unsafe' },
          })] })
        : artifact(caseId);
      ledger = append(ledger, value, dispatched.length);
      return { artifact: value, ledger };
    },
  });
  assert.deepEqual(dispatched, ['flaky-timer-race', 'trap-skipped-test']);
  assert.equal(resultValue.stoppedFor, 'false-approval');
});

test('streak stops immediately after an infrastructure stop', async () => {
  const ids = ['python-flaky-timer', 'repair-off-by-one'];
  let ledger = createPlaceboLedger([]);
  const dispatched = [];
  const resultValue = await runPlaceboStreak({
    controllerSha: CONTROLLER_SHA, subjectSha: SUBJECT_SHA, authorize: true,
    capUsd: 10, initialReserveUsd: 0.5, caseIds: ids,
  }, {
    readLedger: async () => ledger,
    runCase: async (caseId) => {
      dispatched.push(caseId);
      const value = artifact(caseId, { results: [result(corpus.cases.find(({ id }) => id === caseId), true, {
        outcome: 'infra-stop', audit: { approved: false, checks: [], reasoning: 'infrastructure' },
      })] });
      ledger = append(ledger, value, dispatched.length);
      return { artifact: value, ledger };
    },
  });
  assert.deepEqual(dispatched, ['python-flaky-timer']);
  assert.equal(resultValue.stoppedFor, 'infra-stop');
});

test('streak never dispatches after resuming an infrastructure-stop ledger', async () => {
  const caseId = 'python-flaky-timer';
  const value = artifact(caseId, { results: [result(corpus.cases.find(({ id }) => id === caseId), true, {
    outcome: 'infra-stop', audit: { approved: false, checks: [], reasoning: 'infrastructure' },
  })] });
  const ledger = append(createPlaceboLedger([]), value, 1);
  const resultValue = await runPlaceboStreak({
    controllerSha: CONTROLLER_SHA, subjectSha: SUBJECT_SHA, authorize: true,
    capUsd: 10, initialReserveUsd: 0.5, caseIds: [caseId, 'repair-off-by-one'],
  }, {
    readLedger: async () => ledger,
    runCase: async () => { throw new Error('must not dispatch'); },
  });
  assert.equal(resultValue.stoppedFor, 'infra-stop');
  assert.equal(resultValue.ledger.entries.length, 1);
});

test('streak refuses to resume a ledger from another controller', async () => {
  const value = artifact('repair-off-by-one');
  const ledger = append(createPlaceboLedger([]), value, 1);
  const changed = createPlaceboLedger(ledger.entries.map((entry) => ({
    ...entry, controllerSha: 'b'.repeat(40),
  })));
  await assert.rejects(() => runPlaceboStreak({
    controllerSha: CONTROLLER_SHA, subjectSha: SUBJECT_SHA, authorize: true,
    capUsd: 10, initialReserveUsd: 0.5, caseIds: ['repair-bad-import'],
  }, {
    readLedger: async () => changed,
    runCase: async () => { throw new Error('must not dispatch'); },
  }), /identity differs/u);
});

test('finalizer requires all 51 cases and 55 retained evaluations', async () => {
  const artifacts = corpus.cases.map(({ id }) => artifact(id));
  let ledger = createPlaceboLedger([]);
  artifacts.forEach((value, index) => { ledger = append(ledger, value, index + 1); });
  const finalized = await finalizePlaceboEvidence(ledger, artifacts, {
    corpus,
    scoreResults: (results) => ({ retained: results.length }),
  });
  assert.equal(finalized.caseCount, 51);
  assert.equal(finalized.evaluationCount, 55);
  assert.deepEqual(finalized.score, { retained: 55 });
  await assert.rejects(() => finalizePlaceboEvidence(
    createPlaceboLedger(ledger.entries.slice(0, 50)), artifacts.slice(0, 50), {
      corpus, scoreResults: () => ({}),
    },
  ), /51 canonical cases/u);
});
