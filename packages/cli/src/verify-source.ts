import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  createDefaultRepositoryPolicy,
  loadRepositoryPolicy,
  type LoadedRepositoryPolicy,
} from '@sutura/core';

const exec = promisify(execFile);

/** The trusted policy declaration is small; a larger object is refused unread. */
export const MAX_POLICY_OBJECT_BYTES = 65_536;
export const TRUSTED_POLICY_PATH = '.sutura.json';

export class VerifySourceError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'VerifySourceError';
  }
}

async function git(caseDir: string, args: readonly string[]): Promise<string> {
  const result = await exec('git', ['-C', caseDir, ...args], {
    maxBuffer: MAX_POLICY_OBJECT_BYTES * 4,
    timeout: 15_000,
  });
  return result.stdout;
}

/**
 * Confirms the checkout is exactly the commit whose failure is being verified,
 * with nothing else in the working tree.
 *
 * A patch is verified against a specific source state. If the checkout has
 * moved, or carries tracked or untracked product changes, the bytes that would
 * execute are not the bytes the identity names, so the run stops rather than
 * verifying something it cannot describe.
 */
export async function assertCleanCheckoutAt(
  caseDir: string,
  sourceSha: string,
): Promise<void> {
  let head: string;
  try {
    head = (await git(caseDir, ['rev-parse', 'HEAD'])).trim();
  } catch {
    throw new VerifySourceError('not-a-repository', `${caseDir} is not a Git checkout`);
  }
  if (head !== sourceSha) {
    throw new VerifySourceError(
      'source-sha-mismatch',
      `Checkout is at ${head}, not the declared source ${sourceSha}`,
    );
  }
  const status = (await git(caseDir, ['status', '--porcelain', '--untracked-files=all'])).trim();
  if (status) {
    throw new VerifySourceError(
      'dirty-checkout',
      'Checkout has tracked or untracked changes; verification needs the exact failed source',
    );
  }
}

/**
 * Reads the trusted repository policy from the operator's chosen commit.
 *
 * The commit is resolved through a bounded Git object read, never from the
 * working tree and never from the candidate patch, so a patch cannot supply a
 * more permissive policy by including one. An absent declaration means the
 * versioned built-in defaults; an unavailable or ambiguous commit, a
 * non-blob path and an oversized object are refused rather than guessed.
 */
export async function readTrustedPolicyAtCommit(
  caseDir: string,
  policyBaseSha: string,
): Promise<LoadedRepositoryPolicy> {
  let objectType: string;
  try {
    objectType = (await git(caseDir, ['cat-file', '-t', `${policyBaseSha}^{commit}`])).trim();
  } catch {
    throw new VerifySourceError(
      'policy-commit-unavailable',
      `Trusted policy commit ${policyBaseSha} is not available in this checkout`,
    );
  }
  if (objectType !== 'commit') {
    throw new VerifySourceError(
      'policy-commit-unavailable',
      `${policyBaseSha} does not name a commit`,
    );
  }

  let declaration: string | undefined;
  try {
    declaration = await git(caseDir, ['cat-file', '-p', `${policyBaseSha}:${TRUSTED_POLICY_PATH}`]);
  } catch {
    declaration = undefined;
  }
  if (declaration === undefined) {
    return { policy: createDefaultRepositoryPolicy(), sha: 'default', source: 'default' };
  }
  if (Buffer.byteLength(declaration, 'utf8') > MAX_POLICY_OBJECT_BYTES) {
    throw new VerifySourceError(
      'policy-too-large',
      `Trusted policy exceeds ${MAX_POLICY_OBJECT_BYTES} bytes`,
    );
  }
  try {
    return loadRepositoryPolicy(declaration);
  } catch (error) {
    throw new VerifySourceError(
      'policy-invalid',
      `Trusted policy at ${policyBaseSha} is not valid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
