import {
  messageBlock,
  partitionOptions,
  quote,
  repositoryPath,
  splitEnvironment,
  type FocusRunner,
  type LogScan,
  type ReportedFailure,
} from './shared.js';

const VALUED = new Set([
  '--test-reporter', '--test-reporter-destination', '--import', '--require', '-r', '--loader',
  '--experimental-loader', '--test-concurrency', '--test-timeout', '--test-name-pattern',
  '--test-skip-pattern', '--test-shard', '--test-isolation', '--env-file', '--conditions', '-C',
  '--test-coverage-include', '--test-coverage-exclude', '--test-coverage-branches',
  '--test-coverage-functions', '--test-coverage-lines',
]);
const FLAGS = new Set([
  '--test', '--test-only', '--no-warnings', '--enable-source-maps', '--experimental-test-coverage',
  '--experimental-strip-types', '--experimental-transform-types', '--experimental-test-module-mocks',
  '--experimental-vm-modules', '--test-force-exit', '--trace-warnings', '--expose-gc',
]);
const DROPPED = (option: string) =>
  option === '--test-name-pattern' || option === '--test-skip-pattern' || option === '--test-shard' ||
  option.startsWith('--test-coverage') || option === '--experimental-test-coverage';

const LOCATION = /^(.+):(\d+:\d+)$/u;

/** The repository file and `file:line:column` of a test location; the line tells same-named tests apart. */
function located(location: string): { file: string; at: string } | undefined {
  const match = LOCATION.exec(location.trim());
  const file = repositoryPath(match?.[1] ?? '');
  return match && file !== undefined ? { file, at: `${file}:${match[2]!}` } : undefined;
}

/** A failure reported against the test file itself (load error or a process exit) is not test-level. */
function record(result: LogScan, seen: Set<string>, failure: ReportedFailure & { name: string }): void {
  if (failure.name === failure.file || failure.message === "'test failed'") {
    result.loadErrors += 1;
    return;
  }
  if (seen.has(failure.testId)) return;
  seen.add(failure.testId);
  result.failures.push({ file: failure.file, testId: failure.testId, message: failure.message });
}

/** TAP `not ok N - name` with `location:`/`error:`, or the spec reporter's `test at file:L:C` + `✖ name`. */
function scan(lines: readonly string[]): LogScan {
  const result: LogScan = { failures: [], loadErrors: 0 };
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const tap = /^(\s*)not ok \d+ - (.+?)\s*$/u.exec(line);
    if (tap) {
      const indent = tap[1]!.length + 2;
      const yaml: string[] = [];
      for (const next of lines.slice(index + 1)) {
        if (next.trim() === '...' || (next.trim() !== '' && next.length - next.trimStart().length < indent)) break;
        yaml.push(next.slice(indent));
      }
      if (!yaml.some((entry) => entry === "failureType: 'testCodeFailure'")) continue; // suites report their subtests
      const location = /^location: '(.+)'$/u.exec(yaml.find((entry) => entry.startsWith('location:')) ?? '');
      const where = location ? located(location[1]!) : undefined;
      const errorAt = yaml.findIndex((entry) => entry.startsWith('error:'));
      if (where === undefined || errorAt < 0) continue;
      const inline = yaml[errorAt]!.slice('error:'.length).trim();
      const message = inline === '|-' || inline === '|'
        ? messageBlock(yaml, errorAt + 1, (entry) => /^\S/u.test(entry))
        : inline;
      record(result, seen, { file: where.file, name: tap[2]!, testId: `${where.at} > ${tap[2]!}`, message });
      continue;
    }
    const at = /^test at (.+)$/u.exec(line);
    const cross = /^✖ (.+?)(?: \([\d.]+m?s\))?\s*$/u.exec(lines[index + 1] ?? '');
    if (at && cross) {
      const where = located(at[1]!);
      if (where === undefined) continue;
      const message = messageBlock(lines, index + 2, (next) => /^\s+at /u.test(next) || /^\s*(?:test at |\{$)/u.test(next) || next.trimEnd().endsWith('{'));
      record(result, seen, { file: where.file, name: cross[1]!, testId: `${where.at} > ${cross[1]!}`, message });
    }
  }
  return result;
}

export const nodeTestRunner: FocusRunner = {
  name: 'node-test',
  parse(words) {
    const { environment, rest } = splitEnvironment(words);
    const testAt = rest.indexOf('--test');
    if (rest[0] !== 'node' || testAt < 0) return undefined;
    const grammar = { valued: (option: string) => VALUED.has(option), flag: (option: string) => FLAGS.has(option), dropped: DROPPED };
    // Before --test a bare word is a script that runs the tests itself, which narrowing would drop.
    const node = partitionOptions(rest.slice(1, testAt), { ...grammar, positionals: 'reject' });
    const test = partitionOptions(rest.slice(testAt), grammar);
    const kept = typeof node === 'string' ? node : typeof test === 'string' ? test : [...node, ...test];
    if (typeof kept === 'string') return `node --test ${kept}`;
    return { prefix: [...environment, 'node'], kept };
  },
  scan,
  focusedCommand(invocation, failure) {
    return [...invocation.prefix, ...invocation.kept, failure.file].map(quote).join(' ');
  },
};
