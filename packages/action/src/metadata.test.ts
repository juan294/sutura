import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const metadataUrl = new URL('../action.yml', import.meta.url);

describe('GitHub Action metadata', () => {
  it('uses the supported Node 24 runtime and committed CommonJS bundle', async () => {
    const metadata = await readFile(metadataUrl, 'utf8');

    expect(metadata).toMatch(/^runs:\n  using: node24\n  main: dist\/index\.cjs$/m);
  });

  it('declares every mapped input and the outcome output', async () => {
    const metadata = await readFile(metadataUrl, 'utf8');

    for (const input of [
      'github-token',
      'run-id',
      'nebius-api-key',
      'tavily-api-key',
      'contree-token',
      'contree-project',
      'triage-n',
      'race-k',
      'model-nano',
      'model-super',
      'model-ultra',
    ]) {
      expect(metadata).toContain(`  ${input}:\n`);
    }
    expect(metadata).toContain('outputs:\n  outcome:\n');
  });
});
