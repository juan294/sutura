import { Buffer } from 'node:buffer';

import type { Candidate, Diagnosis } from '../domain.js';
import type { Executor, ImageId, RunResult } from '../executor/types.js';
import type { FunctionToolDefinition } from '../llm/types.js';
import { policyAllowsSourceRead } from '../policy/evaluate.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import { redactExternalText } from '../security/external-text.js';
import { isSensitiveRepositoryPath } from '../security/repository-path.js';
import { boundedTail } from '../text/bounded-tail.js';
import { validateCandidateDiff } from './candidate-validation.js';
import { BudgetExceededError, type RepairBudget } from './repair-budget.js';
import { structuredEditsDiff, type RepairSourceContext } from './repair.js';
import { shellQuote } from './shell.js';

const MAX_TOOL_OUTPUT_BYTES = 16_000;
const MAX_READ_BYTES = 12_000;
const MAX_READ_LINES = 160;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_@./ -]+$/u;
const SENSITIVE_SEARCH_GLOBS = [
  '.env', '**/.env', '.env.*', '**/.env.*', '.netrc', '**/.netrc',
  '.npmrc', '**/.npmrc', '.pypirc', '**/.pypirc', 'credentials.json',
  '**/credentials.json', 'id_rsa', '**/id_rsa', 'id_ed25519', '**/id_ed25519',
  '*.key', '**/*.key', '*.pem', '**/*.pem', '*.p12', '**/*.p12',
  '*.pfx', '**/*.pfx', 'node_modules/**', '**/node_modules/**',
] as const;

export const REPAIR_TOOL_DEFINITIONS: readonly FunctionToolDefinition[] = [
  ['read_file', 'Read one bounded repository file.', { path: { type: 'string' }, startLine: { type: 'integer' }, endLine: { type: 'integer' } }, ['path']],
  ['search_repo', 'Search tracked repository files for a literal string.', { query: { type: 'string' }, paths: { type: 'array', items: { type: 'string' } } }, ['query']],
  ['run_test', 'Run one trusted test command by identifier.', { commandId: { type: 'string' } }, ['commandId']],
  ['apply_patch', 'Apply a complete unified diff or structured edits.', { diff: { type: 'string' }, edits: { type: 'array', items: { type: 'object' } } }, []],
  ['inspect_diff', 'Inspect the cumulative diff and policy findings.', {}, []],
  ['submit_candidate', 'Submit the tested cumulative repair candidate.', { id: { type: 'string' }, rationale: { type: 'string' } }, ['id', 'rationale']],
].map(([name, description, properties, required]) => ({
  type: 'function' as const,
  function: {
    name: name as string,
    description: description as string,
    strict: true,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  },
}));

export type RepairToolFailureKind = 'invalid' | 'policy' | 'sandbox' | 'budget';

export interface RepairTestEvidence {
  commandId: string;
  imageId: ImageId;
  exitCode: number;
  output: string;
  metrics?: RunResult['metrics'];
}

export interface RepairToolState {
  editableImageId: ImageId;
  cumulativeDiff: string;
  latestTest?: RepairTestEvidence;
  lastNodeId?: string;
}

export interface RepairToolResult {
  ok: boolean;
  kind?: RepairToolFailureKind;
  message: string;
  submitted?: boolean;
  candidate?: Candidate;
  imageId?: ImageId;
  nodeId?: string;
  exitCode?: number;
}

export interface RepairToolRuntimeOptions {
  executor: Executor;
  initialImageId: ImageId;
  diagnosis: Diagnosis;
  policy: RepositoryPolicy;
  budget: RepairBudget;
  trustedCommands: Readonly<Record<string, string>>;
  sourceContext: RepairSourceContext;
  operationIdPrefix?: string;
  onOperationStart?: (operationId: string) => void;
  observe?: (input: { result?: RunResult; imageId?: ImageId; parentImageId: ImageId; note: string }) => string;
}

function exactObject(value: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => allowed.includes(key)) ? record : null;
}

function safePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 240 || !SAFE_PATH.test(value)) return null;
  if (value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return value;
}

function bounded(value: string): string {
  const text = boundedTail(value, { maxLines: MAX_READ_LINES, maxCharacters: MAX_TOOL_OUTPUT_BYTES, maxBytes: MAX_TOOL_OUTPUT_BYTES });
  return redactExternalText(text).text;
}

function failure(kind: RepairToolFailureKind, message: string): RepairToolResult {
  return { ok: false, kind, message: bounded(message) };
}

export class RepairToolRuntime {
  private current: RepairToolState;
  private operationIndex = 0;

  constructor(private readonly options: RepairToolRuntimeOptions) {
    this.current = { editableImageId: options.initialImageId, cumulativeDiff: '' };
  }

  state(): Readonly<RepairToolState> { return { ...this.current }; }

  private async run(command: string, parent = this.current.editableImageId): Promise<RunResult> {
    this.options.budget.reserveSandboxOperation();
    const timeoutSec = Math.min(
      30,
      Math.max(0.001, this.options.budget.remainingElapsedTimeSec()),
    );
    this.operationIndex += 1;
    const operationId = this.options.operationIdPrefix === undefined
      ? undefined
      : `${this.options.operationIdPrefix}-op-${String(this.operationIndex).padStart(3, '0')}`;
    if (operationId !== undefined) this.options.onOperationStart?.(operationId);
    return this.options.executor.run(parent, command, {
      cwd: '/workspace', timeoutSec,
      ...(operationId === undefined ? {} : { operationId }),
    });
  }

  private observe(result: RunResult | undefined, parentImageId: ImageId, note: string, imageId?: ImageId): string | undefined {
    return this.options.observe?.({
      ...(result === undefined ? {} : { result }),
      ...(imageId === undefined ? {} : { imageId }),
      parentImageId,
      note,
    });
  }

  async execute(name: string, rawArguments: unknown): Promise<RepairToolResult> {
    try {
      switch (name) {
        case 'read_file': return await this.readFile(rawArguments);
        case 'search_repo': return await this.searchRepo(rawArguments);
        case 'run_test': return await this.runTest(rawArguments);
        case 'apply_patch': return await this.applyPatch(rawArguments);
        case 'inspect_diff': return await this.inspectDiff(rawArguments);
        case 'submit_candidate': return this.submitCandidate(rawArguments);
        default: return failure('invalid', `Unknown repair tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure(
        error instanceof BudgetExceededError
          ? 'budget'
          : error instanceof RangeError || error instanceof SyntaxError
            ? 'invalid'
            : 'sandbox',
        message,
      );
    }
  }

  private async readFile(value: unknown): Promise<RepairToolResult> {
    const args = exactObject(value, ['path', 'startLine', 'endLine']);
    const path = safePath(args?.path);
    if (!args || !path) return failure('invalid', 'read_file requires one valid repository-relative path');
    if (isSensitiveRepositoryPath(path) || !policyAllowsSourceRead(path, this.options.policy)) {
      return failure('policy', 'Repository policy denies this source read');
    }
    const start = args.startLine === undefined ? 1 : Number(args.startLine);
    const end = args.endLine === undefined ? start + MAX_READ_LINES - 1 : Number(args.endLine);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start >= MAX_READ_LINES) {
      return failure('invalid', `read_file line window must contain at most ${MAX_READ_LINES} lines`);
    }
    const prefixes = path.split('/').map((_, index, segments) =>
      segments.slice(0, index + 1).join('/'),
    );
    const noSymlinks = prefixes.map((prefix) => `test ! -L ${shellQuote(prefix)}`).join(' && ');
    const command = `path=${shellQuote(path)}; ${noSymlinks} && test -f "$path" && test "$(wc -c < "$path")" -le ${MAX_READ_BYTES} && { LC_ALL=C grep -Iq . "$path" || test ! -s "$path"; } && sed -n '${start},${end}p' "$path"`;
    const result = await this.run(command);
    this.observe(result, this.current.editableImageId, `read_file ${path}`);
    if (result.truncated || Buffer.byteLength(result.stdout, 'utf8') > MAX_READ_BYTES) {
      return failure('sandbox', 'File output exceeded the bounded tool limit');
    }
    return result.exitCode === 0
      ? { ok: true, message: bounded(result.stdout), imageId: result.imageId, exitCode: result.exitCode }
      : failure('sandbox', 'File is missing, binary, oversized, or symlinked');
  }

  private async searchRepo(value: unknown): Promise<RepairToolResult> {
    const args = exactObject(value, ['query', 'paths']);
    if (!args || typeof args.query !== 'string' || !args.query || args.query.length > 256 || /[\r\n\0]/u.test(args.query)) {
      return failure('invalid', 'search_repo requires a bounded literal query');
    }
    const pathsValue = args.paths ?? ['.'];
    if (!Array.isArray(pathsValue) || pathsValue.length === 0 || pathsValue.length > 8) return failure('invalid', 'search_repo paths are invalid');
    const paths = pathsValue.map((path) => path === '.' ? '.' : safePath(path));
    if (paths.some((path) => path === null)) return failure('invalid', 'search_repo paths must be repository-relative');
    if ((paths as string[]).some((path) => isSensitiveRepositoryPath(path) || !policyAllowsSourceRead(path, this.options.policy))) {
      return failure('policy', 'Repository policy denies one search path');
    }
    const excluded = [...SENSITIVE_SEARCH_GLOBS, ...this.options.policy.deniedReadPaths]
      .map((glob) => shellQuote(`:(exclude,glob)${glob}`));
    const pathspecs = [...(paths as string[]).map(shellQuote), ...excluded].join(' ');
    const command = `results="$(mktemp /tmp/sutura-search.XXXXXX)"; git grep -F -n --max-count=40 -e ${shellQuote(args.query)} -- ${pathspecs} >"$results"; status=$?; head -c ${MAX_TOOL_OUTPUT_BYTES} "$results"; rm -f "$results"; test "$status" -le 1`;
    const result = await this.run(command);
    this.observe(result, this.current.editableImageId, 'search_repo literal query');
    if (result.truncated || Buffer.byteLength(result.stdout, 'utf8') > MAX_TOOL_OUTPUT_BYTES) {
      return failure('sandbox', 'Search output exceeded the bounded tool limit');
    }
    const filtered = result.stdout.split(/\r?\n/u).filter((line) => {
      const separator = line.indexOf(':');
      if (separator < 1) return false;
      const resultPath = line.slice(0, separator);
      return safePath(resultPath) !== null &&
        !isSensitiveRepositoryPath(resultPath) &&
        policyAllowsSourceRead(resultPath, this.options.policy);
    }).join('\n');
    return result.exitCode <= 1
      ? { ok: true, message: bounded(filtered || 'No matches'), imageId: result.imageId, exitCode: result.exitCode }
      : failure('sandbox', `Repository search failed with exit ${result.exitCode}`);
  }

  private async runTest(value: unknown): Promise<RepairToolResult> {
    const args = exactObject(value, ['commandId']);
    if (!args || typeof args.commandId !== 'string') return failure('invalid', 'run_test requires commandId');
    const command = this.options.trustedCommands[args.commandId];
    if (command === undefined) return failure('policy', 'run_test commandId is not trusted');
    const result = await this.run(command);
    const output = bounded([result.stdout, result.stderr].filter(Boolean).join('\n'));
    if (
      result.truncated ||
      Buffer.byteLength([result.stdout, result.stderr].filter(Boolean).join('\n'), 'utf8') > MAX_TOOL_OUTPUT_BYTES
    ) {
      return failure('sandbox', 'Test output exceeded the bounded tool limit');
    }
    this.current.latestTest = { commandId: args.commandId, imageId: result.imageId, exitCode: result.exitCode, output, metrics: result.metrics };
    this.observe(result, this.current.editableImageId, `run_test ${args.commandId}`);
    return { ok: true, message: output || `Test exited ${result.exitCode}`, imageId: result.imageId, exitCode: result.exitCode };
  }

  private async applyPatch(value: unknown): Promise<RepairToolResult> {
    const args = exactObject(value, ['diff', 'edits']);
    if (!args || (typeof args.diff !== 'string' && args.edits === undefined) || (args.diff !== undefined && args.edits !== undefined)) {
      return failure('invalid', 'apply_patch requires exactly one of diff or edits');
    }
    let diff: string;
    try {
      diff = typeof args.diff === 'string' ? args.diff : structuredEditsDiff(args.edits, this.options.sourceContext);
    } catch (error) {
      return failure('invalid', error instanceof Error ? error.message : String(error));
    }
    const proposed = validateCandidateDiff(diff, this.options.diagnosis, this.options.policy, this.options.budget.limits.diffBytes);
    if (!proposed.ok) return failure('policy', proposed.violations.join('; '));
    const encoded = Buffer.from(diff, 'utf8').toString('base64');
    const command = `printf '%s' ${shellQuote(encoded)} | base64 --decode | git apply - && git diff --no-ext-diff --no-renames --binary HEAD --`;
    const parent = this.current.editableImageId;
    const result = await this.run(command, parent);
    if (result.exitCode !== 0) return failure('sandbox', bounded(result.stderr || 'Patch did not apply'));
    if (result.truncated) return failure('sandbox', 'Cumulative diff output was truncated');
    const cumulative = result.stdout;
    const validation = validateCandidateDiff(cumulative, this.options.diagnosis, this.options.policy, this.options.budget.limits.diffBytes);
    if (!validation.ok) return failure('policy', validation.violations.join('; '));
    this.options.budget.assertDiffBytes(validation.diffBytes);
    const nodeId = this.observe(result, parent, 'apply_patch accepted');
    this.current = {
      editableImageId: result.imageId,
      cumulativeDiff: cumulative,
      ...(nodeId === undefined ? {} : { lastNodeId: nodeId }),
    };
    return {
      ok: true,
      message: bounded(`Patch accepted. ${validation.changedFiles.length} files, ${validation.diffBytes} bytes.`),
      imageId: result.imageId,
      ...(nodeId === undefined ? {} : { nodeId }),
      exitCode: 0,
    };
  }

  private async inspectDiff(value: unknown): Promise<RepairToolResult> {
    if (!exactObject(value, [])) return failure('invalid', 'inspect_diff accepts no arguments');
    const result = await this.run('git diff --no-ext-diff --no-renames --binary HEAD --');
    if (result.truncated || Buffer.byteLength(result.stdout, 'utf8') > MAX_TOOL_OUTPUT_BYTES) {
      return failure('sandbox', 'Diff inspection output exceeded the bounded tool limit');
    }
    const validation = validateCandidateDiff(result.stdout, this.options.diagnosis, this.options.policy, this.options.budget.limits.diffBytes);
    this.observe(result, this.current.editableImageId, 'inspect_diff');
    return {
      ok: result.exitCode === 0,
      ...(result.exitCode === 0 ? {} : { kind: 'sandbox' as const }),
      message: bounded(JSON.stringify({ diff: result.stdout, changedFiles: validation.changedFiles, bytes: validation.diffBytes, findings: validation.violations })),
      imageId: result.imageId,
      exitCode: result.exitCode,
    };
  }

  private submitCandidate(value: unknown): RepairToolResult {
    const args = exactObject(value, ['id', 'rationale']);
    if (!args || typeof args.id !== 'string' || !args.id.trim() || typeof args.rationale !== 'string' || !args.rationale.trim()) {
      return failure('invalid', 'submit_candidate requires non-empty id and rationale');
    }
    if (!this.current.cumulativeDiff) return failure('invalid', 'A non-empty cumulative diff is required');
    if (!this.current.latestTest || this.current.latestTest.exitCode !== 0) return failure('invalid', 'The latest trusted test must pass before submission');
    const candidate = { id: args.id.slice(0, 80), rationale: args.rationale.slice(0, 240), diff: this.current.cumulativeDiff };
    return {
      ok: true,
      submitted: true,
      candidate,
      imageId: this.current.editableImageId,
      ...(this.current.lastNodeId === undefined ? {} : { nodeId: this.current.lastNodeId }),
      exitCode: 0,
      message: 'Candidate submitted for independent audit',
    };
  }
}
