import {
  REPLAY_BUNDLE_SCHEMA_VERSION,
  type RecordedBody,
  type ReplayBoundary,
  type ReplayBundle,
  type ReplayOverflowBoundary,
} from './bundle.js';

const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[1-9]\d*$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const OUTCOMES = new Set(['fixed', 'flaky-no-patch', 'refused', 'gave-up', 'infra-stop']);
const HTTP_BOUNDARIES = new Set(['nebius', 'tavily', 'contree']);
const REPLAY_BOUNDARIES = new Set(['github', 'repository', 'executor', ...HTTP_BOUNDARIES]);
const OVERFLOW_BOUNDARIES = new Set([...REPLAY_BOUNDARIES, 'http', 'configuration']);

export class ReplayValidationError extends Error {
  constructor(path: string, detail: string) {
    super(`${path} ${detail}`);
    this.name = 'ReplayValidationError';
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReplayValidationError(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ReplayValidationError(path, `must be an array with at most ${maximum} entries`);
  }
  return value;
}

function string(value: unknown, path: string, maximum = 2_000_000): string {
  if (typeof value !== 'string' || value.length > maximum) {
    throw new ReplayValidationError(path, 'must be a bounded string');
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ReplayValidationError(path, 'must be a positive integer');
  }
  return value as number;
}

function nonnegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ReplayValidationError(path, 'must be a finite nonnegative number');
  }
  return value;
}

function stringRecord(value: unknown, path: string): Record<string, string> {
  const record = object(value, path);
  for (const [key, item] of Object.entries(record)) string(item, `${path}.${key}`);
  return record as Record<string, string>;
}

function body(value: unknown, path: string): RecordedBody {
  if (value === null || typeof value === 'string') return value;
  const record = object(value, path);
  const bytes = nonnegativeNumber(record.bytes, `${path}.bytes`);
  if (!Number.isSafeInteger(bytes) || !SHA256.test(string(record.sha256, `${path}.sha256`))) {
    throw new ReplayValidationError(path, 'has invalid byte metadata');
  }
  if (record.truncated === true || record.binary === true || record.stream === true) {
    return record as unknown as RecordedBody;
  }
  if (
    record.raw === true && record.encoding === 'base64' &&
    typeof record.data === 'string' && /^[A-Za-z0-9+/]*={0,2}$/u.test(record.data)
  ) return record as unknown as RecordedBody;
  throw new ReplayValidationError(path, 'must be a recorded body');
}

function sequenceRecords(
  value: unknown,
  path: string,
  maximum: number,
  methods?: ReadonlySet<string>,
): Array<Record<string, unknown>> {
  return array(value, path, maximum).map((item, index) => {
    const record = object(item, `${path}[${index}]`);
    positiveInteger(record.sequence, `${path}[${index}].sequence`);
    const method = string(record.method, `${path}[${index}].method`);
    if (methods && !methods.has(method)) {
      throw new ReplayValidationError(`${path}[${index}].method`, 'is unknown');
    }
    array(record.args, `${path}[${index}].args`, 10_000);
    if (!Object.hasOwn(record, 'result')) {
      throw new ReplayValidationError(`${path}[${index}].result`, 'is required');
    }
    return record;
  });
}

export function parseReplayBundle(value: unknown): ReplayBundle {
  const bundle = object(value, 'bundle');
  if (bundle.schemaVersion !== REPLAY_BUNDLE_SCHEMA_VERSION) {
    throw new ReplayValidationError('bundle.schemaVersion', 'is unsupported');
  }
  if (!RUN_ID.test(string(bundle.runId, 'bundle.runId'))) {
    throw new ReplayValidationError('bundle.runId', 'must be a positive decimal id');
  }
  if (!REPOSITORY.test(string(bundle.repo, 'bundle.repo'))) {
    throw new ReplayValidationError('bundle.repo', 'must use owner/repo format');
  }
  if (!SHA.test(string(bundle.actionSha, 'bundle.actionSha'))) {
    throw new ReplayValidationError('bundle.actionSha', 'must be an exact lowercase SHA');
  }
  const capturedAt = string(bundle.capturedAt, 'bundle.capturedAt');
  if (!capturedAt.endsWith('Z') || !Number.isFinite(Date.parse(capturedAt))) {
    throw new ReplayValidationError('bundle.capturedAt', 'must be an ISO UTC timestamp');
  }
  sequenceRecords(bundle.github, 'bundle.github', 256);
  sequenceRecords(bundle.repository, 'bundle.repository', 256);
  sequenceRecords(bundle.executor, 'bundle.executor', 512, new Set([
    'importImage', 'snapshot', 'run', 'runMany', 'operationCapacity', 'cancel',
  ]));
  for (const [index, item] of array(bundle.http, 'bundle.http', 512).entries()) {
    const exchange = object(item, `bundle.http[${index}]`);
    positiveInteger(exchange.sequence, `bundle.http[${index}].sequence`);
    if (!HTTP_BOUNDARIES.has(exchange.boundary as string)) {
      throw new ReplayValidationError(`bundle.http[${index}].boundary`, 'is unknown');
    }
    const request = object(exchange.request, `bundle.http[${index}].request`);
    string(request.method, `bundle.http[${index}].request.method`);
    string(request.url, `bundle.http[${index}].request.url`);
    stringRecord(request.headers, `bundle.http[${index}].request.headers`);
    body(request.body, `bundle.http[${index}].request.body`);
    const response = object(exchange.response, `bundle.http[${index}].response`);
    if (Object.hasOwn(response, 'transportError')) {
      string(response.transportError, `bundle.http[${index}].response.transportError`);
    } else {
      nonnegativeNumber(response.status, `bundle.http[${index}].response.status`);
      stringRecord(response.headers, `bundle.http[${index}].response.headers`);
      body(response.body, `bundle.http[${index}].response.body`);
    }
    nonnegativeNumber(exchange.latencyMs, `bundle.http[${index}].latencyMs`);
  }
  const config = object(bundle.configuration, 'bundle.configuration');
  positiveInteger(config.triageN, 'bundle.configuration.triageN');
  positiveInteger(config.raceK, 'bundle.configuration.raceK');
  positiveInteger(config.maxOps, 'bundle.configuration.maxOps');
  string(config.routingProfileId, 'bundle.configuration.routingProfileId');
  const models = object(config.models, 'bundle.configuration.models');
  for (const tier of ['nano', 'super', 'ultra']) string(models[tier], `bundle.configuration.models.${tier}`);
  const completeness = object(bundle.completeness, 'bundle.completeness');
  if (typeof completeness.complete !== 'boolean') {
    throw new ReplayValidationError('bundle.completeness.complete', 'must be boolean');
  }
  const overflowed = array(
    completeness.overflowedBoundaries, 'bundle.completeness.overflowedBoundaries', 8,
  ) as ReplayOverflowBoundary[];
  const pending = array(
    completeness.pendingBoundaries, 'bundle.completeness.pendingBoundaries', 6,
  ) as ReplayBoundary[];
  if (overflowed.some((item) => !OVERFLOW_BOUNDARIES.has(item))) {
    throw new ReplayValidationError('bundle.completeness.overflowedBoundaries', 'contains an unknown boundary');
  }
  if (pending.some((item) => !REPLAY_BOUNDARIES.has(item))) {
    throw new ReplayValidationError('bundle.completeness.pendingBoundaries', 'contains an unknown boundary');
  }
  if (completeness.complete && (overflowed.length > 0 || pending.length > 0)) {
    throw new ReplayValidationError('bundle.completeness', 'is internally inconsistent');
  }
  if (bundle.outcome !== undefined && !OUTCOMES.has(bundle.outcome as string)) {
    throw new ReplayValidationError('bundle.outcome', 'is unknown');
  }
  if (completeness.complete && bundle.outcome === undefined) {
    throw new ReplayValidationError('bundle.outcome', 'is required for a complete bundle');
  }
  return value as ReplayBundle;
}
