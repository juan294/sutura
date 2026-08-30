import {
  parseCapturedFixturesManifest as parseCoreCapturedFixturesManifest,
  parseReplayBundle as parseCoreReplayBundle,
} from '../packages/core/dist/index.js';

export const MAX_REPLAY_BYTES = 16 * 1_024 * 1_024;

export class ReplayContractError extends Error {
  constructor(path, detail) {
    super(`${path} ${detail}`);
    this.name = 'ReplayContractError';
  }
}

function parsedJson(value, label) {
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > MAX_REPLAY_BYTES) {
      throw new ReplayContractError(label, 'exceeds 16 MiB');
    }
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new ReplayContractError(
        label,
        `is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (value instanceof Uint8Array) {
    if (value.byteLength > MAX_REPLAY_BYTES) {
      throw new ReplayContractError(label, 'exceeds 16 MiB');
    }
    try {
      const text = Buffer.isBuffer(value)
        ? value.toString('utf8')
        : new TextDecoder().decode(value);
      return JSON.parse(text);
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
  return bundle;
}
