import { describe, expect, it } from 'vitest';

import { add } from './dogfood-add.js';

describe('dogfood arithmetic', () => {
  it('adds two declared operands', () => {
    expect(add(2, 3)).toBe(5);
  });
});
