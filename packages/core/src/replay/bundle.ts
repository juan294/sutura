import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type { CaseFile } from '../domain.js';
import type { SearchLimits } from '../config.js';
import type { RepairBudgetOverrides } from '../engine/repair-budget.js';
import type { Executor } from '../executor/types.js';
import type { ModelTier } from '../llm/cost.js';
import type { RepositoryPort } from '../orchestrate.js';
import type { RuntimeId } from '../runtime/types.js';
import { redactExternalText } from '../security/external-text.js';

export const REPLAY_BUNDLE_SCHEMA_VERSION = 'sutura-replay-v1' as const;

const MAX_BODY_BYTES = 1 * 1_024 * 1_024;
const MAX_HTTP_EXCHANGES = 512;
const MAX_PORT_CALLS = 256;
const MAX_EXECUTOR_CALLS = 512;
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
]);

export interface TruncatedBody {
  truncated: true;
  bytes: number;
  sha256: string;
}

export interface BinaryBody {
  binary: true;
  bytes: number;
  sha256: string;
}

export interface StreamBody {
  stream: true;
  bytes: number;
  sha256: string;
}

export type RecordedBody = string | null | TruncatedBody | BinaryBody | StreamBody;

export interface RecordedHttpExchange {
  boundary: 'nebius' | 'tavily' | 'contree';
  sequence: number;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: RecordedBody;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    body: RecordedBody;
  } | { transportError: string };
  latencyMs: number;
}

export interface RecordedGitHubCall {
  sequence: number;
  method: string;
  args: unknown[];
  result: unknown | { error: string };
}

export interface RecordedRepositoryCall {
  sequence: number;
  method: keyof RepositoryPort;
  args: unknown[];
  result: unknown | { error: string };
}

export interface RecordedExecutorCall {
  sequence: number;
  method: keyof Executor;
  args: unknown[];
  result: unknown | { error: string };
}

export interface ReplayOrchestrationConfig {
  triageN: number;
  raceK: number;
  repairBudgets?: RepairBudgetOverrides;
  search?: SearchLimits;
  runtimeId?: RuntimeId;
  imageRef?: string;
  models: Readonly<Record<ModelTier, string>>;
  routingProfileId: string;
  maxOps: number;
}

export interface ReplayBundle {
  schemaVersion: typeof REPLAY_BUNDLE_SCHEMA_VERSION;
  runId: string;
  repo: string;
  actionSha: string;
  capturedAt: string;
  github: RecordedGitHubCall[];
  repository: RecordedRepositoryCall[];
  executor: RecordedExecutorCall[];
  http: RecordedHttpExchange[];
  configuration: ReplayOrchestrationConfig;
  completeness: {
    complete: boolean;
    overflowedBoundaries: string[];
  };
  outcome?: CaseFile['outcome'];
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function boundedText(value: string): string | TruncatedBody {
  const bytes = Buffer.byteLength(value, 'utf8');
  return bytes <= MAX_BODY_BYTES
    ? value
    : { truncated: true, bytes, sha256: sha256(value) };
}

export function binaryBody(
  value: Uint8Array,
  kind: 'binary' | 'stream' = 'binary',
): BinaryBody | StreamBody {
  const metadata = { bytes: value.byteLength, sha256: sha256(value) };
  return kind === 'stream'
    ? { stream: true, ...metadata }
    : { binary: true, ...metadata };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactString(value: string, secrets: readonly string[]): string | TruncatedBody {
  const bounded = boundedText(value);
  if (typeof bounded !== 'string') return bounded;
  let redacted = redactExternalText(bounded).text;
  for (const secret of secrets) {
    if (secret) redacted = redacted.replaceAll(secret, '[redacted secret]');
  }
  return redacted;
}

function redactScalar(value: string, secrets: readonly string[]): string {
  const redacted = redactString(value, secrets);
  return typeof redacted === 'string' ? redacted : '[truncated]';
}

function redactHeaders(
  headers: Readonly<Record<string, string>>,
  secrets: readonly string[],
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (SENSITIVE_HEADERS.has(name)) continue;
    safe[name] = redactScalar(String(rawValue), secrets);
  }
  return safe;
}

function safeJsonValue(
  value: unknown,
  secrets: readonly string[],
  checkoutPaths: ReadonlyMap<string, string> = new Map(),
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (typeof value === 'string') {
    let normalized = value;
    for (const [checkoutDir, recordedPath] of checkoutPaths) {
      if (normalized === checkoutDir) {
        normalized = recordedPath;
        break;
      }
      if (normalized.startsWith(`${checkoutDir}/`)) {
        normalized = `${recordedPath}${normalized.slice(checkoutDir.length)}`;
        break;
      }
    }
    return redactString(normalized, secrets);
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return String(value);
  }
  if (value === undefined) return null;
  if (depth >= 32) return '[maximum replay depth]';
  if (value instanceof Error) return { error: redactString(value.message, secrets) };
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.slice(0, 10_000).map((item) =>
        safeJsonValue(item, secrets, checkoutPaths, seen, depth + 1),
      );
    }
    const entries = Object.entries(value).slice(0, 10_000).map(([key, item]) => [
      key,
      safeJsonValue(item, secrets, checkoutPaths, seen, depth + 1),
    ]);
    return Object.fromEntries(entries);
  } catch (error) {
    return { error: redactString(errorMessage(error), secrets) };
  } finally {
    seen.delete(value);
  }
}

function redactBody(body: RecordedBody, secrets: readonly string[]): RecordedBody {
  return typeof body === 'string' ? redactString(body, secrets) : body;
}

function containsTruncation(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if ('truncated' in value && value.truncated === true) return true;
  try {
    return Object.values(value).some((item) => containsTruncation(item, seen));
  } catch {
    return true;
  }
}

export function redactBundle(
  bundle: ReplayBundle,
  secrets: readonly string[] = [],
): ReplayBundle {
  return safeJsonValue(bundle, secrets) as ReplayBundle;
}

export class ReplayRecorder {
  private readonly http: RecordedHttpExchange[] = [];
  private readonly github: RecordedGitHubCall[] = [];
  private readonly repository: RecordedRepositoryCall[] = [];
  private readonly executor: RecordedExecutorCall[] = [];
  private readonly configuration: ReplayOrchestrationConfig;
  private readonly checkoutPaths = new Map<string, string>();
  private readonly overflowedBoundaries = new Set<string>();
  private readonly pending = {
    http: new Set<number>(),
    ports: new Set<number>(),
    executor: new Set<number>(),
  };
  private readonly pendingPortBoundaries = new Map<number, 'github' | 'repository'>();
  private httpSequence = 0;
  private portSequence = 0;
  private executorSequence = 0;

  constructor(
    readonly runId: string,
    readonly repo: string,
    readonly actionSha: string,
    configuration: ReplayOrchestrationConfig,
    private readonly secrets: readonly string[] = [],
  ) {
    this.configuration = safeJsonValue(
      configuration,
      this.secrets,
    ) as ReplayOrchestrationConfig;
  }

  reserveHttpSequence(): number | null {
    return this.reserveSequence('http', MAX_HTTP_EXCHANGES);
  }

  reservePortSequence(boundary: 'github' | 'repository' = 'github'): number | null {
    const sequence = this.reserveSequence('ports', MAX_PORT_CALLS, boundary);
    if (sequence !== null) this.pendingPortBoundaries.set(sequence, boundary);
    return sequence;
  }

  reserveExecutorSequence(): number | null {
    return this.reserveSequence('executor', MAX_EXECUTOR_CALLS);
  }

  private reserveSequence(
    boundary: 'http' | 'ports' | 'executor',
    maximum: number,
    overflowBoundary: 'http' | 'github' | 'repository' | 'executor' = boundary === 'ports'
      ? 'github'
      : boundary,
  ): number | null {
    const sequence = boundary === 'http'
      ? ++this.httpSequence
      : boundary === 'ports'
        ? ++this.portSequence
        : ++this.executorSequence;
    if (sequence > maximum) {
      this.markOverflow(overflowBoundary);
      return null;
    }
    this.pending[boundary].add(sequence);
    return sequence;
  }

  markOverflow(boundary: 'http' | 'github' | 'repository' | 'executor'): void {
    this.overflowedBoundaries.add(boundary);
  }

  registerCheckoutPath(checkoutDir: string): string {
    const existing = this.checkoutPaths.get(checkoutDir);
    if (existing) return existing;
    const recordedPath = `checkout-${this.checkoutPaths.size + 1}`;
    this.checkoutPaths.set(checkoutDir, recordedPath);
    return recordedPath;
  }

  private safeValue(value: unknown): unknown {
    return safeJsonValue(value, this.secrets, this.checkoutPaths);
  }

  recordHttp(
    exchange: Omit<RecordedHttpExchange, 'sequence'>,
    reservedSequence?: number | null,
  ): void {
    const sequence = reservedSequence === undefined
      ? this.reserveHttpSequence()
      : reservedSequence;
    if (sequence === null) return;
    try {
      const response = 'transportError' in exchange.response
        ? { transportError: redactScalar(exchange.response.transportError, this.secrets) }
        : {
            status: exchange.response.status,
            headers: redactHeaders(exchange.response.headers, this.secrets),
            body: redactBody(exchange.response.body, this.secrets),
          };
      const recorded = {
        boundary: exchange.boundary,
        sequence,
        request: {
          method: exchange.request.method,
          url: redactScalar(exchange.request.url, this.secrets),
          headers: redactHeaders(exchange.request.headers, this.secrets),
          body: redactBody(exchange.request.body, this.secrets),
        },
        response: response as RecordedHttpExchange['response'],
        latencyMs: Number.isFinite(exchange.latencyMs)
          ? Math.max(0, exchange.latencyMs)
          : 0,
      } satisfies RecordedHttpExchange;
      this.http.push(recorded);
      if (containsTruncation(recorded)) this.markOverflow('http');
    } catch {
      this.markOverflow('http');
    } finally {
      this.pending.http.delete(sequence);
    }
  }

  recordGitHub(
    call: Omit<RecordedGitHubCall, 'sequence'>,
    reservedSequence?: number | null,
  ): void {
    this.recordPort('github', call, reservedSequence);
  }

  recordRepository(
    call: Omit<RecordedRepositoryCall, 'sequence'>,
    reservedSequence?: number | null,
  ): void {
    this.recordPort('repository', call, reservedSequence);
  }

  recordExecutor(
    call: Omit<RecordedExecutorCall, 'sequence'>,
    reservedSequence?: number | null,
  ): void {
    const sequence = reservedSequence === undefined
      ? this.reserveExecutorSequence()
      : reservedSequence;
    if (sequence === null) return;
    try {
      const recorded = {
        sequence,
        method: call.method,
        args: this.safeValue(call.args) as unknown[],
        result: this.safeValue(call.result),
      };
      this.executor.push(recorded);
      if (containsTruncation(recorded)) this.markOverflow('executor');
    } catch {
      this.markOverflow('executor');
    } finally {
      this.pending.executor.delete(sequence);
    }
  }

  private recordPort(
    boundary: 'github',
    call: Omit<RecordedGitHubCall, 'sequence'>,
    reservedSequence?: number | null,
  ): void;
  private recordPort(
    boundary: 'repository',
    call: Omit<RecordedRepositoryCall, 'sequence'>,
    reservedSequence?: number | null,
  ): void;
  private recordPort(
    boundary: 'github' | 'repository',
    call: Omit<RecordedGitHubCall | RecordedRepositoryCall, 'sequence'>,
    reservedSequence?: number | null,
  ): void {
    const sequence = reservedSequence === undefined
      ? this.reservePortSequence(boundary)
      : reservedSequence;
    if (sequence === null) return;
    try {
      const recorded = {
        sequence,
        method: call.method,
        args: this.safeValue(call.args) as unknown[],
        result: this.safeValue(call.result),
      };
      if (boundary === 'github') {
        this.github.push(recorded as RecordedGitHubCall);
      } else {
        this.repository.push(recorded as RecordedRepositoryCall);
      }
      if (containsTruncation(recorded)) this.markOverflow(boundary);
    } catch {
      this.markOverflow(boundary);
    } finally {
      this.pending.ports.delete(sequence);
      this.pendingPortBoundaries.delete(sequence);
    }
  }

  finish(outcome: CaseFile['outcome']): ReplayBundle {
    const pendingBoundaries = [
      ...(this.pending.http.size === 0 ? [] : ['http']),
      ...new Set(this.pendingPortBoundaries.values()),
      ...(this.pending.executor.size === 0 ? [] : ['executor']),
    ].sort();
    const overflowedBoundaries = [...this.overflowedBoundaries].sort();
    const complete = overflowedBoundaries.length === 0 && pendingBoundaries.length === 0;
    const bundle: ReplayBundle = {
      schemaVersion: REPLAY_BUNDLE_SCHEMA_VERSION,
      runId: this.runId,
      repo: this.repo,
      actionSha: this.actionSha,
      capturedAt: new Date().toISOString(),
      github: this.github.toSorted((left, right) => left.sequence - right.sequence),
      repository: this.repository.toSorted((left, right) => left.sequence - right.sequence),
      executor: this.executor.toSorted((left, right) => left.sequence - right.sequence),
      http: this.http.toSorted((left, right) => left.sequence - right.sequence),
      configuration: this.configuration,
      completeness: {
        complete,
        overflowedBoundaries,
      },
      outcome,
    };
    try {
      return redactBundle(bundle, this.secrets);
    } catch {
      return bundle;
    }
  }
}
