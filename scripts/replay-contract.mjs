import {
  parseCapturedFixturesManifest as parseCoreCapturedFixturesManifest,
  parseReplayBundle as parseCoreReplayBundle,
} from '../packages/core/dist/index.js';

export const MAX_REPLAY_BYTES = 16 * 1_024 * 1_024;

const SHA256 = /^[a-f0-9]{64}$/u;
const REPLAY_BOUNDARIES = new Set([
  'github', 'repository', 'executor', 'nebius', 'tavily', 'contree',
]);

export class ReplayContractError extends Error {
  constructor(path, detail) {
    super(`${path} ${detail}`);
    this.name = 'ReplayContractError';
  }
}

function parsedJson(value, label) {
  if (typeof value === 'string' || value instanceof Uint8Array) {
    const bytes = Buffer.from(value);
    if (bytes.byteLength > MAX_REPLAY_BYTES) {
      throw new ReplayContractError(label, 'exceeds 16 MiB');
    }
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw new ReplayContractError(
        label,
        `is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  let byteLength;
  try {
    byteLength = Buffer.byteLength(JSON.stringify(value));
  } catch (error) {
    throw new ReplayContractError(
      label,
      `is not JSON serializable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (byteLength > MAX_REPLAY_BYTES) throw new ReplayContractError(label, 'exceeds 16 MiB');
  return value;
}

function throughCoreParser(parser, value, label) {
  try {
    return parser(parsedJson(value, label));
  } catch (error) {
    if (error instanceof ReplayContractError) throw error;
    throw new ReplayContractError(
      label,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function parseReplayBundle(value) {
  return throughCoreParser(parseCoreReplayBundle, value, 'bundle');
}

export function parseCapturedFixturesManifest(value) {
  return throughCoreParser(parseCoreCapturedFixturesManifest, value, 'manifest');
}

function isTruncatedCapture(value) {
  return typeof value === 'object' && value !== null &&
    value.truncated === true && Number.isSafeInteger(value.bytes) &&
    typeof value.sha256 === 'string' && SHA256.test(value.sha256);
}

function containsTruncatedCapture(value, seen = new WeakSet()) {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (isTruncatedCapture(value)) return true;
  return Object.values(value).some((item) => containsTruncatedCapture(item, seen));
}

export function completedReplayBoundaries(bundle) {
  return new Set([
    ...(bundle.github.length > 0 ? ['github'] : []),
    ...(bundle.repository.length > 0 ? ['repository'] : []),
    ...(bundle.executor.length > 0 ? ['executor'] : []),
    ...bundle.http.map(({ boundary }) => boundary),
  ]);
}

export function parseCompleteReplayArtifact(value) {
  const bundle = parseReplayBundle(value);
  if (!bundle.completeness.complete) {
    throw new ReplayContractError('bundle.completeness.complete', 'must be true for artifact merge');
  }
  if (
    bundle.completeness.overflowedBoundaries.length > 0 ||
    bundle.completeness.pendingBoundaries.length > 0
  ) {
    throw new ReplayContractError('bundle.completeness', 'must not be pending or overflowed');
  }
  if (containsTruncatedCapture(bundle)) {
    throw new ReplayContractError('bundle', 'contains truncated capture evidence');
  }
  const completed = completedReplayBoundaries(bundle);
  for (const boundary of REPLAY_BOUNDARIES) {
    if (!completed.has(boundary)) {
      throw new ReplayContractError('bundle', `has no completed ${boundary} exchange`);
    }
  }
  return bundle;
}
