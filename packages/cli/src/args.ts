import { semanticConfig, type SemanticConfig, type SemanticRole, type DecisionMode } from '@sutura/core';
const MAX_CANDIDATE_DIFF_BYTES = 1024 * 1024;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const SHA_PATTERN = /^[a-f0-9]{40}$/iu;

export const VERSION = '0.4.1';
export const USAGE = [
  'Usage:',
  '  sutura assess [path] [--json]',
  '  sutura diagnose --repo <owner/repo> --run-id <id> [--json]',
  '  sutura init --plan [--workflow <name>] [--repo <owner/repo>] [--action-sha <commit>] [--credential <name>]',
  '  sutura init --apply <plan-digest> [same plan options]',
  '  sutura <upgrade|pause|resume|remove> --plan | --apply <plan-digest>',
  '  sutura doctor [--repo <owner/repo>] [--action-sha <commit>]',
  '  sutura heal --case-dir <dir> --format json [--candidate-diff <diff>] [--alternatives-file <file>] [--routing-profile <id>] [--runtime <auto|node|python>] [--no-tavily]',
  '  Local Jev experiments: --jev-<ranking|grounding|classification|recovery> <off|shadow|assist> --jev-budget-usd <0..0.02>; non-off requires a key. Shadow captures redacted local input without inference.',
  '  Long verification: add --verification-packet <private-envelope-file> --authorize-long-verification <canonical-packet-sha256>; separate approved spending is required.',
  '  sutura verify --case-dir <dir> --source-sha <commit> --policy-base-sha <commit> --candidate-diff <file> --failing-command <id> [--runtime <auto|node|python>] --format json',
  '  sutura audit --case-dir <dir> --candidate-diff <file> --before-log <file> --after-log <file> --format json',
  '  sutura replay --bundle <file> --format json [--runtime <auto|node|python>]',
  '  sutura explain --case-file <path> --query <text> [--semantic --max-usd <amount>] [--json]',
  '  Explain reads one stable local JSON file without running repairs. --semantic requires a positive cap up to USD 0.002 and sends only the redacted query and bounded evidence candidates to TypeSafe using the existing TYPESAFE_API_KEY.',
  '  sutura eval validate --manifest <file>',
  '  sutura eval export --manifest <file> --format <atif|jsonl> --output <file> [--force]',
  '  sutura --help',
  '  sutura --version',
  '',
  'Start with assess: no accounts, provider calls or source execution. Static support is not a reproduced repair.',
  'Review access, providers and costs in init --plan before applying. ConTree access is required for live repair.',
].join('\n');

export interface AssessArguments {
  command: 'assess';
  path: string;
  json: boolean;
}

export interface DiagnoseArguments {
  command: 'diagnose';
  repository: string;
  runId: number;
  json: boolean;
}

export interface HealArguments {
  semantic?: SemanticConfig;
  command: 'heal';
  verificationPacket?: string;
  authorizeLongVerification?: string;
  caseDir: string;
  format: 'json';
  candidateDiff?: string;
  /**
   * Path to a JSON file holding `{ "alternatives": [...] }`. A path, never
   * inline JSON, because a three-entry alternative set exceeds a comfortable
   * argv value. The file is read and validated in `heal.ts`.
   */
  alternativesFile?: string;
  routingProfile?: string;
  runtime?: 'node' | 'python';
  /**
   * The failing command to reproduce, exactly as CI ran it. Without it the
   * core uses its per-runtime default (`pnpm test`, or `python -m unittest`).
   */
  failingCommand?: string;
  tavilyEnabled: boolean;
}

export interface InitArguments {
  command: 'init';
  workflow?: string;
  repository?: string;
  actionSha?: string;
  force: boolean;
  tavilyEnabled: boolean;
  plan?: boolean;
  apply?: string;
  credentials?: string[];
  json?: boolean;
  operation?: 'init' | 'upgrade' | 'pause' | 'resume' | 'remove';
}

/**
 * Execution-backed verification of a patch this tool did not write. Every
 * identity is exact and required: a branch name or short sha cannot stand in
 * for the commit that failed, and the trusted policy commit is chosen by the
 * operator rather than by the patch. The candidate is always a file path, never
 * inline bytes, so a large diff never has to survive argv.
 */
export interface VerifyArguments {
  command: 'verify';
  verificationPacket?: string;
  authorizeLongVerification?: string;
  caseDir: string;
  sourceSha: string;
  policyBaseSha: string;
  candidateDiff: string;
  failingCommand: string;
  runtime?: 'node' | 'python';
  format: 'json';
}

export interface AuditArguments {
  command: 'audit';
  caseDir: string;
  candidateDiff: string;
  beforeLog: string;
  afterLog: string;
  format: 'json';
}

export interface ReplayArguments {
  command: 'replay';
  bundle: string;
  format: 'json';
  runtime?: 'node' | 'python';
}

export interface ExplainArguments {
  command: 'explain';
  caseFile: string;
  query: string;
  semantic: boolean;
  maxUsd?: number;
  json: boolean;
}

export interface DoctorArguments {
  command: 'doctor';
  repository?: string;
  actionSha?: string;
}

export interface HelpArguments {
  command: 'help';
}

export interface VersionArguments {
  command: 'version';
}

export interface EvalValidateArguments {
  command: 'eval-validate';
  manifest: string;
}

export interface EvalExportArguments {
  command: 'eval-export';
  manifest: string;
  format: 'atif' | 'jsonl';
  output: string;
  force: boolean;
}

export type CliArguments =
  | AssessArguments
  | DiagnoseArguments
  | HealArguments
  | VerifyArguments
  | AuditArguments
  | ReplayArguments
  | ExplainArguments
  | InitArguments
  | DoctorArguments
  | EvalValidateArguments
  | EvalExportArguments
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

function validateActionSha(value: string): string {
  if (!SHA_PATTERN.test(value)) {
    throw new CliUsageError('--action-sha must be an exact 40-character commit');
  }
  return value.toLowerCase();
}

const MAX_FAILING_COMMAND_BYTES = 256;

function validateFailingCommand(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    Buffer.byteLength(trimmed, 'utf8') > MAX_FAILING_COMMAND_BYTES ||
    !/^[\x20-\x7e]+$/u.test(trimmed)
  ) {
    throw new CliUsageError(
      `--failing-command must be printable ASCII on one line, at most ${MAX_FAILING_COMMAND_BYTES} bytes`,
    );
  }
  return trimmed;
}

function validateLongVerificationArguments(packet: string | undefined, digest: string | undefined): void {
  if ((packet === undefined) !== (digest === undefined)) throw new CliUsageError('--verification-packet and --authorize-long-verification must be supplied together');
  if (digest !== undefined && !/^[a-f0-9]{64}$/u.test(digest)) throw new CliUsageError('--authorize-long-verification must be the exact canonical packet SHA-256');
}

function parseHeal(args: readonly string[]): HealArguments {
  let caseDir: string | undefined;
  let format: string | undefined;
  let candidateDiff: string | undefined;
  let alternativesFile: string | undefined;
  let failingCommand: string | undefined;
  let routingProfile: string | undefined;
  let runtime: 'node' | 'python' | undefined;
  let tavilyEnabled = true;
  let verificationPacket: string | undefined, authorizeLongVerification: string | undefined;
  const semanticModes: Record<SemanticRole, DecisionMode> = { ranking: 'off', grounding: 'off', classification: 'off', recovery: 'off' };
  let semanticBudget: number | undefined;
  let semanticSelected = false;
  const seen = new Set<string>();

  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag || !['--case-dir', '--format', '--candidate-diff', '--alternatives-file', '--failing-command', '--routing-profile', '--runtime', '--no-tavily', '--verification-packet', '--authorize-long-verification', '--jev-ranking', '--jev-grounding', '--jev-classification', '--jev-recovery', '--jev-budget-usd'].includes(flag)) {
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
    if (flag === '--jev-budget-usd') {
      semanticBudget = Number(value); semanticSelected = true;
    } else if (flag.startsWith('--jev-')) {
      if (!['off', 'shadow', 'assist'].includes(value)) throw new CliUsageError(`${flag} must be off, shadow, or assist`);
      semanticModes[flag.slice(6) as SemanticRole] = value as DecisionMode; semanticSelected = true;
    } else if (flag === '--case-dir') caseDir = value;
    else if (flag === '--format') format = value;
    else if (flag === '--candidate-diff') candidateDiff = value;
    else if (flag === '--alternatives-file') alternativesFile = value;
    else if (flag === '--failing-command') failingCommand = validateFailingCommand(value);
    else if (flag === '--routing-profile') routingProfile = value;
    else if (flag === '--verification-packet') verificationPacket = value;
    else if (flag === '--authorize-long-verification') authorizeLongVerification = value;
    else if (value === 'auto') runtime = undefined;
    else if (value === 'node' || value === 'python') runtime = value;
    else throw new CliUsageError('--runtime must be auto, node, or python');
  }

  let semantic: SemanticConfig | undefined;
  if (semanticSelected) {
    try {
      semantic = semanticConfig({ schemaVersion: 'sutura-semantic-config-v1', model: 'jev-1.14.0', policyVersion: 'semantic-v1', modes: semanticModes, maxUsd: semanticBudget ?? 0 }, true);
    } catch (error) { throw new CliUsageError(`Invalid --jev options: ${error instanceof Error ? error.message : String(error)}; choose off or supply a positive --jev-budget-usd up to 0.02`); }
  }
  validateLongVerificationArguments(verificationPacket, authorizeLongVerification);
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
    ...(semantic === undefined ? {} : { semantic }),
    ...(verificationPacket === undefined ? {} : { verificationPacket, authorizeLongVerification: authorizeLongVerification! }),
    caseDir,
    format: 'json',
    ...(candidateDiff === undefined ? {} : { candidateDiff }),
    ...(alternativesFile === undefined ? {} : { alternativesFile }),
    ...(failingCommand === undefined ? {} : { failingCommand }),
    ...(routingProfile === undefined ? {} : { routingProfile }),
    ...(runtime === undefined ? {} : { runtime }),
    tavilyEnabled,
  };
}

function parseInit(args: readonly string[]): InitArguments {
  let workflow: string | undefined;
  let repository: string | undefined;
  let actionSha: string | undefined;
  let force = false;
  let tavilyEnabled = true;
  let plan = false, json = false;
  let apply: string | undefined;
  const credentials: string[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag || !['--workflow', '--repo', '--action-sha', '--force', '--no-tavily', '--plan', '--apply', '--credential', '--json'].includes(flag)) {
      throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    }
    if (seen.has(flag) && flag !== '--credential') throw new CliUsageError(`Duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === '--plan') { plan = true; continue; }
    if (flag === '--json') { json = true; continue; }
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
    if (flag === '--apply') {
      if (!/^[a-f0-9]{64}$/u.test(value)) throw new CliUsageError('--apply requires the exact plan digest');
      apply = value;
    } else if (flag === '--credential') {
      if (!/^[A-Z][A-Z0-9_]{0,79}$/u.test(value) || credentials.includes(value)) throw new CliUsageError('Invalid or duplicate credential name');
      credentials.push(value);
    } else if (flag === '--workflow') {
      if (value.length > 100 || /[\r\n]/u.test(value)) {
        throw new CliUsageError('--workflow must be one line with at most 100 characters');
      }
      workflow = value;
    } else if (flag === '--repo') {
      repository = validateRepository(value);
    } else {
      actionSha = validateActionSha(value);
    }
  }
  if (plan && apply) throw new CliUsageError('--plan and --apply cannot be used together');
  return {
    command: 'init',
    ...(workflow ? { workflow } : {}),
    ...(repository ? { repository } : {}),
    ...(actionSha ? { actionSha } : {}),
    force,
    tavilyEnabled,
    ...(plan ? { plan } : {}),
    ...(json ? { json } : {}),
    ...(apply ? { apply } : {}),
    ...(credentials.length ? { credentials } : {}),
  };
}

function parseVerify(args: readonly string[]): VerifyArguments {
  const values = new Map<string, string>();
  const required = ['--case-dir', '--source-sha', '--policy-base-sha', '--candidate-diff', '--failing-command', '--format'];
  const allowed = new Set([...required, '--runtime', '--verification-packet', '--authorize-long-verification']);
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    if (!flag || !allowed.has(flag)) throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    if (values.has(flag)) throw new CliUsageError(`Duplicate argument: ${flag}`);
    values.set(flag, nonEmptyValue(args, index, flag));
  }
  for (const flag of required) {
    if (!values.has(flag)) throw new CliUsageError(`${flag} is required`);
  }
  if (values.get('--format') !== 'json') throw new CliUsageError('--format must be json');
  for (const flag of ['--source-sha', '--policy-base-sha']) {
    const value = values.get(flag) as string;
    if (!/^[a-f0-9]{40}$/u.test(value)) {
      throw new CliUsageError(`${flag} must be an exact lowercase 40-character commit`);
    }
  }
  validateLongVerificationArguments(values.get('--verification-packet'), values.get('--authorize-long-verification'));
  const runtimeValue = values.get('--runtime');
  if (runtimeValue !== undefined && !['auto', 'node', 'python'].includes(runtimeValue)) {
    throw new CliUsageError('--runtime must be auto, node, or python');
  }
  const runtime = runtimeValue === undefined || runtimeValue === 'auto'
    ? undefined
    : runtimeValue as 'node' | 'python';
  return {
    command: 'verify',
    ...(values.has('--verification-packet') ? { verificationPacket: values.get('--verification-packet')!, authorizeLongVerification: values.get('--authorize-long-verification')! } : {}),
    caseDir: values.get('--case-dir') as string,
    sourceSha: values.get('--source-sha') as string,
    policyBaseSha: values.get('--policy-base-sha') as string,
    candidateDiff: values.get('--candidate-diff') as string,
    failingCommand: values.get('--failing-command') as string,
    ...(runtime === undefined ? {} : { runtime }),
    format: 'json',
  };
}

function parseAudit(args: readonly string[]): AuditArguments {
  const values = new Map<string, string>();
  const allowed = new Set(['--case-dir', '--candidate-diff', '--before-log', '--after-log', '--format']);
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    if (!flag || !allowed.has(flag)) throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    if (values.has(flag)) throw new CliUsageError(`Duplicate argument: ${flag}`);
    values.set(flag, nonEmptyValue(args, index, flag));
  }
  for (const flag of allowed) {
    if (!values.has(flag)) throw new CliUsageError(`${flag} is required`);
  }
  if (values.get('--format') !== 'json') throw new CliUsageError('--format must be json');
  return {
    command: 'audit',
    caseDir: values.get('--case-dir') as string,
    candidateDiff: values.get('--candidate-diff') as string,
    beforeLog: values.get('--before-log') as string,
    afterLog: values.get('--after-log') as string,
    format: 'json',
  };
}

function parseReplay(args: readonly string[]): ReplayArguments {
  let bundle: string | undefined;
  let format: string | undefined;
  let runtime: 'node' | 'python' | undefined;
  const allowed = new Set(['--bundle', '--format', '--runtime']);
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    if (!flag || !allowed.has(flag)) {
      throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    }
    if (seen.has(flag)) throw new CliUsageError(`Duplicate argument: ${flag}`);
    seen.add(flag);
    const value = nonEmptyValue(args, index, flag);
    if (flag === '--bundle') bundle = value;
    else if (flag === '--format') format = value;
    else if (value === 'auto') runtime = undefined;
    else if (value === 'node' || value === 'python') runtime = value;
    else throw new CliUsageError('--runtime must be auto, node, or python');
  }
  if (!bundle) throw new CliUsageError('--bundle is required');
  if (format !== 'json') throw new CliUsageError('--format must be json');
  return {
    command: 'replay',
    bundle,
    format: 'json',
    ...(runtime === undefined ? {} : { runtime }),
  };
}

function parseExplain(args: readonly string[]): ExplainArguments {
  const values = new Map<string, string>();
  const seen = new Set<string>();
  const allowed = new Set(['--case-file', '--query', '--semantic', '--max-usd', '--json']);
  for (let index = 1; index < args.length; index++) {
    const flag = args[index];
    if (!flag || !allowed.has(flag) || seen.has(flag)) throw new CliUsageError('Unknown or duplicate explain argument');
    seen.add(flag);
    if (flag === '--semantic' || flag === '--json') continue;
    values.set(flag, nonEmptyValue(args, index, flag));
    index++;
  }
  const caseFile = values.get('--case-file'), query = values.get('--query');
  if (!caseFile?.trim()) throw new CliUsageError('--case-file must name the actual stable regular JSON file');
  if (!query?.trim() || Buffer.byteLength(query, 'utf8') > 2048) throw new CliUsageError('--query must be nonempty and at most 2 KiB in UTF-8');
  const semantic = seen.has('--semantic');
  const rawCap = values.get('--max-usd');
  if (!semantic && rawCap !== undefined) throw new CliUsageError('--max-usd requires --semantic');
  const maxUsd = rawCap === undefined ? undefined : Number(rawCap);
  if (semantic && (maxUsd === undefined || !Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > .002)) throw new CliUsageError('--semantic requires a positive --max-usd at most 0.002');
  return { command: 'explain', caseFile, query, semantic, json: seen.has('--json'), ...(maxUsd === undefined ? {} : { maxUsd }) };
}

function parseDoctor(args: readonly string[]): DoctorArguments {
  let repository: string | undefined;
  let actionSha: string | undefined;
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    if (flag !== '--repo' && flag !== '--action-sha') {
      throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    }
    if (seen.has(flag)) throw new CliUsageError(`Duplicate argument: ${flag}`);
    seen.add(flag);
    const value = nonEmptyValue(args, index, flag);
    if (flag === '--repo') repository = validateRepository(value);
    else actionSha = validateActionSha(value);
  }
  return {
    command: 'doctor',
    ...(repository ? { repository } : {}),
    ...(actionSha ? { actionSha } : {}),
  };
}

function parseEval(args: readonly string[]): EvalValidateArguments | EvalExportArguments {
  const operation = args[1];
  if (operation !== 'validate' && operation !== 'export') {
    throw new CliUsageError(`Unknown eval command: ${operation ?? '(missing)'}`);
  }
  let manifest: string | undefined;
  let format: string | undefined;
  let output: string | undefined;
  let force = false;
  const allowed = operation === 'validate'
    ? ['--manifest']
    : ['--manifest', '--format', '--output', '--force'];
  const seen = new Set<string>();
  for (let index = 2; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag || !allowed.includes(flag)) throw new CliUsageError(`Unknown argument: ${flag ?? '(missing)'}`);
    if (seen.has(flag)) throw new CliUsageError(`Duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === '--force') {
      force = true;
      continue;
    }
    const value = nonEmptyValue(args, index, flag);
    index += 1;
    if (flag === '--manifest') manifest = value;
    else if (flag === '--format') format = value;
    else output = value;
  }
  if (!manifest) throw new CliUsageError('--manifest is required');
  if (operation === 'validate') return { command: 'eval-validate', manifest };
  if (format !== 'atif' && format !== 'jsonl') {
    throw new CliUsageError('--format must be atif or jsonl');
  }
  if (!output) throw new CliUsageError('--output is required');
  return { command: 'eval-export', manifest, format, output, force };
}

export function parseArgs(args: readonly string[]): CliArguments {
  if (args.length === 0 || (args.length === 2 && args[1] === '--help')) return { command: 'help' };
  if (args.length === 1 && (args[0] === '--help' || args[0] === 'help')) return { command: 'help' };
  if (args.length === 1 && (args[0] === '--version' || args[0] === 'version')) return { command: 'version' };
  if (args[0] === 'heal') return parseHeal(args);
  if (args[0] === 'verify') return parseVerify(args);
  if (args[0] === 'audit') return parseAudit(args);
  if (args[0] === 'replay') return parseReplay(args);
  if (args[0] === 'explain') return parseExplain(args);
  if (args[0] === 'init') return parseInit(args);
  if (['upgrade', 'pause', 'resume', 'remove'].includes(args[0] ?? '')) {
    return { ...parseInit(['init', ...args.slice(1)]), operation: args[0] as 'upgrade' | 'pause' | 'resume' | 'remove' };
  }
  if (args[0] === 'assess') {
    let path = '.', json = false, selected = false;
    for (const item of args.slice(1)) {
      if (item === '--json' && !json) json = true;
      else if (!item.startsWith('-') && !selected) { path = item; selected = true; }
      else throw new CliUsageError(`Unknown or duplicate assessment argument: ${item}`);
    }
    return { command: 'assess', path, json };
  }
  if (args[0] === 'diagnose') {
    const values = new Map<string, string>();
    let json = false;
    for (let i = 1; i < args.length; i++) {
      const flag = args[i]!;
      if (flag === '--json' && !json) { json = true; continue; }
      if (!['--repo', '--run-id'].includes(flag) || values.has(flag)) throw new CliUsageError('Invalid diagnosis scope');
      values.set(flag, nonEmptyValue(args, i, flag)); i++;
    }
    const repository = validateRepository(values.get('--repo') ?? '');
    const runId = Number(values.get('--run-id'));
    if (!Number.isSafeInteger(runId) || runId <= 0) throw new CliUsageError('--run-id must be a positive safe integer');
    return { command: 'diagnose', repository, runId, json };
  }
  if (args[0] === 'doctor') return parseDoctor(args);
  if (args[0] === 'eval') return parseEval(args);
  throw new CliUsageError(`Unknown command: ${args[0] ?? '(missing)'}`);
}
