import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeVerificationEvidence, encodeVerificationEvidence, parseVerificationEvidence } from './codec.js';
import { adaptLegacyVerification } from './legacy.js';
import type { VerificationEvidence } from './types.js';

const hash = 'a'.repeat(64);
function evidence(): VerificationEvidence {
  return {
    schemaVersion: 'sutura-verification-evidence-v1',
    mode: 'local', outcome: 'insufficient', assurance: 'baseline-only',
    identity: {
      sourceSha: 'a'.repeat(40), snapshotSha256: hash,
      policyBaseSha: 'b'.repeat(40), policySha256: hash, diffSha256: hash,
      corpusRevision: null, fixtureRevision: null, imageDigest: `sha256:${hash}`,
      routingVersion: 'fixed-v1', challengeVersion: 'protocol-v1',
    },
    startedAt: '2026-09-05T10:00:00.000Z', finishedAt: '2026-09-05T10:00:01.000Z',
    commands: ['node --test'], models: [],
    challenges: { mode: 'required', qualifiedProbeCount: 0 },
    gates: [
      { gate: 'policy', status: 'passed', reasons: [], artifacts: [{ id: 'policy-check', sha256: hash }] },
      { gate: 'visible', status: 'passed', reasons: [], artifacts: [{ id: 'visible-run', sha256: hash }] },
      { gate: 'audit', status: 'not-run', reasons: ['not-executed'], artifacts: [] },
      { gate: 'challenges', status: 'insufficient', reasons: ['missing-contract'], artifacts: [] },
    ],
    costs: { schemaVersion: 'sutura-verification-cost-v1', inference: [], sandbox: [
      { operationId: 'run-1', rawAmount: 0.2, rawUnit: null, unitSource: null, billed: null },
    ], wallTimeMs: 1000 },
  };
}

describe('verification evidence v1', () => {
  it('round trips with exact byte integrity distinct from comparison identity', () => {
    const original = evidence();
    const encoded = encodeVerificationEvidence(original);
    expect(encoded.integritySha256).toBe(createHash('sha256').update(encoded.bytes).digest('hex'));
    expect(decodeVerificationEvidence(encoded, original.identity)).toEqual(original);
    const changed = evidence();
    changed.costs.wallTimeMs = 2000;
    changed.finishedAt = '2026-09-05T10:00:02.000Z';
    const second = encodeVerificationEvidence(changed);
    expect(second.integritySha256).not.toBe(encoded.integritySha256);
    expect(second.normalizedComparisonSha256).toBe(encoded.normalizedComparisonSha256);
    expect(() => decodeVerificationEvidence({ ...encoded, bytes: second.bytes }, original.identity)).toThrow(/integrity/);
  });

  it('rejects identity substitution even with a recomputed integrity hash', () => {
    const original = evidence();
    const changed = evidence();
    changed.identity.policyBaseSha = 'c'.repeat(40);
    expect(() => decodeVerificationEvidence(encodeVerificationEvidence(changed), original.identity)).toThrow(/identity/);
  });

  it.each([
    (v: VerificationEvidence) => { v.identity.diffSha256 = 'invalid'; },
    (v: VerificationEvidence) => { Object.assign(v, { schemaVersion: 'v0' }); },
    (v: VerificationEvidence) => { delete (v.gates[0] as Partial<typeof v.gates[number]>).status; },
    (v: VerificationEvidence) => { v.gates[0]!.artifacts = []; },
    (v: VerificationEvidence) => { v.costs.sandbox![0]!.rawUnit = 'USD'; },
    (v: VerificationEvidence) => { Object.assign(v.costs, { totalUsd: 0.2 }); },
    (v: VerificationEvidence) => { v.outcome = 'verified-supplied-patch'; },
    (v: VerificationEvidence) => { Object.assign(v, { hiddenExpectedValues: [3] }); },
    (v: VerificationEvidence) => { v.commands = ['Authorization: Bearer secret']; },
    (v: VerificationEvidence) => { v.gates.push(v.gates[0]!); },
  ])('rejects malformed or overstated evidence %#', (mutate) => {
    const value = evidence(); mutate(value);
    expect(() => parseVerificationEvidence(value)).toThrow();
  });

  it('accepts fully executed required challenges and preserves each gate', () => {
    const value = evidence();
    value.challenges.qualifiedProbeCount = 1;
    value.outcome = 'verified-supplied-patch'; value.assurance = 'contract-verified';
    value.gates = value.gates.map((gate) => ({ ...gate, status: 'passed', reasons: [], artifacts: [{ id: `${gate.gate}-run`, sha256: hash }] }));
    expect(parseVerificationEvidence(value)).toEqual(value);
  });

  it('retains model purpose, requested/returned IDs, usage and dated prices', () => {
    const value = evidence();
    value.models = [{ purpose: 'challenge-generation', tier: 'super', requestedModel: 'requested', returnedModel: 'returned' }];
    value.costs.inference = [{ modelIndex: 0, inputTokens: 100, outputTokens: 10, reasoningTokens: 2,
      estimateUsd: 0.0000408, price: { inputPerMillionUsd: 0.3, outputPerMillionUsd: 0.9, asOf: '2026-08-27', source: 'https://example.com/prices' } }];
    expect(parseVerificationEvidence(value).costs.inference![0]!.estimateUsd).toBe(0.0000408);
    value.costs.inference[0]!.estimateUsd = 42;
    expect(() => parseVerificationEvidence(value)).toThrow(/estimate/);
  });

  it.each(['insufficient', 'infra-stop', 'not-run'] as const)('never accepts incomplete retained optional probes: %s', (status) => {
    const value = evidence();
    value.outcome = 'repaired';
    value.challenges = { mode: 'optional', qualifiedProbeCount: 1 };
    value.gates = value.gates.map((gate) => gate.gate === 'challenges'
      ? { ...gate, status }
      : { ...gate, status: 'passed', reasons: [], artifacts: [{ id: gate.gate, sha256: hash }] });
    expect(() => parseVerificationEvidence(value)).toThrow(/challenges/);
  });

  it('labels disabled challenges as baseline-only with an explicit not-run observation', () => {
    const value = evidence();
    Object.assign(value.challenges, { mode: 'disabled' });
    value.gates[3] = { gate: 'challenges', status: 'not-run', reasons: ['not-executed'], artifacts: [] };
    expect(parseVerificationEvidence(value).assurance).toBe('baseline-only');
  });

  it('rejects a passed challenge with no qualified probe even on a nonaccepted outcome', () => {
    const value = evidence();
    value.gates[3] = { gate: 'challenges', status: 'passed', reasons: [], artifacts: [{ id: 'fake-pass', sha256: hash }] };
    expect(() => parseVerificationEvidence(value)).toThrow(/qualified/);
  });

  it('represents unavailable runtime identity in terminal insufficient evidence without inventing a digest', () => {
    const value = evidence();
    Object.assign(value.identity, { imageDigest: null, snapshotSha256: null, diffSha256: null });
    expect(decodeVerificationEvidence(encodeVerificationEvidence(value), value.identity).identity)
      .toMatchObject({ imageDigest: null, snapshotSha256: null, diffSha256: null });
  });

  it.each(['imageDigest', 'snapshotSha256', 'diffSha256'])('requires %s for an accepted candidate', (key) => {
    const value = evidence();
    value.outcome = 'repaired'; value.assurance = 'contract-verified';
    value.challenges.qualifiedProbeCount = 1;
    value.gates = value.gates.map((gate) => ({ ...gate, status: 'passed', reasons: [], artifacts: [{ id: gate.gate, sha256: hash }] }));
    Object.assign(value.identity, { [key]: null });
    expect(() => parseVerificationEvidence(value)).toThrow(/identity/);
  });
});

describe('legacy evidence adapter', () => {
  it('rejects unknown runtime schema discriminators', () => {
    expect(() => adaptLegacyVerification('{"outcome":"audit-approved"}', 'audit-file-v1' as never)).toThrow(/schema/u);
  });
  it('does not infer challenge or repair-quality truth from a successful historical case', () => {
    const bytes = JSON.stringify({ outcome: 'fixed', stages: [{ metrics: { cost: 5 } }], cost: { entries: [{ usd: 0.1 }] } });
    const adapted = adaptLegacyVerification(bytes, 'case-file-v0');
    expect(adapted).toMatchObject({ originalOutcome: 'fixed', challengeStatus: 'absent', assurance: 'baseline-only', datasetTruth: 'unknown', sandboxRawAmounts: [5], sandboxUnit: null });
    expect(adapted.originalBytes).toBe(bytes);
  });

  it('keeps log-only audits reduced assurance without inventing execution', () => {
    expect(adaptLegacyVerification('{"assurance":"reduced","outcome":"audit-approved"}', 'audit-file-v0'))
      .toMatchObject({ assurance: 'reduced-log-only', challengeStatus: 'absent', sandboxRawAmounts: [], sandboxUnit: null });
  });
});
