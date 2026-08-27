import { describe, expect, it } from 'vitest';

import { VERSION } from './index.js';

describe('@sutura/core entry point', () => {
  it('retains the scaffold version export', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
