import { describe, expect, it } from 'vitest';

import { loadRepositoryPolicy } from './load.js';

describe('loadRepositoryPolicy', () => {
  it('returns safe defaults when the repository has no policy', () => {
    const loaded = loadRepositoryPolicy(null);

    expect(loaded.source).toBe('default');
    expect(loaded.sha).toBe('default');
    expect(loaded.policy.protectedPaths).toContain('.sutura.json');
    expect(loaded.policy.allowedPaths).toEqual(['**']);
    expect(loaded.policy.requiredCommands).toEqual([]);
  });

  it('binds repository policy evidence to a stable content SHA', () => {
    const content = '{"version":1,"allowedPaths":["src/**"]}';
    const first = loadRepositoryPolicy(content);
    const second = loadRepositoryPolicy(content);

    expect(first.source).toBe('repository');
    expect(first.sha).toMatch(/^[0-9a-f]{64}$/u);
    expect(second.sha).toBe(first.sha);
  });

  it('rejects policy files above the bounded read contract', () => {
    expect(() => loadRepositoryPolicy(' '.repeat(65_537))).toThrow(/exceeds.*65,536 bytes/iu);
  });
});
