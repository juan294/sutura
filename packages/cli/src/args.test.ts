import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { CliUsageError, parseArgs, VERSION } from './args.js';

describe('parseArgs', () => {
  it('parses explicit bounded local Jev modes and leaves absent flags absent', () => {
    const parsed = parseArgs(['heal', '--case-dir', '/tmp/case', '--format', 'json', '--jev-ranking', 'shadow', '--jev-grounding', 'assist', '--jev-classification', 'off', '--jev-recovery', 'off', '--jev-budget-usd', '0.01']);
    expect(parsed).toMatchObject({ semantic: { model: 'jev-1.14.0', policyVersion: 'semantic-v1', maxUsd: 0.01, modes: { ranking: 'shadow', grounding: 'assist', classification: 'off', recovery: 'off' } } });
    expect(parseArgs(['heal', '--case-dir', '/tmp/case', '--format', 'json'])).not.toHaveProperty('semantic');
  });

  it.each([
    ['--jev-ranking', 'auto', '--jev-budget-usd', '0.01'],
    ['--jev-recovery', 'assist'],
    ['--jev-grounding', 'shadow', '--jev-budget-usd', '0'],
    ['--jev-classification', 'assist', '--jev-budget-usd', '0.021'],
    ['--jev-ranking', 'off', '--jev-budget-usd', 'NaN'],
  ])('rejects invalid Jev selection %j before runtime creation', (...flags) => {
    expect(() => parseArgs(['heal', '--case-dir', '/tmp/case', '--format', 'json', ...flags])).toThrow(CliUsageError);
  });

  it('parses the Placebo-compatible heal contract', () => {
    expect(parseArgs([
      'heal', '--case-dir', '/tmp/case', '--format', 'json',
      '--candidate-diff', 'diff --git a/a.js b/a.js\n',
      '--routing-profile', 'production-baseline-v1', '--no-tavily',
      '--runtime', 'python',
      '--failing-command', " python3 -B -m unittest discover -s tests -p 'test_*.py' ",
    ])).toEqual({
      command: 'heal',
      caseDir: '/tmp/case',
      format: 'json',
      candidateDiff: 'diff --git a/a.js b/a.js\n',
      failingCommand: "python3 -B -m unittest discover -s tests -p 'test_*.py'",
      routingProfile: 'production-baseline-v1',
      runtime: 'python',
      tavilyEnabled: false,
    });
  });

  it('leaves the failing command to the core default when the flag is absent', () => {
    expect(parseArgs(['heal', '--case-dir', '/tmp/case', '--format', 'json'])).not.toHaveProperty('failingCommand');
  });

  it('parses external repository setup options', () => {
    expect(parseArgs([
      'init', '--workflow', 'CI', '--repo', 'octo/example', '--action-sha', 'a'.repeat(40),
      '--force', '--no-tavily',
    ])).toEqual({
      command: 'init',
      workflow: 'CI',
      repository: 'octo/example',
      actionSha: 'a'.repeat(40),
      force: true,
      tavilyEnabled: false,
    });
  });

  it('parses repository diagnosis options', () => {
    expect(parseArgs(['doctor', '--repo', 'octo/example', '--action-sha', 'b'.repeat(40)])).toEqual({
      command: 'doctor',
      repository: 'octo/example',
      actionSha: 'b'.repeat(40),
    });
  });

  it('parses reduced-assurance audit inputs as file paths', () => {
    expect(parseArgs([
      'audit', '--case-dir', '/tmp/case', '--candidate-diff', '/tmp/fix.diff',
      '--before-log', '/tmp/before.log', '--after-log', '/tmp/after.log', '--format', 'json',
    ])).toEqual({
      command: 'audit', caseDir: '/tmp/case', candidateDiff: '/tmp/fix.diff',
      beforeLog: '/tmp/before.log', afterLog: '/tmp/after.log', format: 'json',
    });
  });

  it('parses replay bundle and runtime options', () => {
    expect(parseArgs([
      'replay', '--bundle', '/tmp/replay.json', '--format', 'json', '--runtime', 'python',
    ])).toEqual({
      command: 'replay', bundle: '/tmp/replay.json', format: 'json', runtime: 'python',
    });
    expect(parseArgs([
      'replay', '--bundle', '/tmp/replay.json', '--format', 'json', '--runtime', 'auto',
    ])).toEqual({
      command: 'replay', bundle: '/tmp/replay.json', format: 'json',
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
    ['repair'],
    ['heal'],
    ['heal', '--case-dir'],
    ['heal', '--case-dir', '/tmp/case', '--format', 'text'],
    ['heal', '--case-dir', '/tmp/case', '--format', 'json', '--unknown'],
    ['heal', '--case-dir', '/tmp/a', '--case-dir', '/tmp/b', '--format', 'json'],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--candidate-diff', ''],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--runtime', 'ruby'],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--failing-command', '   '],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--failing-command', 'pnpm test\npnpm lint'],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--failing-command', 'pnpm t\u00e9st'],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--failing-command', `pnpm test ${'-'.repeat(300)}`],
    ['heal', '--case-dir', '/tmp/a', '--format', 'json', '--failing-command', 'pnpm test', '--failing-command', 'pnpm lint'],
    ['init', '--repo', 'invalid'],
    ['init', '--workflow', 'CI', '--workflow', 'Tests'],
    ['init', '--action-sha', 'main'],
    ['doctor', '--unknown'],
    ['doctor', '--action-sha', 'abc'],
    ['audit'],
    ['audit', '--case-dir', '/tmp/case', '--candidate-diff', '/tmp/fix.diff', '--before-log', '/tmp/before.log', '--after-log', '/tmp/after.log', '--format', 'text'],
    ['audit', '--case-dir', '/tmp/case', '--candidate-diff', '/tmp/fix.diff', '--before-log', '/tmp/before.log', '--before-log', '/tmp/again.log', '--after-log', '/tmp/after.log', '--format', 'json'],
    ['replay', '--format', 'json'],
    ['replay', '--bundle', '/tmp/replay.json', '--format', 'json', '--unknown'],
    ['replay', '--bundle', '/tmp/replay.json', '--bundle', '/tmp/other.json', '--format', 'json'],
    ['replay', '--bundle', '/tmp/replay.json', '--format', 'text'],
    ['replay', '--bundle', '/tmp/replay.json', '--format', 'json', '--runtime', 'ruby'],
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

describe('parseArgs counterfactual alternatives', () => {
  it('parses --alternatives-file as a path', () => {
    expect(parseArgs([
      'heal', '--case-dir', '/tmp/case', '--format', 'json',
      '--alternatives-file', '/tmp/alternatives.json',
    ])).toEqual({
      command: 'heal',
      caseDir: '/tmp/case',
      format: 'json',
      alternativesFile: '/tmp/alternatives.json',
      tavilyEnabled: true,
    });
  });

  it('omits the field when the flag is absent', () => {
    expect(parseArgs(['heal', '--case-dir', '/tmp/case', '--format', 'json']))
      .not.toHaveProperty('alternativesFile');
  });

  it.each([
    ['a missing value', ['heal', '--case-dir', '/tmp/case', '--format', 'json', '--alternatives-file']],
    ['a flag as the value', ['heal', '--case-dir', '/tmp/case', '--format', 'json', '--alternatives-file', '--no-tavily']],
    ['a duplicate flag', ['heal', '--case-dir', '/tmp/case', '--format', 'json', '--alternatives-file', '/a.json', '--alternatives-file', '/b.json']],
  ])('refuses %s', (_case, args) => {
    expect(() => parseArgs(args)).toThrow(CliUsageError);
  });

  it('documents the flag in the usage text', async () => {
    const { USAGE } = await import('./args.js');

    expect(USAGE).toContain('--alternatives-file <file>');
  });
});
it('requires an explicit packet path and separate canonical authorization digest for long healing', () => {
  const prefix = ['heal', '--case-dir', '/tmp/project', '--format', 'json'];
  expect(() => parseArgs([...prefix, '--verification-packet', '/tmp/packet.json'])).toThrow();
  expect(() => parseArgs([...prefix, '--authorize-long-verification', 'a'.repeat(64)])).toThrow();
  expect(parseArgs([...prefix, '--verification-packet', '/tmp/packet.json', '--authorize-long-verification', 'a'.repeat(64)])).toMatchObject({ verificationPacket: '/tmp/packet.json', authorizeLongVerification: 'a'.repeat(64) });
  expect(() => parseArgs([...prefix, '--verification-packet', '/tmp/packet.json', '--authorize-long-verification', 'bad'])).toThrow();
});

describe('bounded explain arguments', () => {
  it('parses lexical and explicitly capped semantic navigation without reading credentials', () => {
    expect(parseArgs(['explain', '--case-file', '/tmp/case.json', '--query', 'Why stopped?'])).toEqual({ command: 'explain', caseFile: '/tmp/case.json', query: 'Why stopped?', semantic: false, json: false });
    expect(parseArgs(['explain', '--case-file', '/tmp/case.json', '--query', 'cause', '--semantic', '--max-usd', '0.002', '--json'])).toEqual({ command: 'explain', caseFile: '/tmp/case.json', query: 'cause', semantic: true, maxUsd: .002, json: true });
  });
  it.each([
    [], ['--case-file', '/tmp/case.json'], ['--query', 'why'],
    ['--case-file', '/tmp/case.json', '--query', ''],
    ['--case-file', '/tmp/case.json', '--query', '  '],
    ['--case-file', '/tmp/case.json', '--query', 'x', '--case-file', '/tmp/b.json'],
    ['--case-file', '/tmp/case.json', '--query', 'x', '--query', 'y'],
    ['--case-file', '/tmp/case.json', '--query', 'x', '--json', '--json'],
    ['--case-file', '/tmp/case.json', '--query', 'x', '--unknown'],
    ['--case-file', '/tmp/case.json', '--query', 'x', '--max-usd', '.001'],
    ['--case-file', '/tmp/case.json', '--query', 'x', '--semantic'],
    ['--case-file', '/tmp/case.json', '--query', 'x', '--semantic', '--max-usd', '0'],
    ['--case-file', '/tmp/case.json', '--query', 'x', '--semantic', '--max-usd', '-1'],
    ['--case-file', '/tmp/case.json', '--query', 'x', '--semantic', '--max-usd', '0.0021'],
    ['--case-file', '/tmp/case.json', '--query', 'x', '--semantic', '--max-usd', 'NaN'],
    ['--case-file', '/tmp/case.json', '--query', 'x', '--semantic', '--max-usd', 'Infinity'],
    ['--case-file', '/tmp/case.json', '--query', 'é'.repeat(1025)],
  ].map(flags => [flags] as const))('rejects malformed navigation arguments %j', flags => {
    expect(() => parseArgs(['explain', ...flags])).toThrow(CliUsageError);
  });
  it('bounds query bytes rather than characters and advertises the data boundary', async () => {
    expect(parseArgs(['explain', '--case-file', '/tmp/case.json', '--query', 'é'.repeat(1024)])).toMatchObject({ query: 'é'.repeat(1024) });
    const { USAGE } = await import('./args.js');
    expect(USAGE).toContain('sutura explain --case-file <path> --query <text>');
    expect(USAGE).toContain('redacted query');
    expect(USAGE).toContain('bounded evidence');
  });
});
