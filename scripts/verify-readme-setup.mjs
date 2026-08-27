#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MARKER = '<!-- sutura:verify-setup -->';

export const README_SETUP_COMMANDS = Object.freeze([
  'git clone https://github.com/juan294/sutura.git',
  'cd sutura',
  'pnpm install --frozen-lockfile',
  'pnpm run build',
]);

export function extractSetupCommands(markdown) {
  const escapedMarker = MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [
    ...markdown.matchAll(
      new RegExp(
        `${escapedMarker}\\s*\\n` + '```bash\\s*\\n([\\s\\S]*?)\\n```',
        'g',
      ),
    ),
  ];
  if (matches.length !== 1) {
    throw new Error('README must contain exactly one marked setup block');
  }

  const commands = matches[0][1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  validateSetupCommands(commands);
  return commands;
}

export function validateSetupCommands(commands) {
  if (
    commands.length !== README_SETUP_COMMANDS.length ||
    commands.some((command, index) => command !== README_SETUP_COMMANDS[index])
  ) {
    throw new Error('README setup block must contain the safe command sequence');
  }
}

function spawnCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} failed (${signal ?? `exit ${String(code)}`})`,
        ),
      );
    });
  });
}

export async function executeSetupCommands(
  commands,
  { localSource, workspace, runCommand = spawnCommand },
) {
  validateSetupCommands(commands);
  const source = localSource ? path.resolve(localSource) : undefined;
  let cwd = path.resolve(workspace);

  for (const command of commands) {
    if (command.startsWith('git clone ')) {
      const args = source
        ? ['clone', '--local', source, 'sutura']
        : ['clone', 'https://github.com/juan294/sutura.git'];
      await runCommand('git', args, cwd);
      continue;
    }
    if (command === 'cd sutura') {
      cwd = path.join(cwd, 'sutura');
      const directory = await stat(cwd);
      if (!directory.isDirectory()) {
        throw new Error('The setup clone did not create a sutura directory');
      }
      continue;
    }

    const args = command === 'pnpm install --frozen-lockfile'
      ? ['install', '--frozen-lockfile']
      : ['run', command.slice('pnpm run '.length)];
    await runCommand('pnpm', args, cwd);
  }
}

function parseArguments(argv) {
  let readmePath = 'README.md';
  let localSource;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--local-source') {
      localSource = argv[index + 1];
      if (!localSource) throw new Error('--local-source requires a path');
      index += 1;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      readmePath = argument;
    }
  }
  return { readmePath, localSource };
}

async function main() {
  const { readmePath, localSource } = parseArguments(process.argv.slice(2));
  const markdown = await readFile(readmePath, 'utf8');
  const commands = extractSetupCommands(markdown);
  const workspace = await mkdtemp(path.join(tmpdir(), 'sutura-readme-setup-'));
  try {
    await executeSetupCommands(commands, { localSource, workspace });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
