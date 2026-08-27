import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const bundlePath = resolve(import.meta.dirname, '../dist/index.js');

describe('committed GitHub Action bundle', () => {
  it('is a non-trivial self-contained JavaScript entrypoint', async () => {
    const [metadata, bundle] = await Promise.all([
      stat(bundlePath),
      readFile(bundlePath, 'utf8'),
    ]);

    expect(metadata.size).toBeGreaterThan(100_000);
    expect(bundle).toContain('runAction');
    expect(bundle).not.toMatch(/from ["']@sutura\/core["']/);
    expect(bundle).not.toMatch(/from ["']\.\/src\/main/);
  });
});
