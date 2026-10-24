import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nodeImageRefForRepository } from './node.js';

describe('nodeImageRefForRepository', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'sutura-node-version-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('replays the Cirujano repair-monitor version declarations from run 40070227746', async () => {
    const fixture = join(import.meta.dirname, '__fixtures__/cirujano-node-version');
    await expect(nodeImageRefForRepository(fixture)).resolves.toBe('node:24');
  });

  it.each([
    ['v24.22.1', '>=22', 'node:24'],
    ['24', '^22 || ^24', 'node:24'],
    ['24', '>=24.5 <25', 'node:24'],
    ['22', '22.x', 'node:22'],
    ['22.12', '~22.12.0', 'node:22'],
  ])('accepts compatible declarations %s and %s', async (nvm, engine, expected) => {
    await writeFile(join(dir, '.nvmrc'), `${nvm}\n`);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ engines: { node: engine } }));
    await expect(nodeImageRefForRepository(dir)).resolves.toBe(expected);
  });

  it.each([
    ['24', '>=22 <23'],
    ['24', '^22'],
    ['22', '>=24'],
    ['24.0.0', '>=24.5'],
    ['22.12', '>=22.13 <23'],
    ['24', '>=26'],
  ])('rejects disjoint declarations %s and %s', async (nvm, engine) => {
    await writeFile(join(dir, '.nvmrc'), nvm);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ engines: { node: engine } }));
    await expect(nodeImageRefForRepository(dir)).rejects.toThrow(/conflict between .nvmrc and package.json/u);
  });

  it.each([
    ['>=20', 'node:22'],
    ['^20 || ^24', 'node:24'],
    ['>=22 <23', 'node:22'],
    ['>=24.5 <25', 'node:24'],
    ['*', 'node:22'],
  ])('selects a supported major from engine range %s without .nvmrc', async (engine, expected) => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ engines: { node: engine } }));
    await expect(nodeImageRefForRepository(dir)).resolves.toBe(expected);
  });

  it.each(['>=26', '<22', '>=22 <22'])('rejects engine range %s with no supported major', async (engine) => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ engines: { node: engine } }));
    await expect(nodeImageRefForRepository(dir)).rejects.toThrow(/Unsupported sandbox Node.*package.json/u);
  });

  it('rejects an invalid engine range instead of ignoring it', async () => {
    await writeFile(join(dir, '.nvmrc'), '24');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=22 garbage' } }));
    await expect(nodeImageRefForRepository(dir)).rejects.toThrow(/Invalid package.json engines.node/u);
  });

  it('selects Node 24 when repository version declarations agree', async () => {
    await writeFile(join(dir, '.nvmrc'), '24\n');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=24 <25' } }));
    await expect(nodeImageRefForRepository(dir)).resolves.toBe('node:24');
  });

  it('defaults to Node 22 and rejects unsupported declared majors', async () => {
    await expect(nodeImageRefForRepository(dir)).resolves.toBe('node:22');
    await writeFile(join(dir, '.nvmrc'), '26\n');
    await expect(nodeImageRefForRepository(dir)).rejects.toThrow(/Unsupported sandbox Node major/u);
  });

  it('rejects a malformed numeric .nvmrc version', async () => {
    await writeFile(join(dir, '.nvmrc'), '024');
    await expect(nodeImageRefForRepository(dir)).rejects.toThrow(/Invalid .nvmrc Node version/u);
  });

  it('does not allow an engine range to override an unsupported .nvmrc major', async () => {
    await writeFile(join(dir, '.nvmrc'), '26');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=22' } }));
    await expect(nodeImageRefForRepository(dir)).rejects.toThrow(/Unsupported sandbox Node major/u);
  });

  it('uses the package engine when .nvmrc is absent', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=24 <25' } }));
    await expect(nodeImageRefForRepository(dir)).resolves.toBe('node:24');
  });
});
