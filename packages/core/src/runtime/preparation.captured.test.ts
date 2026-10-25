import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildSandboxRepositoryInitializationCommandForTest } from '../heal.js';

describe('captured dependency preparation boundary', () => {
  // Captured native-addon setup tried downloading binaries/headers during
  // network-disabled Git initialization. A generic rebuild also executes
  // repository install hooks after the manifest-only installation stage.
  it('initializes the baseline without running repository lifecycle hooks or dependency rebuilds', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-captured-preparation-'));
    try {
      const marker = join(directory, 'untrusted-hook-ran');
      await writeFile(join(directory, 'package.json'), JSON.stringify({
        name: 'captured-runtime-fixture',
        version: '1.0.0',
        scripts: { install: 'node -e "require(\'node:fs\').writeFileSync(\'untrusted-hook-ran\',\'unsafe\');process.exit(1)"' },
      }));
      await writeFile(join(directory, 'package-lock.json'), JSON.stringify({
        name: 'captured-runtime-fixture', version: '1.0.0', lockfileVersion: 3,
        packages: { '': { name: 'captured-runtime-fixture', version: '1.0.0' } },
      }));
      await writeFile(join(directory, 'overlay.manifest'), Buffer.from('package.json\0package-lock.json\0'));
      await mkdir(join(directory, 'empty-template'));
      const command = buildSandboxRepositoryInitializationCommandForTest({
        manifestPath: join(directory, 'overlay.manifest'),
        templatePath: join(directory, 'empty-template'),
      });
      const result = spawnSync('sh', ['-c', command], { cwd: directory, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(command).not.toContain('rebuild');
      expect(spawnSync('git', ['ls-files'], { cwd: directory, encoding: 'utf8' }).stdout)
        .toBe('package-lock.json\npackage.json\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
