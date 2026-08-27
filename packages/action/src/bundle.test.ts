import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const bundlePath = resolve(import.meta.dirname, '../dist/index.cjs');
const execFileAsync = promisify(execFile);

describe('committed GitHub Action bundle', () => {
  it('is a non-trivial self-contained JavaScript entrypoint', async () => {
    const [metadata, bundle] = await Promise.all([
      stat(bundlePath),
      readFile(bundlePath, 'utf8'),
    ]);

    expect(metadata.size).toBeGreaterThan(100_000);
    expect(bundle).toContain('runAction');
    expect(bundle).not.toMatch(/require\(["']@sutura\/core["']\)/);
    expect(bundle).not.toMatch(/require\(["']\.\/src\/main/);
  });

  it('launches under Node and reaches action input validation', async () => {
    const launched = execFileAsync(process.execPath, [bundlePath], {
      env: { PATH: process.env.PATH ?? '' },
    }).catch((error: unknown) => error as { stdout?: string; stderr?: string });

    const result = await launched;
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    expect(output).toContain('Missing required action input: run-id');
    expect(output).not.toContain('Dynamic require of');
  });
});
