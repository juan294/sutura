import { describe, expect, it } from 'vitest';

import { InMemoryExecutor } from './memory.js';
import { prepareGitTooling } from './live-setup.js';

describe('prepareGitTooling', () => {
  it('derives a Git-enabled tooling image from the imported base', async () => {
    const executor = new InMemoryExecutor(() => ({
      exitCode: 0,
      stdout: 'git installed',
      stderr: '',
      truncated: false,
      metrics: {},
    }));

    await expect(prepareGitTooling(executor, 'node-image')).resolves.toBe(
      'mem-1',
    );
    expect(executor.calls).toEqual([
      {
        kind: 'run',
        parent: 'node-image',
        cmd: 'apt-get update -qq && apt-get install -y -qq git',
        opts: { timeoutSec: 300, network: 'enabled' },
        imageId: 'mem-1',
      },
    ]);
  });

  it('reports bounded install output when tooling preparation fails', async () => {
    const executor = new InMemoryExecutor(() => ({
      exitCode: 100,
      stdout: `apt output ${'o'.repeat(10_000)}`,
      stderr: 'package installation failed',
      truncated: false,
      metrics: {},
    }));

    await expect(prepareGitTooling(executor, 'node-image')).rejects.toThrow(
      /prepare sandbox Git tooling failed with exit code 100[\s\S]*stdout:[\s\S]*\[output truncated\][\s\S]*stderr:[\s\S]*package installation failed/u,
    );
  });
});
