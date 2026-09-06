import { describe, expect, it } from 'vitest';

import {
  assertNoForbiddenMetadata,
  blindExecutedRecord,
  BlindingError,
  FORBIDDEN_BLINDED_KEYS,
  freezeSplitByRootFamily,
  type ExecutedRecord,
  type SplitCase,
} from './blinded.js';

function record(overrides: Partial<ExecutedRecord> = {}): ExecutedRecord {
  return {
    recordId: 'repair-off-by-one-1',
    failureExcerpt: 'expected 3 to be 2',
    candidateDiff: 'diff --git a/page-count.js b/page-count.js\n',
    publicContracts: [{ contractId: 'page-count-ceiling', excerpt: '{"expected":2}' }],
    observations: [{ command: 'pnpm test', exitCode: 1, output: 'FAIL' }],
    changedPaths: ['page-count.js'],
    ...overrides,
  };
}

function families(spec: Array<[string, number]>): SplitCase[] {
  return spec.flatMap(([rootFamily, size]) =>
    Array.from({ length: size }, (_value, index) => ({
      caseId: `${rootFamily}-${String(index).padStart(2, '0')}`,
      rootFamily,
    })));
}

describe('blinded evaluation records', () => {
  it('keeps the candidate diff, which this evaluator is meant to judge', () => {
    const blinded = blindExecutedRecord(record());

    expect(blinded.candidateDiff).toContain('diff --git');
    expect(blinded.failureExcerpt).toBe('expected 3 to be 2');
    expect(blinded.publicContracts).toHaveLength(1);
  });

  it.each(FORBIDDEN_BLINDED_KEYS)('drops the answer-bearing field %s', (key) => {
    const blinded = blindExecutedRecord(record({ [key]: 'leaked' }));

    expect(Object.keys(blinded)).not.toContain(key);
    expect(JSON.stringify(blinded)).not.toContain('leaked');
  });

  it('drops label-bearing paths from the changed-path list', () => {
    const blinded = blindExecutedRecord(record({
      changedPaths: [
        'page-count.js', 'hidden/test_secret.py', 'expected-output.json',
        'truth/answers.json', 'fake-fix.diff', 'labels.csv',
      ],
    }));

    expect(blinded.changedPaths).toEqual(['page-count.js']);
  });

  it('records a source hash over the unredacted record', () => {
    const first = blindExecutedRecord(record());
    const second = blindExecutedRecord(record({ verdict: 'refused' }));

    expect(first.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(second.sourceHash).not.toBe(first.sourceHash);
    expect(second.recordId).toBe(first.recordId);
  });

  it('refuses a record with no identifier', () => {
    expect(() => blindExecutedRecord(record({ recordId: '  ' }))).toThrow(BlindingError);
  });

  it('detects a forbidden key nested anywhere in a prompt-bound structure', () => {
    expect(() => assertNoForbiddenMetadata({ a: { b: [{ verdict: 'approved' }] } }))
      .toThrow(/a\.b\[0\]\.verdict would leak the answer/u);
    expect(() => assertNoForbiddenMetadata({ safe: [1, 2, 'three'] })).not.toThrow();
  });
});

describe('frozen evaluation split', () => {
  const spec: Array<[string, number]> = [
    ['alpha', 60], ['beta', 20], ['gamma', 20],
  ];
  const counts = { development: 60, validation: 20, heldOut: 20 };

  it('assigns every case and reports the requested counts', () => {
    const frozen = freezeSplitByRootFamily(families(spec), counts);

    expect(frozen.assignments).toHaveLength(100);
    expect(frozen.counts).toEqual({ development: 60, validation: 20, 'held-out': 20 });
    expect(frozen.splitHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('never splits a root family across two splits', () => {
    const frozen = freezeSplitByRootFamily(
      families([['alpha', 30], ['beta', 30], ['gamma', 20], ['delta', 20]]), counts,
    );

    const byFamily = new Map<string, Set<string>>();
    for (const { rootFamily, split } of frozen.assignments) {
      byFamily.set(rootFamily, (byFamily.get(rootFamily) ?? new Set()).add(split));
    }
    for (const splits of byFamily.values()) expect(splits.size).toBe(1);
  });

  it('is deterministic for the same corpus regardless of input order', () => {
    const cases = families(spec);
    const forward = freezeSplitByRootFamily(cases, counts);
    const reversed = freezeSplitByRootFamily([...cases].toReversed(), counts);

    expect(reversed.splitHash).toBe(forward.splitHash);
    expect(reversed.assignments).toEqual(forward.assignments);
  });

  it('changes the split hash when the corpus changes', () => {
    const base = freezeSplitByRootFamily(families(spec), counts);
    const renamed = families(spec);
    renamed[0] = { ...renamed[0]!, caseId: 'alpha-renamed' };
    const regrouped = freezeSplitByRootFamily(
      families([['alpha', 60], ['beta', 20], ['delta', 20]]), counts,
    );

    expect(freezeSplitByRootFamily(renamed, counts).splitHash).not.toBe(base.splitHash);
    expect(regrouped.splitHash).not.toBe(base.splitHash);
  });

  it('refuses a corpus that does not match the requested split sizes', () => {
    expect(() => freezeSplitByRootFamily(families([['alpha', 99]]), counts))
      .toThrow(/expects 100 cases but received 99/u);
  });

  it('refuses duplicate case identifiers', () => {
    const duplicated = families([['alpha', 99]]);
    duplicated.push({ ...duplicated[0]! });

    expect(() => freezeSplitByRootFamily(duplicated, counts)).toThrow(/must be distinct/u);
  });

  it('refuses a family too large for any remaining split', () => {
    expect(() => freezeSplitByRootFamily(families([['alpha', 61], ['beta', 39]]), counts))
      .toThrow(/does not fit any remaining split/u);
  });
});
