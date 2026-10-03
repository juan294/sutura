import {
  launcherFor,
  PACKAGE_LAUNCHERS,
  partitionOptions,
  quote,
  repositoryPath,
  splitEnvironment,
  type FocusRunner,
  type LogScan,
} from './shared.js';

const VALUED = new Set([
  '--config', '-c', '--root', '-r', '--dir', '--project', '--shard', '--reporter', '--outputFile',
  '--testNamePattern', '-t', '--pool', '--environment', '--mode', '--maxWorkers', '--minWorkers',
  '--testTimeout', '--hookTimeout', '--retry', '--bail', '--sequence.seed',
]);
const FLAGS = new Set([
  '--run', '--globals', '--passWithNoTests', '--silent', '--no-color', '--color',
  '--allowOnly', '--no-file-parallelism', '--fileParallelism', '--isolate', '--no-isolate',
  '--typecheck', '--changed', '--update', '-u', '--clearScreen', '--hideSkippedTests',
]);
const DROPPED = new Set(['--shard', '--reporter', '--outputFile', '--testNamePattern', '-t', '--changed', '--passWithNoTests']);

const FAIL_HEADER = /^\s*FAIL\s+(\S+) > (.+?)\s*$/u;

/** ` FAIL  file > name` followed by the error, or a GitHub `::error file=…,title=file > name…::message` annotation. */
function scan(lines: readonly string[]): LogScan {
  const result: LogScan = { failures: [], loadErrors: 0 };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\s*FAIL\s+\S+ \[ \S+ \]\s*$/u.test(line) || /⎯ Unhandled Errors? ⎯/u.test(line)) {
      result.loadErrors += 1;
      continue;
    }
    const header = FAIL_HEADER.exec(line);
    if (header) {
      const file = repositoryPath(header[1]!);
      // Vitest prints one error under consecutive headers of tests that failed identically.
      const message = lines.slice(index + 1).find((next) => next.trim() !== '' && !FAIL_HEADER.test(next))?.trim() ?? '';
      if (file !== undefined) result.failures.push({ file, testId: `${file} > ${header[2]!}`, message });
      continue;
    }
    if (line.startsWith('::error')) {
      const annotation = /^::error file=([^,]+),title=([^,]+?)(?:,line=\d+)?(?:,column=\d+)?::(.*)$/u.exec(line);
      const file = annotation ? repositoryPath(annotation[1]!) : undefined;
      const title = annotation?.[2]!.split(' > ') ?? [];
      const titleFile = repositoryPath(title[0] ?? '');
      if (annotation && file !== undefined && titleFile === file && title.length > 1) {
        result.failures.push({ file, testId: `${file} > ${title.slice(1).join(' > ')}`, message: annotation[3]!.split('%0A')[0] ?? '' });
      } else {
        result.loadErrors += 1; // a file that failed to load, or an unhandled error
      }
    }
  }
  return result;
}

export const vitestRunner: FocusRunner = {
  name: 'vitest',
  parse(words) {
    const { environment, rest } = splitEnvironment(words);
    const launcher = launcherFor(rest, 'vitest', PACKAGE_LAUNCHERS);
    if (launcher === undefined) return undefined;
    const args = rest.slice(launcher.length + 1);
    const subcommand = args[0] !== undefined && /^[a-z]+$/u.test(args[0]) ? args[0] : undefined;
    if (subcommand !== undefined && subcommand !== 'run') return `vitest subcommand ${subcommand} has no focused form`;
    const kept = partitionOptions(args.slice(subcommand === undefined ? 0 : 1), {
      valued: (option) => VALUED.has(option),
      flag: (option) => FLAGS.has(option) || option.startsWith('--coverage'),
      dropped: (option) => DROPPED.has(option) || option.startsWith('--coverage'),
    });
    if (typeof kept === 'string') return `vitest ${kept}`;
    return { prefix: [...environment, ...launcher, 'vitest', 'run'], kept };
  },
  scan,
  focusedCommand(invocation, failure) {
    return [...invocation.prefix, ...invocation.kept, failure.file].map(quote).join(' ');
  },
};
