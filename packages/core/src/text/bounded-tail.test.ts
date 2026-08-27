import { describe, expect, it } from 'vitest';

import { boundedTail } from './bounded-tail.js';

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
