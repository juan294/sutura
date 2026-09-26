import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { nodeImageRefForRepository } from './node.js';

describe('nodeImageRefForRepository', () => {
  it('selects Node 24 when repository version declarations agree', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-node-version-'));
    try {
      await writeFile(join(dir, '.nvmrc'), '24\n');
      await writeFile(join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=24 <25' } }));
      await expect(nodeImageRefForRepository(dir)).resolves.toBe('node:24');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('defaults to Node 22 and rejects unsupported declared majors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-node-version-'));
    try {
      await expect(nodeImageRefForRepository(dir)).resolves.toBe('node:22');
      await writeFile(join(dir, '.nvmrc'), '26\n');
      await expect(nodeImageRefForRepository(dir)).rejects.toThrow(/Unsupported sandbox Node major/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the package engine when .nvmrc is absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sutura-node-version-'));
    try {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=24 <25' } }));
      await expect(nodeImageRefForRepository(dir)).resolves.toBe('node:24');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
