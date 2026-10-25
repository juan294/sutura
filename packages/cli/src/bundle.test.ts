import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('published CLI bundle', () => {
  beforeAll(async () => {
    await execFileAsync('pnpm', ['run', 'build'], {
      cwd: new URL('..', import.meta.url),
    });
  }, 90_000);

  it('contains the evaluation commands and manifest validator', async () => {
    const bundle = await readFile(new URL('../dist/bin.js', import.meta.url), 'utf8');
    expect(bundle).toContain('sutura eval validate --manifest');
    expect(bundle).toContain('sutura-evaluation-v1');
    expect(bundle).toContain('ATIF-v1.7');
  });

  it('starts the standalone ESM bundle outside the workspace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-bundle-startup-'));
    try {
      const entry = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
      const bundle = await readFile(entry, 'utf8');
      expect(bundle.startsWith('#!/usr/bin/env node\n')).toBe(true);
      const { stdout, stderr } = await execFileAsync(process.execPath, [entry, '--help'], {
        cwd: directory,
        timeout: 30_000,
      });
      expect(stdout).toContain('sutura');
      expect(stderr).toBe('');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
