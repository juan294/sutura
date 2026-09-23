import { describe, expect, it } from 'vitest';

import { Buffer } from 'node:buffer';

import { boundedTail, boundedTailWithHeader } from './bounded-tail.js';

describe('boundedTail', () => {
  it.each([1, 2, 3, 4, 5])(
    'never starts with a low surrogate after a %i-character tail bound',
    (maxCharacters) => {
      const tail = boundedTail('prefix🧵tail', {
        maxLines: 100,
        maxCharacters,
        maxBytes: 100,
      });

      const firstUnit = tail.charCodeAt(0);
      expect(firstUnit >= 0xdc00 && firstUnit <= 0xdfff).toBe(false);
      expect(tail).not.toContain('\uFFFD');
    },
  );

  it('repairs a leading low surrogate after a line-only truncation', () => {
    expect(
      boundedTail(`\uD83D\n\uDE00tail`, {
        maxLines: 1,
        maxCharacters: 100,
        maxBytes: 100,
      }),
    ).toBe('tail');
  });
});

describe('boundedTailWithHeader', () => {
  const bounds = { maxLines: 200, maxCharacters: 20_000, maxBytes: 20_000 };
  const isHeader = (line: string) => line.startsWith('Run ');
  const verbose = ['Run npm run test:pty', ...Array.from({ length: 900 }, (_, index) => `${'x'.repeat(60)} ${index}`)].join('\n');

  it('returns the plain tail byte-for-byte when the header already survives', () => {
    const log = `setup\nRun pnpm test\n${'output\n'.repeat(20)}failed`;

    expect(boundedTailWithHeader(log, bounds, isHeader)).toBe(boundedTail(log, bounds));
  });

  it('carries the header when the byte cap would drop it', () => {
    const result = boundedTailWithHeader(verbose, bounds, isHeader);

    expect(boundedTail(verbose, bounds)).not.toContain('Run npm run test:pty');
    expect(result.startsWith('Run npm run test:pty\n')).toBe(true);
    expect(result.endsWith(`${'x'.repeat(60)} 899`)).toBe(true);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(20_000);
    expect(result.length).toBeLessThanOrEqual(20_000);
    expect(result.split('\n').length).toBeLessThanOrEqual(200);
  });

  it('carries the nearest header before the cut, not the first one in the log', () => {
    const log = `Run pnpm lint\nlint ok\nRun pnpm test\n${'noise\n'.repeat(300)}failed`;

    expect(boundedTailWithHeader(log, bounds, isHeader).split('\n')[0]).toBe('Run pnpm test');
  });

  it('leaves a log with no header unchanged', () => {
    const log = verbose.replace('Run npm run test:pty', 'npm notice');

    expect(boundedTailWithHeader(log, bounds, isHeader)).toBe(boundedTail(log, bounds));
  });

  it('drops a header that would not fit the bounds itself', () => {
    const log = `Run ${'y'.repeat(30_000)}\n${'noise\n'.repeat(300)}failed`;

    expect(boundedTailWithHeader(log, bounds, isHeader)).toBe(boundedTail(log, bounds));
  });
});
