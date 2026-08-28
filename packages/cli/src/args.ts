const MAX_CANDIDATE_DIFF_BYTES = 1024 * 1024;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export const VERSION = '0.1.1';
export const USAGE = [
  'Usage:',
  '  sutura init [--workflow <name>] [--repo <owner/repo>] [--force] [--no-tavily]',
  '  sutura doctor [--repo <owner/repo>]',
  '  sutura heal --case-dir <dir> --format json [--candidate-diff <diff>] [--no-tavily]',
  '  sutura --help',
  '  sutura --version',
].join('\n');

export interface HealArguments {
  command: 'heal';
  caseDir: string;
  format: 'json';
  candidateDiff?: string;
  tavilyEnabled: boolean;
}

export interface InitArguments {
  command: 'init';
  workflow?: string;
  repository?: string;
  force: boolean;
  tavilyEnabled: boolean;
}

export interface DoctorArguments {
  command: 'doctor';
  repository?: string;
}

export interface HelpArguments {
  command: 'help';
}

export interface VersionArguments {
  command: 'version';
}

export type CliArguments =
  | HealArguments
  | InitArguments
  | DoctorArguments
  | HelpArguments
  | VersionArguments;

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

function nonEmptyValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliUsageError(`${flag} requires a value`);
  }
  return value;
}

function validateRepository(repository: string): string {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new CliUsageError('--repo must use owner/repo format');
  }
  return repository;
}

function parseHeal(args: readonly string[]): HealArguments {
  let caseDir: string | undefined;
  let format: string | undefined;
  let candidateDiff: string | undefined;
  let tavilyEnabled = true;
  const seen = new Set<string>();

  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag || !['--case-dir', '--format', '--candidate-diff', '--no-tavily'].includes(flag)) {
      throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    }
    if (seen.has(flag)) throw new CliUsageError(`Duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === '--no-tavily') {
      tavilyEnabled = false;
      continue;
    }
    const value = nonEmptyValue(args, index, flag);
    index += 1;
    if (flag === '--case-dir') caseDir = value;
    else if (flag === '--format') format = value;
    else candidateDiff = value;
  }

  if (!caseDir) throw new CliUsageError('--case-dir is required');
  if (format !== 'json') throw new CliUsageError('--format must be json');
  if (
    candidateDiff !== undefined &&
    Buffer.byteLength(candidateDiff, 'utf8') > MAX_CANDIDATE_DIFF_BYTES
  ) {
    throw new CliUsageError(`--candidate-diff exceeds ${MAX_CANDIDATE_DIFF_BYTES} bytes`);
  }
  return {
    command: 'heal',
    caseDir,
    format: 'json',
    ...(candidateDiff === undefined ? {} : { candidateDiff }),
    tavilyEnabled,
  };
}

function parseInit(args: readonly string[]): InitArguments {
  let workflow: string | undefined;
  let repository: string | undefined;
  let force = false;
  let tavilyEnabled = true;
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag || !['--workflow', '--repo', '--force', '--no-tavily'].includes(flag)) {
      throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    }
    if (seen.has(flag)) throw new CliUsageError(`Duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === '--force') {
      force = true;
      continue;
    }
    if (flag === '--no-tavily') {
      tavilyEnabled = false;
      continue;
    }
    const value = nonEmptyValue(args, index, flag);
    index += 1;
    if (flag === '--workflow') {
      if (value.length > 100 || /[\r\n]/u.test(value)) {
        throw new CliUsageError('--workflow must be one line with at most 100 characters');
      }
      workflow = value;
    } else {
      repository = validateRepository(value);
    }
  }
  return {
    command: 'init',
    ...(workflow ? { workflow } : {}),
    ...(repository ? { repository } : {}),
    force,
    tavilyEnabled,
  };
}

function parseDoctor(args: readonly string[]): DoctorArguments {
  if (args.length === 1) return { command: 'doctor' };
  if (args.length !== 3 || args[1] !== '--repo') {
    throw new CliUsageError(`Unknown argument: ${args[1] ?? '(missing)'}`);
  }
  return { command: 'doctor', repository: validateRepository(nonEmptyValue(args, 1, '--repo')) };
}

export function parseArgs(args: readonly string[]): CliArguments {
  if (args.length === 1 && (args[0] === '--help' || args[0] === 'help')) return { command: 'help' };
  if (args.length === 1 && (args[0] === '--version' || args[0] === 'version')) return { command: 'version' };
  if (args[0] === 'heal') return parseHeal(args);
  if (args[0] === 'init') return parseInit(args);
  if (args[0] === 'doctor') return parseDoctor(args);
  throw new CliUsageError(`Unknown command: ${args[0] ?? '(missing)'}`);
}
