import { describe, expect, it } from 'vitest';

import { CliUsageError, parseArgs } from './args.js';

describe('parseArgs', () => {
  it('parses the Placebo-compatible heal contract', () => {
    expect(parseArgs([
      'heal', '--case-dir', '/tmp/case', '--format', 'json',
      '--candidate-diff', 'diff --git a/a.js b/a.js\n', '--no-tavily',
    ])).toEqual({
      command: 'heal',
      caseDir: '/tmp/case',
      format: 'json',
      candidateDiff: 'diff --git a/a.js b/a.js\n',
      tavilyEnabled: false,
    });
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
  ];

  it.each(invalidArguments.map((args) => [args] as const))('rejects malformed arguments: %j', (args) => {
    expect(() => parseArgs(args)).toThrow(CliUsageError);
  });
});
