import { open } from 'node:fs/promises';

import {
  parseReplayBundle,
  replayBundle,
  type CaseFile,
} from '@sutura/core';

import type { ReplayArguments } from './args.js';

export const MAX_REPLAY_BUNDLE_BYTES = 16 * 1_024 * 1_024;

export interface ReplayFileDependencies {
  readFile?: (path: string) => Promise<Buffer>;
  parseReplayBundle?: typeof parseReplayBundle;
  replayBundle?: typeof replayBundle;
}

async function readBoundedReplayFile(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('Replay bundle must be a regular file');
    if (metadata.size > MAX_REPLAY_BUNDLE_BYTES) {
      throw new Error('Replay bundle exceeds 16 MiB');
    }
    const buffer = Buffer.alloc(metadata.size + 1);
    let total = 0;
    while (total < buffer.byteLength) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        buffer.byteLength - total,
        total,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total !== metadata.size) {
      throw new Error('Replay bundle changed during bounded read');
    }
    return buffer.subarray(0, total);
  } finally {
    await handle.close();
  }
}

export async function replayFromFile(
  request: ReplayArguments,
  dependencies: ReplayFileDependencies = {},
): Promise<CaseFile> {
  const readBundle = dependencies.readFile ?? readBoundedReplayFile;
  const bytes = await readBundle(request.bundle);
  if (bytes.byteLength > MAX_REPLAY_BUNDLE_BYTES) {
    throw new Error('Replay bundle exceeds 16 MiB');
  }
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  const bundle = (dependencies.parseReplayBundle ?? parseReplayBundle)(value);
  const result = await (dependencies.replayBundle ?? replayBundle)(
    bundle,
    request.runtime === undefined ? {} : { runtimeId: request.runtime },
  );
  if (result.caseFile.outcome !== bundle.outcome) {
    throw new Error(
      `Replay outcome mismatch: recorded ${String(bundle.outcome)}, `
      + `replayed ${result.caseFile.outcome}`,
    );
  }
  return result.caseFile;
}
