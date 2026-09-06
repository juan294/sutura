import { Buffer } from 'node:buffer';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  createDefaultRepositoryPolicy,
  validateVerifyRequest,
  type ValidatedVerifyRequest,
} from '@sutura/core';

import type { VerifyArguments } from './args.js';

/** A supplied patch is bounded well below the policy diff limit before reading. */
export const MAX_CANDIDATE_DIFF_FILE_BYTES = 1024 * 1024;

export class VerifyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerifyInputError';
  }
}

/**
 * Reads the candidate patch once, from a regular file, without following a
 * symbolic link or racing a replacement.
 *
 * The handle is opened first and every check is made against that same handle,
 * so the bytes verified are the bytes measured. A directory, device, symlink or
 * oversized file is refused before any content is read into memory.
 */
export async function readCandidateDiffFile(path: string): Promise<string> {
  const resolved = resolve(path);
  let handle;
  try {
    handle = await open(resolved, 'r');
  } catch {
    throw new VerifyInputError(`Candidate diff file could not be opened: ${path}`);
  }
  try {
    const stats = await handle.stat();
    if (stats.isSymbolicLink()) {
      throw new VerifyInputError(`Candidate diff file must not be a symbolic link: ${path}`);
    }
    if (!stats.isFile()) {
      throw new VerifyInputError(`Candidate diff must be a regular file: ${path}`);
    }
    if (stats.size > MAX_CANDIDATE_DIFF_FILE_BYTES) {
      throw new VerifyInputError(
        `Candidate diff is ${stats.size} bytes; at most ${MAX_CANDIDATE_DIFF_FILE_BYTES} are read`,
      );
    }
    const buffer = Buffer.alloc(stats.size);
    const { bytesRead } = await handle.read(buffer, 0, stats.size, 0);
    if (bytesRead !== stats.size) {
      throw new VerifyInputError(`Candidate diff changed while it was being read: ${path}`);
    }
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

export interface VerifyPreparation {
  request: ValidatedVerifyRequest;
  /** The trusted command map the operator supplied for this repository. */
  trustedCommands: Readonly<Record<string, string>>;
}

/**
 * Turns parsed arguments into a validated verification request.
 *
 * Reading and validation happen before anything executes, so an untrusted
 * command, an unparseable patch or a protected path is refused without a
 * sandbox ever starting.
 */
export async function prepareVerify(
  request: VerifyArguments,
  trustedCommands: Readonly<Record<string, string>> = { diagnosed: 'pnpm test' },
): Promise<VerifyPreparation> {
  const candidateDiff = await readCandidateDiffFile(request.candidateDiff);
  const validated = validateVerifyRequest({
    caseDir: request.caseDir,
    sourceSha: request.sourceSha,
    policyBaseSha: request.policyBaseSha,
    candidateDiff,
    failureCommandId: request.failingCommand,
    ...(request.runtime === undefined ? {} : { runtimeId: request.runtime }),
  }, createDefaultRepositoryPolicy(), trustedCommands);
  return { request: validated, trustedCommands };
}
