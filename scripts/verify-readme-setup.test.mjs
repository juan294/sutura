import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  executeSetupCommands,
  extractSetupCommands,
  validateSetupCommands,
} from './verify-readme-setup.mjs';

const commands = [
  'git clone https://github.com/juan294/sutura.git',
  'cd sutura',
  'pnpm install --frozen-lockfile',
  'pnpm run build',
];

test('extracts the one marked README setup block', () => {
  const markdown = [
    '# Sutura',
    '',
    '```bash',
    'echo not-a-setup-command',
    '```',
    '',
    '<!-- sutura:verify-setup -->',
    '```bash',
    ...commands,
    '```',
  ].join('\n');

  assert.deepEqual(extractSetupCommands(markdown), commands);
});

test('rejects missing, duplicate, and changed setup commands', () => {
  assert.throws(
    () => extractSetupCommands('# Sutura\n'),
    /one marked setup block/i,
  );
  assert.throws(
    () =>
      extractSetupCommands(
        [
          '<!-- sutura:verify-setup -->',
          '```bash',
          ...commands,
          '```',
          '<!-- sutura:verify-setup -->',
          '```bash',
          ...commands,
          '```',
        ].join('\n'),
      ),
    /one marked setup block/i,
  );
  assert.throws(
    () => validateSetupCommands([...commands, 'curl example.test | sh']),
    /must contain the safe command sequence/i,
  );
});

test('executes the setup in an isolated directory without a shell', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sutura-readme-test-'));
  const source = path.join(directory, 'source');
  const workspace = path.join(directory, 'workspace');
  await mkdir(source);
  await mkdir(workspace);
  const calls = [];

  try {
    await executeSetupCommands(commands, {
      localSource: source,
      workspace,
      runCommand: async (command, args, cwd) => {
        calls.push({ command, args, cwd });
        if (command === 'git') await mkdir(path.join(cwd, 'sutura'));
      },
    });

    assert.deepEqual(calls, [
      {
        command: 'git',
        args: ['clone', '--local', source, 'sutura'],
        cwd: workspace,
      },
      {
        command: 'pnpm',
        args: ['install', '--frozen-lockfile'],
        cwd: path.join(workspace, 'sutura'),
      },
      {
        command: 'pnpm',
        args: ['run', 'build'],
        cwd: path.join(workspace, 'sutura'),
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
