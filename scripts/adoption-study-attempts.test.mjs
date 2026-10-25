import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTEMPT_LEDGER_SCHEMA } from './review-study.mjs';
import { summarizeAdoptionAttempts } from './adoption-study-attempts.mjs';
const attempt = (id, overrides = {}) => ({ schemaVersion: ATTEMPT_LEDGER_SCHEMA, participantId: `participant-${id.toString(16).padStart(8, '0')}`,
  consent: true, outcome: 'completed', taskId: 'repository-setup', journey: {
    cohort: 'independent-newcomer', profile: 'node', interestAt: '2026-10-25T08:00:00.000Z', observedAt: '2026-10-25T12:00:00.000Z',
    activeSetupMs: 1_200_000, accessWaitMs: 10_000_000, blockingStatus: 'none', authorInterventions: 0, manualConfigurationCount: 2,
    resultKind: 'readiness', resultUnderstood: true, limitExplainedBeforePaid: null,
    artifact: { installSource: 'public-npm-and-immutable-action', packageVersion: '0.3.9', actionCommit: 'a'.repeat(40) },
    costs: { inferenceUsd: null, sandboxUsd: null, runnerUsd: null }, ...overrides,
  } });
test('retains failed, blocked, withdrawn and assisted attempts in the independent denominator', () => {
  const values = [attempt(1), { ...attempt(2, { blockingStatus: 'provider-access', resultKind: null, resultUnderstood: null }), outcome: 'failed' },
    { ...attempt(3, { activeSetupMs: null, resultKind: null, resultUnderstood: null }), consent: false, outcome: 'withdrawn' },
    attempt(4, { authorInterventions: 1 }), { ...attempt(5), outcome: 'started' }];
  const result = summarizeAdoptionAttempts(values);
  assert.equal(result.totalAttempts, 5);
  assert.equal(result.cohorts['independent-newcomer'].attempts, 5);
  assert.equal(result.cohorts['independent-newcomer'].blocked, 1);
  assert.equal(result.cohorts['independent-newcomer'].assisted, 1);
  assert.equal(result.cohorts['independent-newcomer'].outcomes.withdrawn, 1);
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.verifiedRepairPath, 'unmeasured');
});
test('separates rehearsal and historical assisted cohorts from newcomer measurements', () => {
  const result = summarizeAdoptionAttempts([attempt(1, { cohort: 'synthetic-rehearsal', artifact: { installSource: 'local-rehearsal', packageVersion: null, actionCommit: null } }),
    attempt(2, { cohort: 'existing-assisted', authorInterventions: 2 })]);
  assert.equal(result.cohorts['independent-newcomer'].attempts, 0);
  assert.equal(result.status, 'unmeasured');
  assert.equal(result.totalAttempts, 2);
});
test('reports two clocks, measured cost coverage, unaided target and unsupported explanation separately', () => {
  const result = summarizeAdoptionAttempts([attempt(1), attempt(2, { profile: 'unsupported', resultKind: 'refusal', limitExplainedBeforePaid: true,
    costs: { inferenceUsd: 0, sandboxUsd: 0, runnerUsd: null } }), attempt(3, { authorInterventions: 1 })]);
  const cohort = result.cohorts['independent-newcomer'];
  assert.deepEqual(cohort.elapsedFromInterestMs, [14_400_000, 14_400_000, 14_400_000]);
  assert.deepEqual(cohort.activeSetupMs, [1_200_000, 1_200_000, 1_200_000]);
  assert.equal(cohort.supportedUnaidedUsefulWithin30Minutes, 1);
  assert.equal(cohort.unsupportedExplainedBeforePaid, 1);
  assert.equal(result.costs.totalUsd, null);
  assert.equal(result.costs.components.inferenceUsd.measuredAttempts, 1);
  assert.equal(result.costs.components.runnerUsd.measuredAttempts, 0);
});
test('refuses changed denominators, invalid clocks and a development artifact mislabeled public', () => {
  assert.throws(() => summarizeAdoptionAttempts([attempt(1), attempt(1)]), /duplicate|once/u);
  assert.throws(() => summarizeAdoptionAttempts([attempt(1, { activeSetupMs: 50_000_000 })]), /active/u);
  assert.throws(() => summarizeAdoptionAttempts([attempt(1, { observedAt: '2026-02-30T12:00:00.000Z' })]), /instant/u);
  assert.throws(() => summarizeAdoptionAttempts([attempt(1, { artifact: { installSource: 'local-rehearsal', packageVersion: null, actionCommit: null } })]), /public/u);
});
test('empty study is unmeasured, output has no participant identities or free text, and hashing is deterministic', () => {
  assert.equal(summarizeAdoptionAttempts([]).status, 'unmeasured');
  const a = attempt(1); a.contact = 'SECRET_CONTACT'; a.journey.note = 'SECRET_NOTE';
  const result = summarizeAdoptionAttempts([a]);
  assert.doesNotMatch(JSON.stringify(result), /participant-|SECRET_CONTACT|SECRET_NOTE/);
  assert.deepEqual(result, summarizeAdoptionAttempts([a]));
});
