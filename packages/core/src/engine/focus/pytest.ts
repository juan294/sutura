import {
  launcherFor,
  partitionOptions,
  quote,
  repositoryPath,
  splitEnvironment,
  type FocusRunner,
  type LogScan,
} from './shared.js';

const LAUNCHERS = [['python', '-m'], ['python3', '-m']] as const;
const SHORT_VALUED = new Set(['-k', '-m', '-n', '-c', '-p', '-o', '-W', '-r']);
const LONG_VALUED = new Set([
  '--rootdir', '--tb', '--maxfail', '--durations', '--timeout', '--import-mode', '--basetemp',
  '--log-level', '--log-cli-level', '--confcutdir', '--deselect', '--ignore', '--ignore-glob',
  '--junitxml', '--junit-xml', '--cov-report', '--cov-config', '--cov-fail-under',
  '--numprocesses', '--dist', '--color', '--capture', '--override-ini', '--randomly-seed',
]);
const FLAGS = new Set([
  '-q', '-qq', '-v', '-vv', '-vvv', '-x', '-s', '-l', '--quiet', '--verbose', '--exitfirst', '--strict-markers',
  '--strict-config', '--no-header', '--no-summary', '--disable-warnings', '--showlocals', '--cov',
  '--no-cov', '--lf', '--last-failed', '--ff', '--failed-first', '--runxfail', '--doctest-modules',
]);
const DROPPED = (option: string) =>
  option === '-k' || option === '-n' || option === '--numprocesses' || option === '--dist' ||
  option.startsWith('--cov') || option.startsWith('--junit') || option === '--deselect' ||
  option === '--lf' || option === '--last-failed' || option === '--ff' || option === '--failed-first' ||
  option === '--ignore' || option === '--ignore-glob' || option === '--doctest-modules';

/** `-n4`, `-kexpr`, `-pno:x` and `-ra` carry their value; `-vv` is a flag. */
function split(word: string): [string, string | undefined] {
  if (FLAGS.has(word)) return [word, undefined];
  const short = /^(-[a-zA-Z])(.+)$/u.exec(word);
  if (short && SHORT_VALUED.has(short[1]!)) return [short[1]!, short[2]!.replace(/^=/u, '')];
  const equals = word.indexOf('=');
  return equals < 0 ? [word, undefined] : [word.slice(0, equals), word.slice(equals + 1)];
}

/** `FAILED file::id` summary lines; the message is the `E ` block of the matching failure section. */
function scan(lines: readonly string[]): LogScan {
  const result: LogScan = { failures: [], loadErrors: 0 };
  const sections = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of lines) {
    const title = /^_{3,} (.+?) _{3,}$/u.exec(line);
    if (title) {
      current = [];
      sections.set(title[1]!, current);
    } else if (/^={3,} /u.test(line)) {
      current = undefined;
    } else if (current && /^E\s/u.test(line)) {
      current.push(line.slice(1).trim());
    }
  }
  const seen = new Set<string>();
  for (const line of lines) {
    if (/^ERROR\s/u.test(line) || /\berrors? during collection\b/u.test(line)) {
      result.loadErrors += 1;
      continue;
    }
    const failed = /^FAILED (\S+?)::(\S+)(?: - .*)?$/u.exec(line);
    if (!failed) continue;
    const file = repositoryPath(failed[1]!);
    const testId = `${failed[1]!}::${failed[2]!}`;
    if (file === undefined || seen.has(testId)) continue;
    seen.add(testId);
    const message = (sections.get(failed[2]!.replaceAll('::', '.')) ?? []).filter(Boolean).join('\n');
    result.failures.push({ file, testId: `${file}::${failed[2]!}`, message });
  }
  return result;
}

export const pytestRunner: FocusRunner = {
  name: 'pytest',
  parse(words) {
    const { environment, rest } = splitEnvironment(words);
    const launcher = launcherFor(rest, 'pytest', LAUNCHERS);
    if (launcher === undefined) return undefined;
    const kept = partitionOptions(rest.slice(launcher.length + 1), {
      valued: (option) => SHORT_VALUED.has(option) || LONG_VALUED.has(option),
      flag: (option) => FLAGS.has(option),
      dropped: DROPPED,
      split,
    });
    if (typeof kept === 'string') return `pytest ${kept}`;
    return { prefix: [...environment, ...launcher, 'pytest'], kept };
  },
  scan,
  focusedCommand(invocation, failure) {
    return [...invocation.prefix, ...invocation.kept, failure.testId].map(quote).join(' ');
  },
};
