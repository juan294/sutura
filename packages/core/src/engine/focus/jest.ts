import {
  launcherFor,
  PACKAGE_LAUNCHERS,
  messageBlock,
  partitionOptions,
  quote,
  repositoryPath,
  splitEnvironment,
  type FocusRunner,
  type LogScan,
} from './shared.js';

const VALUED = new Set([
  '--config', '-c', '--rootDir', '--roots', '--selectProjects', '--maxWorkers', '-w', '--testTimeout',
  '--seed', '--shard', '--reporters', '--outputFile', '--testNamePattern', '-t', '--testPathPattern',
  '--testPathPatterns', '--testPathIgnorePatterns', '--coverageReporters', '--coverageDirectory',
  '--coverageProvider', '--collectCoverageFrom', '--env', '--testEnvironment',
]);
const FLAGS = new Set([
  '--ci', '--coverage', '--collectCoverage', '--runInBand', '-i', '--silent', '--verbose', '--passWithNoTests',
  '--detectOpenHandles', '--forceExit', '--no-cache', '--bail', '--colors', '--no-colors', '--logHeapUsage',
  '--runTestsByPath', '--errorOnDeprecated', '--injectGlobals', '--no-watchman', '--useStderr',
]);
const DROPPED = new Set([
  '--shard', '--reporters', '--outputFile', '--testNamePattern', '-t', '--testPathPattern', '--testPathPatterns',
  '--passWithNoTests', '--runTestsByPath',
]);
const SUITE_HEADER = /^\s*(FAIL|PASS)\s+(?:\S+\s+)?(\S+\.[cm]?[jt]sx?)\s*(?:\(.*\))?$/u;
const CODE_FRAME = /^\s*>?\s*\d+ \||^\s*\| |^\s+at /u;

/** `FAIL <file>` then `● suite › name` blocks; `● Test suite failed to run` is a load error. */
function scan(lines: readonly string[]): LogScan {
  const result: LogScan = { failures: [], loadErrors: 0 };
  const seen = new Set<string>();
  let file: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const suite = SUITE_HEADER.exec(line);
    if (suite) {
      file = suite[1] === 'FAIL' ? repositoryPath(suite[2]!) : undefined;
      continue;
    }
    if (/^(?:Summary of all failing tests|Test Suites:)/u.test(line.trim())) file = undefined;
    const bullet = /^\s*● (.+?)\s*$/u.exec(line);
    if (!bullet || file === undefined || bullet[1] === 'Console') continue; // buffered console output, not a test
    if (bullet[1] === 'Test suite failed to run') {
      result.loadErrors += 1;
      continue;
    }
    const testId = `${file} › ${bullet[1]!}`;
    if (seen.has(testId)) continue;
    seen.add(testId);
    result.failures.push({ file, testId, message: messageBlock(lines, index + 1, (next) => CODE_FRAME.test(next) || /^\s*● /u.test(next)) });
  }
  return result;
}

export const jestRunner: FocusRunner = {
  name: 'jest',
  parse(words) {
    const { environment, rest } = splitEnvironment(words);
    const launcher = launcherFor(rest, 'jest', PACKAGE_LAUNCHERS);
    if (launcher === undefined) return undefined;
    const kept = partitionOptions(rest.slice(launcher.length + 1), {
      valued: (option) => VALUED.has(option),
      flag: (option) => FLAGS.has(option),
      dropped: (option) => DROPPED.has(option) || option.startsWith('--coverage') || option === '--collectCoverage' || option === '--collectCoverageFrom',
    });
    if (typeof kept === 'string') return `jest ${kept}`;
    return { prefix: [...environment, ...launcher, 'jest'], kept };
  },
  scan,
  focusedCommand(invocation, failure) {
    return [...invocation.prefix, ...invocation.kept, '--runTestsByPath', failure.file].map(quote).join(' ');
  },
};
