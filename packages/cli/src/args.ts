const MAX_CANDIDATE_DIFF_BYTES = 1024 * 1024;

export const USAGE = 'Usage: sutura heal --case-dir <dir> --format json [--candidate-diff <diff>] [--no-tavily]';

export interface HealArguments {
  command: 'heal';
  caseDir: string;
  format: 'json';
  candidateDiff?: string;
  tavilyEnabled: boolean;
}

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

export function parseArgs(args: readonly string[]): HealArguments {
  if (args[0] !== 'heal') throw new CliUsageError('Expected the heal command');

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
