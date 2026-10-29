import { chmod, link, lstat, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DecisionSession, semanticConfig, type ShadowInput } from '@sutura/core';
import { createActionSemanticShadow } from './semantic-shadow.js';

const cleanup: string[] = [];
afterEach(async () => { for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true }); });

it('captures actual redacted shadow inputs privately without invoking a provider', async () => {
  const shadow = await createActionSemanticShadow(); cleanup.push(dirname(shadow.path));
  const decide = vi.fn();
  const session = new DecisionSession({ config: semanticConfig({ modes: { classification: 'shadow' }, maxUsd: .01 }, true), client: { decide, modelId: () => 'jev-1.14.0' }, capture: shadow.capture, deadline: Date.now() + 5000 });
  const evidence = await session.judge('classification', { token: 'private-token-test', log: 'AssertionError' }, { sufficient: { type: 'noul', instructions: 'Is this sufficient evidence?' } }, 'native-classifier', ['test-assertion'], ['test-assertion']);
  expect(evidence).toMatchObject({ outcome: 'disabled', reason: 'shadow-captured', attempts: 0, actualUsd: 0 });
  expect(decide).not.toHaveBeenCalled();
  const text = await readFile(shadow.path, 'utf8');
  expect(text).not.toContain('private-token-test');
  expect(JSON.parse(text)).toMatchObject({ schemaVersion: 'sutura-semantic-shadow-v1', role: 'classification', state: { token: '[redacted credential]', log: 'AssertionError' }, baseline: ['test-assertion'] });
  expect((await lstat(shadow.path)).mode & 0o777).toBe(0o600);
  expect((await lstat(dirname(shadow.path))).mode & 0o777).toBe(0o700);
});

it('preserves the existing capture when its bounded file is full', async () => {
  const shadow = await createActionSemanticShadow(); cleanup.push(dirname(shadow.path));
  await writeFile(shadow.path, 'x'.repeat(4 * 1024 * 1024));
  await expect(shadow.capture({ schemaVersion: 'sutura-semantic-shadow-v1' } as ShadowInput)).rejects.toThrow(/4 MiB/);
  expect((await lstat(shadow.path)).size).toBe(4 * 1024 * 1024);
});

it('refuses a replaced capture file instead of writing through a symlink', async () => {
  const shadow = await createActionSemanticShadow(); cleanup.push(dirname(shadow.path));
  const target = join(dirname(shadow.path), 'target'); await writeFile(target, 'preserve');
  await rm(shadow.path); await symlink(target, shadow.path);
  await expect(shadow.capture({ schemaVersion: 'sutura-semantic-shadow-v1' } as ShadowInput)).rejects.toThrow();
  expect(await readFile(target, 'utf8')).toBe('preserve');
});


it('refuses a replaced private directory and preserves both original and replacement captures', async () => {
  const shadow = await createActionSemanticShadow();
  const directory = dirname(shadow.path), preservedDirectory = `${directory}-preserved`;
  cleanup.push(directory, preservedDirectory);
  await rename(directory, preservedDirectory);
  await mkdir(directory, { mode: 0o700 });
  await writeFile(shadow.path, 'replacement-capture', { mode: 0o600 });

  await expect(shadow.capture({ schemaVersion: 'sutura-semantic-shadow-v1' } as ShadowInput))
    .rejects.toThrow('Private Jev shadow directory changed');

  expect(await readFile(shadow.path, 'utf8')).toBe('replacement-capture');
  expect(await readFile(join(preservedDirectory, basename(shadow.path)), 'utf8')).toBe('');
});

it('refuses an ordinary mode-0600 replacement file without appending to either capture', async () => {
  const shadow = await createActionSemanticShadow(); cleanup.push(dirname(shadow.path));
  const preserved = `${shadow.path}.preserved`;
  await rename(shadow.path, preserved);
  await writeFile(shadow.path, 'replacement-capture', { mode: 0o600 });

  await expect(shadow.capture({ schemaVersion: 'sutura-semantic-shadow-v1' } as ShadowInput))
    .rejects.toThrow('Private Jev shadow file changed');

  expect(await readFile(shadow.path, 'utf8')).toBe('replacement-capture');
  expect(await readFile(preserved, 'utf8')).toBe('');
});

it('refuses capture after a hardlink is added and preserves both linked paths', async () => {
  const shadow = await createActionSemanticShadow(); cleanup.push(dirname(shadow.path));
  const linked = join(dirname(shadow.path), 'linked-capture');
  await writeFile(shadow.path, 'private-capture');
  await link(shadow.path, linked);

  await expect(shadow.capture({ schemaVersion: 'sutura-semantic-shadow-v1' } as ShadowInput))
    .rejects.toThrow('Private Jev shadow file changed');

  expect(await readFile(shadow.path, 'utf8')).toBe('private-capture');
  expect(await readFile(linked, 'utf8')).toBe('private-capture');
});

it('refuses permission drift without appending to a readable capture', async () => {
  const shadow = await createActionSemanticShadow(); cleanup.push(dirname(shadow.path));
  await writeFile(shadow.path, 'private-capture');
  await chmod(shadow.path, 0o644);

  await expect(shadow.capture({ schemaVersion: 'sutura-semantic-shadow-v1' } as ShadowInput))
    .rejects.toThrow('Private Jev shadow file changed');

  expect(await readFile(shadow.path, 'utf8')).toBe('private-capture');
});
