import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { CliUsageError, parseArgs, VERSION } from './args.js';

describe('parseArgs', () => {
  it('parses the Placebo-compatible heal contract', () => {
    expect(parseArgs([
      'heal', '--case-dir', '/tmp/case', '--format', 'json',
      '--candidate-diff', 'diff --git a/a.js b/a.js\n',
      '--routing-profile', 'production-baseline-v1', '--no-tavily',
    ])).toEqual({
      command: 'heal',
      caseDir: '/tmp/case',
      format: 'json',
      candidateDiff: 'diff --git a/a.js b/a.js\n',
      routingProfile: 'production-baseline-v1',
      tavilyEnabled: false,
    });
  });

  it('parses external repository setup options', () => {
    expect(parseArgs([
      'init', '--workflow', 'CI', '--repo', 'octo/example', '--force', '--no-tavily',
    ])).toEqual({
      command: 'init',
      workflow: 'CI',
      repository: 'octo/example',
      force: true,
      tavilyEnabled: false,
    });
  });

  it('parses repository diagnosis options', () => {
    expect(parseArgs(['doctor', '--repo', 'octo/example'])).toEqual({
      command: 'doctor',
      repository: 'octo/example',
    });
  });

  it('parses evaluation validation and export commands', () => {
    expect(parseArgs(['eval', 'validate', '--manifest', '/tmp/manifest.json'])).toEqual({
      command: 'eval-validate', manifest: '/tmp/manifest.json',
    });
    expect(parseArgs([
      'eval', 'export', '--manifest', '/tmp/manifest.json', '--format', 'atif',
      '--output', '/tmp/trajectory.atif.json', '--force',
    ])).toEqual({
      command: 'eval-export', manifest: '/tmp/manifest.json', format: 'atif',
      output: '/tmp/trajectory.atif.json', force: true,
    });
  });

  it.each([['--help'], ['help']])('parses help form %j', (...args) => {
    expect(parseArgs(args)).toEqual({ command: 'help' });
  });

  it.each([['--version'], ['version']])('parses version form %j', (...args) => {
    expect(parseArgs(args)).toEqual({ command: 'version' });
  });

  it('keeps the CLI version aligned with its package', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(manifest.version);
  });

  const invalidArguments: string[][] = [
    [],
    ['repair'],
    ['heal'],
    ['heal', '--case-dir'],
    ['heal', '--case-dir', '/tmp/case', '--format', 'text'],
    ['heal', '--case-dir', '/tmp/case', '--format', 'json', '--unknown'],
    ['heal', '--case-dir', '/tmp/a', '--case-dir', '/tmp/b', '--format', 'json'],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--candidate-diff', ''],
    ['init', '--repo', 'invalid'],
    ['init', '--workflow', 'CI', '--workflow', 'Tests'],
    ['doctor', '--unknown'],
    ['eval'],
    ['eval', 'validate'],
    ['eval', 'validate', '--manifest', '/tmp/a', '--force'],
    ['eval', 'export', '--manifest', '/tmp/a', '--format', 'array', '--output', '/tmp/o'],
    ['eval', 'export', '--manifest', '/tmp/a', '--format', 'atif'],
  ];

  it.each(invalidArguments.map((args) => [args] as const))('rejects malformed arguments: %j', (args) => {
    expect(() => parseArgs(args)).toThrow(CliUsageError);
  });
});
