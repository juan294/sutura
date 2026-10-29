import { describe, expect, it } from 'vitest';

import {
  OverlayChunkError,
  OVERLAY_TAR_TRAILER_BYTES,
  planOverlayChunks,
  tarEntryBytes,
} from './overlay-chunks.js';

const MIB = 1_024 * 1_024;

describe('tarEntryBytes', () => {
  it.each([
    [0, 512],
    [1, 1_024],
    [512, 1_024],
    [513, 1_536],
  ])('counts a %i byte file as %i tar bytes', (size, expected) => {
    expect(tarEntryBytes('a.txt', size)).toBe(expected);
  });

  it('adds a long-name header when the path exceeds 100 bytes', () => {
    const long = `${'d/'.repeat(60)}file.txt`;
    expect(Buffer.byteLength(long)).toBeGreaterThan(100);
    expect(tarEntryBytes(long, 0)).toBe(512 + 512 + 512);
  });
});

describe('planOverlayChunks', () => {
  const capacity = MIB - OVERLAY_TAR_TRAILER_BYTES;

  it('returns no groups for no files and one group for a small tree', () => {
    expect(planOverlayChunks([], MIB)).toEqual([]);
    expect(planOverlayChunks([{ path: 'a', size: 10 }, { path: 'b', size: 20 }], MIB))
      .toEqual([['a', 'b']]);
  });

  it('keeps input order and starts a new group when the next file would not fit', () => {
    const half = Math.floor(capacity / 2) - 1_024;
    const groups = planOverlayChunks([
      { path: 'a', size: half },
      { path: 'b', size: half },
      { path: 'c', size: half },
    ], MIB);
    expect(groups).toEqual([['a', 'b'], ['c']]);
  });

  it('partitions a scaled Spoken Letter profile exactly and within the budget', () => {
    // 5,790 files, 145,798,039 bytes at scale 1, scaled by 1/64 for a 1 MiB budget.
    let seed = 7;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    const weights = Array.from({ length: 5_790 }, () => next() ** 3 + 0.01);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const files = weights.map((weight, index) => ({
      path: `dir${index % 40}/file${index}.bin`,
      size: Math.floor((weight / total) * (145_798_039 / 64)),
    }));

    const groups = planOverlayChunks(files, MIB);

    expect(groups.length).toBeGreaterThanOrEqual(3);
    expect(groups.flat()).toEqual(files.map(({ path }) => path));
    const sizes = new Map(files.map(({ path, size }) => [path, size]));
    for (const group of groups) {
      expect(group.length).toBeGreaterThan(0);
      const estimate = group.reduce(
        (sum, path) => sum + tarEntryBytes(path, sizes.get(path) as number),
        0,
      );
      expect(estimate).toBeLessThanOrEqual(capacity);
    }
  });

  it('refuses a file larger than one chunk even when it could fit in two', () => {
    expect(() => planOverlayChunks([
      { path: 'a', size: 10 },
      { path: 'big', size: MIB + 1_000 },
      { path: 'b', size: 10 },
    ], MIB)).toThrow(/big.*cannot be split/u);
  });

  it('places a repeated path once', () => {
    expect(planOverlayChunks([
      { path: 'a', size: 10 },
      { path: 'b', size: 10 },
      { path: 'a', size: 10 },
    ], MIB)).toEqual([['a', 'b']]);
  });

  it('refuses a file larger than two chunks and names its path and size', () => {
    const error = (() => {
      try {
        planOverlayChunks([{ path: 'big/video.bin', size: 2 * MIB }], MIB);
      } catch (cause) {
        return cause;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(OverlayChunkError);
    expect((error as OverlayChunkError).message).toMatch(/big\/video\.bin/u);
    expect((error as OverlayChunkError).message).toMatch(/2097152 bytes/u);
    expect((error as OverlayChunkError).path).toBe('big/video.bin');
    expect((error as OverlayChunkError).size).toBe(2 * MIB);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])(
    'rejects the budget %s',
    (budget) => {
      expect(() => planOverlayChunks([{ path: 'a', size: 1 }], budget)).toThrow(RangeError);
    },
  );
});
