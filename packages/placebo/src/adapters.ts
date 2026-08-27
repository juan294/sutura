import { spawn } from 'node:child_process';

import type { Adapter, AdapterContext, CaseFile } from './types.js';

interface ExecutionResult { stdout: string; stderr: string; exitCode: number; failure?: string }
export interface ExecuteOptions { timeoutMs: number; maxOutputBytes: number }
export type Execute = (command: string, args: string[], options: ExecuteOptions) => Promise<ExecutionResult>;

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const OUTCOMES = new Set(['fixed', 'flaky-no-patch', 'refused', 'gave-up']);
const FAILURE_CLASSES = new Set(['typecheck', 'lint', 'build', 'test-assertion', 'test-bug', 'flaky-timing', 'dep-upstream-breaking', 'env-config', 'infra']);

function failureCaseFile(reason: string): CaseFile {
  return {
    runId: 'placebo-adapter-failure', repo: 'placebo/adapter',
    diagnosis: { class: 'infra', confidence: 1, signals: ['adapter-failure'], failingCmd: 'adapter', errorExcerpt: reason.slice(0, 2_000) },
    triage: { status: 'real', reproduced: 1, of: 1 }, race: [], outcome: 'gave-up',
    cost: { entries: [], totalUsd: () => 0 },
  };
}

function executeProcess(command: string, args: string[], options: ExecuteOptions): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let failure: string | undefined;
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, ...(failure ? { failure } : {}) });
    };
    const collect = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        failure = `adapter output limit exceeded (${options.maxOutputBytes} bytes)`;
        child.kill('SIGKILL');
        return;
      }
      if (target === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
    child.once('error', (error) => {
      failure = `adapter spawn failed: ${error.message}`;
      finish(1);
    });
    child.once('close', (exitCode) => finish(exitCode ?? 1));
    const timer = setTimeout(() => {
      failure = `adapter timed out after ${options.timeoutMs} ms`;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    timer.unref();
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function validDiagnosis(value: unknown): boolean {
  const diagnosis = record(value);
  if (!diagnosis || !FAILURE_CLASSES.has(String(diagnosis.class)) || typeof diagnosis.confidence !== 'number' ||
      !Array.isArray(diagnosis.signals) || !diagnosis.signals.every((signal) => typeof signal === 'string') ||
      typeof diagnosis.failingCmd !== 'string' || typeof diagnosis.errorExcerpt !== 'string') return false;
  if (diagnosis.grounding === undefined) return true;
  const grounding = record(diagnosis.grounding);
  return Boolean(grounding && typeof grounding.query === 'string' && typeof grounding.skipped === 'boolean' &&
    Array.isArray(grounding.citations) && grounding.citations.every((citation) => {
      const item = record(citation);
      return item && typeof item.title === 'string' && typeof item.url === 'string' && typeof item.snippet === 'string';
    }));
}

function validTriage(value: unknown): boolean {
  const triage = record(value);
  if (!triage || !['real', 'flaky', 'intermittent'].includes(String(triage.status)) ||
      !Number.isSafeInteger(triage.reproduced) || !Number.isSafeInteger(triage.of) ||
      Number(triage.of) <= 0 || Number(triage.reproduced) < 0 || Number(triage.reproduced) > Number(triage.of)) return false;
  if (triage.status === 'real') return triage.reproduced === triage.of;
  if (triage.status === 'flaky') return triage.reproduced === 0;
  return Number(triage.reproduced) > 0 && Number(triage.reproduced) < Number(triage.of);
}

function validAudit(value: unknown): boolean {
  const audit = record(value);
  return Boolean(audit && typeof audit.approved === 'boolean' && typeof audit.reasoning === 'string' &&
    Array.isArray(audit.checks) && audit.checks.every((check) => {
      const item = record(check);
      return item && typeof item.name === 'string' && typeof item.passed === 'boolean' &&
        (item.evidence === undefined || typeof item.evidence === 'string');
    }));
}

function validRace(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => {
    const result = record(entry);
    const candidate = record(result?.candidate);
    return result && candidate && typeof candidate.id === 'string' && typeof candidate.rationale === 'string' &&
      typeof candidate.diff === 'string' && typeof result.imageId === 'string' &&
      typeof result.exitCode === 'number' && typeof result.held === 'boolean';
  });
}

function validCost(value: unknown): boolean {
  const cost = record(value);
  return Boolean(cost && Array.isArray(cost.entries) && cost.entries.every((entry) => {
    const item = record(entry);
    return item && typeof item.model === 'string' &&
      ['inTok', 'outTok', 'reasoningTok', 'usd'].every((key) => typeof item[key] === 'number' && Number.isFinite(item[key]));
  }));
}

function parseCaseFile(result: ExecutionResult): CaseFile {
  if (result.failure) return failureCaseFile(result.failure);
  if (result.exitCode !== 0) return failureCaseFile(result.stderr.trim() || `adapter exited ${result.exitCode}`);
  try {
    const value = record(JSON.parse(result.stdout));
    const audit = value?.audit;
    const cost = record(value?.cost);
    if (!value || typeof value.runId !== 'string' || typeof value.repo !== 'string' ||
        !validDiagnosis(value.diagnosis) || !validTriage(value.triage) || !validRace(value.race) ||
        !OUTCOMES.has(String(value.outcome)) || !validCost(value.cost) ||
        (audit !== undefined && !validAudit(audit))) {
      throw new Error('does not match Sutura CaseFile');
    }
    if (!cost) throw new Error('does not match Sutura CaseFile cost');
    const entries = cost.entries as CaseFile['cost']['entries'];
    return {
      ...(value as unknown as CaseFile),
      cost: { entries, totalUsd: () => entries.reduce((total, entry) => total + entry.usd, 0) },
    };
  } catch (error) {
    return failureCaseFile(`invalid adapter JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface CliAdapterOptions {
  command: string;
  args?: string[];
  tavilyEnabled?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
  execute?: Execute;
}

export class CliAdapter implements Adapter {
  readonly name: string;
  protected readonly command: string;
  protected readonly args: string[];
  protected readonly tavilyEnabled: boolean;
  protected readonly timeoutMs: number;
  protected readonly maxOutputBytes: number;
  protected readonly execute: Execute;

  constructor(options: CliAdapterOptions) {
    this.command = options.command;
    this.args = options.args ?? [];
    this.tavilyEnabled = options.tavilyEnabled ?? true;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.execute = options.execute ?? executeProcess;
    this.name = `cli:${this.command}`;
  }

  protected commandArgs(caseDir: string, context?: AdapterContext): string[] {
    return [
      ...this.args, '--case-dir', caseDir,
      ...(context?.candidateDiff ? ['--candidate-diff', context.candidateDiff] : []),
      ...(!this.tavilyEnabled ? ['--no-tavily'] : []),
    ];
  }

  async heal(caseDir: string, context?: AdapterContext): Promise<CaseFile> {
    try {
      const result = await this.execute(this.command, this.commandArgs(caseDir, context), {
        timeoutMs: this.timeoutMs, maxOutputBytes: this.maxOutputBytes,
      });
      return parseCaseFile(result);
    } catch (error) {
      return failureCaseFile(`adapter execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  withTavily(enabled: boolean): Adapter {
    return new CliAdapter({
      command: this.command, args: this.args, tavilyEnabled: enabled, timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes, execute: this.execute,
    });
  }
}

export interface SuturaAdapterOptions extends Omit<CliAdapterOptions, 'command' | 'args'> { command?: string }

export class SuturaAdapter extends CliAdapter {
  override readonly name = 'sutura';
  constructor(options: SuturaAdapterOptions = {}) {
    super({ command: options.command ?? 'sutura', args: ['heal', '--format', 'json'], ...options });
  }
  protected override commandArgs(caseDir: string, context?: AdapterContext): string[] {
    return [
      'heal', '--case-dir', caseDir, '--format', 'json',
      ...(context?.candidateDiff ? ['--candidate-diff', context.candidateDiff] : []),
      ...(!this.tavilyEnabled ? ['--no-tavily'] : []),
    ];
  }
  override withTavily(enabled: boolean): Adapter {
    return new SuturaAdapter({ command: this.command, tavilyEnabled: enabled, timeoutMs: this.timeoutMs, maxOutputBytes: this.maxOutputBytes, execute: this.execute });
  }
}

function controlCaseFile(outcome: CaseFile['outcome'], approved: boolean | undefined, tavilyEnabled: boolean): CaseFile {
  return {
    runId: 'placebo-control', repo: 'placebo/control',
    diagnosis: {
      class: 'test-assertion', confidence: 1, signals: ['scripted-control'], failingCmd: 'pnpm test', errorExcerpt: 'scripted',
      ...(tavilyEnabled ? { grounding: { query: 'scripted release', skipped: false, citations: [{ title: 'Release', url: 'https://example.test/release', snippet: 'Scripted control citation' }] } } : {}),
    },
    triage: { status: outcome === 'flaky-no-patch' ? 'intermittent' : 'real', reproduced: outcome === 'flaky-no-patch' ? 2 : 5, of: 5 },
    race: [], ...(approved === undefined ? {} : { audit: { approved, checks: [], reasoning: approved ? 'approved' : 'refused' } }),
    outcome, cost: { entries: [], totalUsd: () => 0 },
  };
}

export class DummyAdapter implements Adapter {
  readonly name = 'dummy';
  constructor(private readonly tavilyEnabled = true) {}
  async heal(): Promise<CaseFile> { return controlCaseFile('fixed', true, this.tavilyEnabled); }
  withTavily(enabled: boolean): Adapter { return new DummyAdapter(enabled); }
}

export class RefuseAllAdapter implements Adapter {
  readonly name = 'refuse-all';
  async heal(): Promise<CaseFile> { return controlCaseFile('refused', false, false); }
  withTavily(): Adapter { return this; }
}
