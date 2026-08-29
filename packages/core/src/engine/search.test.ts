import { describe, expect, it, vi } from 'vitest';

import { adaptiveSearch, type SearchExpansion } from './search.js';

function expansion(diff: string, exitCode: number, error = 'still failing'): SearchExpansion {
  return {
    imageId: `image-${diff}`, cumulativeDiff: diff,
    testEvidence: { commandId: 'diagnosed', imageId: `image-${diff}`, exitCode, output: error },
    policyEvidence: { valid: true, violations: [], changedFiles: ['a.ts'], diffBytes: diff.length },
    stageEvidence: [], transcriptReference: `trace-${diff}`,
    ...(exitCode === 0 ? { candidate: { id: diff, rationale: 'passes', diff } } : {}),
  };
}

describe('adaptiveSearch', () => {
  it('uses stable lineage and deterministically expands the best beam', async () => {
    const expand = vi.fn(async ({ depth, branch }: { depth: number; branch: number }) =>
      expansion(`diff-${depth}-${branch}`, depth === 2 && branch === 1 ? 0 : 1, `failure-${branch}`),
    );
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 3, beamWidth: 1, maximumDepth: 2,
      maximumTotalBranches: 5, availableBranches: () => 10, expand,
    });
    expect(result.nodes.map(({ id, parentId }) => [id, parentId])).toEqual([
      ['search-001', undefined], ['search-002', undefined], ['search-003', undefined],
      ['search-004', 'search-001'],
    ]);
    expect(result.candidates.map(({ id }) => id)).toEqual(['search-004']);
  });

  it('prunes repeated diff/error states and respects operation and branch capacity', async () => {
    const expand = vi.fn(async () => expansion('same-diff', 1, 'same failure'));
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 4, beamWidth: 2, maximumDepth: 4,
      maximumTotalBranches: 12, availableBranches: () => 2, expand,
    });
    expect(expand).toHaveBeenCalledTimes(3);
    expect(result.nodes.filter(({ terminalReason }) => terminalReason === 'repeated-state')).toHaveLength(2);
    expect(result.terminalReason).toBe('frontier-exhausted');
  });

  it('does not expand policy failures', async () => {
    const expand = vi.fn(async () => ({
      ...expansion('denied', 1),
      policyEvidence: { valid: false, violations: ['protected'], changedFiles: ['a.ts'], diffBytes: 6 },
    }));
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 1, beamWidth: 1, maximumDepth: 4,
      maximumTotalBranches: 12, availableBranches: () => 10, expand,
    });
    expect(expand).toHaveBeenCalledTimes(1);
    expect(result.nodes[0]?.terminalReason).toBe('policy');
  });

  it('reauthorizes every expansion from the current capacity snapshot', async () => {
    let available = 2;
    const expand = vi.fn(async () => {
      available = 0;
      return expansion('first', 1);
    });
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 2, beamWidth: 1, maximumDepth: 2,
      maximumTotalBranches: 4, availableBranches: () => available,
      concurrencyCapacity: () => 1, expand,
    });
    expect(expand).toHaveBeenCalledOnce();
    expect(result.terminalReason).toBe('operation-capacity');
  });

  it('shrinks the next batch when current capacity drops below concurrency', async () => {
    let available = 4;
    const expand = vi.fn(async ({ branch }: { branch: number }) => {
      if (branch === 2) available = 1;
      if (branch === 3) available = 0;
      return expansion(`branch-${branch}`, 1, `failure-${branch}`);
    });
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 4, beamWidth: 1, maximumDepth: 1,
      maximumTotalBranches: 4, availableBranches: () => available,
      concurrencyCapacity: () => 2, expand,
    });
    expect(expand.mock.calls.map(([{ branch }]) => branch)).toEqual([1, 2, 3]);
    expect(result.nodes).toHaveLength(3);
  });

  it('schedules every authorized parent in bounded concurrency batches', async () => {
    const expand = vi.fn(async ({ nodeId }: { nodeId: string }) => expansion(nodeId, 1));
    await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 4, beamWidth: 2, maximumDepth: 1,
      maximumTotalBranches: 4, availableBranches: () => 4,
      concurrencyCapacity: () => 2, expand,
    });
    expect(expand).toHaveBeenCalledTimes(4);
  });

  it('cancels unfinished siblings and preserves their terminal node', async () => {
    const cancel = vi.fn(async () => undefined);
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 2, beamWidth: 2, maximumDepth: 1,
      maximumTotalBranches: 2, availableBranches: () => 2,
      concurrencyCapacity: () => 2, cancel,
      expand: async ({ branch, signal }) => {
        if (branch === 1) return expansion('winner', 0);
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        return { ...expansion('cancelled', 1), terminalReason: 'cancelled' };
      },
    });
    expect(cancel).toHaveBeenCalledWith('search-002');
    expect(result.candidates.map(({ id }) => id)).toEqual(['search-001']);
    expect(result.nodes[1]?.terminalReason).toBe('cancelled');
  });

  it('collects all passing children that complete in the same expansion batch', async () => {
    const result = await adaptiveSearch({
      baselineImageId: 'base', initialBranches: 2, beamWidth: 2, maximumDepth: 1,
      maximumTotalBranches: 2, availableBranches: () => 2,
      concurrencyCapacity: () => 2, cancel: async () => undefined,
      expand: async ({ branch }) => expansion(`winner-${branch}`, 0),
    });
    expect(result.candidates.map(({ id }) => id)).toEqual(['search-001', 'search-002']);
  });
});
