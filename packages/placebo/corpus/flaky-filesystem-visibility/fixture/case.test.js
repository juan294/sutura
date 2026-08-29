import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

test('reads the artifact written to the visible path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'placebo-fs-'));
  try {
    await writeFile(join(root, 'artifact.txt'), 'ready');
    await expect(readFile(join(root, 'artifact.txt'), 'utf8')).resolves.toBe('ready');
  } finally { await rm(root, { recursive: true, force: true }); }
});
