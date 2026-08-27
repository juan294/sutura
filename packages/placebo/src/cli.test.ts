import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';

describe('placebo CLI stub', () => {
  it('runs successfully without producing a result', () => {
    expect(runCli()).toBeUndefined();
  });
});
