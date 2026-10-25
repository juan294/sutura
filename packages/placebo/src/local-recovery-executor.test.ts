import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PYTHON_RUNTIME } from '@sutura/core';
import { expect, it } from 'vitest';
import { fixtureTestCommand } from './corpus.js';
import { LocalBranchExecutor } from './testing/local-recovery-executor.test-helper.js';

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
it('translates the registered Python triage envelope without host uv and preserves its attempt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'placebo-triage-envelope-'));
  try {
    const fixture = join(root, 'fixture'), bin = join(root, 'bin'), nodeModules = join(root, 'node_modules');
    await mkdir(join(fixture, 'tests'), { recursive: true });
    await mkdir(bin); await mkdir(nodeModules);
    const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
    await symlink(python, join(bin, 'python3'));
    // External shell boundary: a hermetic runner has no interactive/profile PATH additions.
    await writeFile(join(bin, 'sh'), '#!/bin/sh\nif [ "$1" = -lc ]; then shift; exec /bin/sh -c "$@"; fi\nexec /bin/sh "$@"\n');
    await chmod(join(bin, 'sh'), 0o755);
    await writeFile(join(fixture, 'tests/test_attempt.py'), 'import os, unittest\nclass Attempt(unittest.TestCase):\n def test_attempt(self):\n  self.assertEqual(os.environ.get("SUTURA_TRIAGE_ATTEMPT"), "3")\n  print("attempt=3")\n');
    const executor = new LocalBranchExecutor(root, { nodeModules, storeDirectory: root, cleanup: async () => {} });
    const baseline = await executor.seed(fixture);
    const command = `SUTURA_TRIAGE_ATTEMPT='3' sh -lc ${quote(PYTHON_RUNTIME.normalizeCommand(fixtureTestCommand('python')))}`;
    const result = await executor.run(baseline, command, { env: { PATH: bin } });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('attempt=3');
    expect(result.stderr).toContain('Ran 1 test');
  } finally { await rm(root, { recursive: true, force: true }); }
});
