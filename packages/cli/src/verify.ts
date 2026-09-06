import { Buffer } from 'node:buffer';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  ContreeExecutor,
  evaluateVerification,
  sandboxVerificationGates,
  trustedCommandsFromPolicy,
  validateVerifyRequest,
  verificationApproved,
  type Executor,
  type RepositoryPolicy,
  type SharedVerificationOutcome,
  type ValidatedVerifyRequest,
  type VerifyReproduction,
} from '@sutura/core';

import type { VerifyArguments } from './args.js';
import { assertCleanCheckoutAt, readTrustedPolicyAtCommit, snapshotCleanSourceAt } from './verify-source.js';

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
  policy: RepositoryPolicy;
  /** Where the trusted policy came from: the chosen commit, or built-in defaults. */
  policySource: 'repository' | 'default';
  policySha: string;
  /** The trusted command map this policy declares. */
  trustedCommands: Readonly<Record<string, string>>;
}

/**
 * Turns parsed arguments into a validated verification request.
 *
 * The order matters. The checkout is confirmed to sit exactly on the declared
 * source, the trusted policy is read from the operator's chosen commit rather
 * than from the working tree or the patch, and only then is the candidate
 * validated against it. All of that happens before anything executes, so an
 * untrusted command, an unparseable patch or a protected path is refused
 * without a sandbox ever starting.
 */
export async function prepareVerify(
  request: VerifyArguments,
  overrides: { skipCheckout?: boolean; trustedCommands?: Readonly<Record<string, string>> } = {},
): Promise<VerifyPreparation> {
  if (overrides.skipCheckout !== true) {
    await assertCleanCheckoutAt(request.caseDir, request.sourceSha);
  }
  const loaded = await readTrustedPolicyAtCommit(request.caseDir, request.policyBaseSha);
  const trustedCommands = overrides.trustedCommands ?? trustedCommandsFromPolicy(loaded.policy);
  const candidateDiff = await readCandidateDiffFile(request.candidateDiff);
  const validated = validateVerifyRequest({
    caseDir: request.caseDir,
    sourceSha: request.sourceSha,
    policyBaseSha: request.policyBaseSha,
    candidateDiff,
    failureCommandId: request.failingCommand,
    ...(request.runtime === undefined ? {} : { runtimeId: request.runtime }),
  }, loaded.policy, trustedCommands);
  return {
    request: validated,
    policy: loaded.policy,
    policySource: loaded.source,
    policySha: loaded.sha,
    trustedCommands,
  };
}

export interface VerifyExecutionResult {
  status: 'verified-supplied-patch' | 'refused' | 'insufficient' | 'infra-stop';
  request: ValidatedVerifyRequest;
  policySource: 'repository' | 'default';
  policySha: string;
  /** The immutable copy that executed, bound by hash. */
  source: { sourceSha: string; snapshotSha256: string; files: number };
  reproduction: VerifyReproduction['status'];
  observations: SharedVerificationOutcome['observations'];
  blockingGate: SharedVerificationOutcome['blockingGate'];
  challengeAssurance: boolean;
  /** Always false: verification never authors or applies a replacement. */
  generatedReplacement: false;
}

export interface VerifyRuntime {
  executor: Executor;
  /** Gates this route does not execute itself, such as the audit stack. */
  delegated?: Parameters<typeof sandboxVerificationGates>[2];
  challengeMode?: 'required' | 'optional' | 'disabled';
}

/**
 * Runs a supplied patch through preparation, reproduction and the shared gate
 * stack, against an immutable copy of the declared source.
 *
 * The copy is what executes, so nothing that happens to the developer's
 * checkout afterwards changes what this run verified. Nothing is generated and
 * nothing is written back: the result is evidence about the supplied bytes.
 */
export async function executeVerify(
  request: VerifyArguments,
  runtime: VerifyRuntime,
): Promise<VerifyExecutionResult> {
  const prepared = await prepareVerify(request);
  const snapshot = await snapshotCleanSourceAt(request.caseDir, request.sourceSha);
  try {
    const gates = await sandboxVerificationGates(
      prepared.request,
      { executor: runtime.executor, sourceDir: snapshot.dir },
      runtime.delegated ?? {},
    );
    const outcome = await evaluateVerification({
      challengeMode: runtime.challengeMode ?? 'required',
      runGate: gates.runGate,
    });
    const status: VerifyExecutionResult['status'] = verificationApproved(outcome)
      ? 'verified-supplied-patch'
      : outcome.status === 'infra-stop'
        ? 'infra-stop'
        : outcome.status === 'insufficient' ? 'insufficient' : 'refused';
    return {
      status,
      request: prepared.request,
      policySource: prepared.policySource,
      policySha: prepared.policySha,
      source: {
        sourceSha: snapshot.sourceSha,
        snapshotSha256: snapshot.snapshotSha256,
        files: snapshot.files.length,
      },
      reproduction: gates.reproduction.status,
      observations: outcome.observations,
      blockingGate: outcome.blockingGate,
      challengeAssurance: outcome.challengeAssurance,
      generatedReplacement: false,
    };
  } finally {
    await snapshot.cleanup();
  }
}

/** Builds the sandbox client from the environment, as `sutura heal` does. */
export function verifyRuntimeFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): VerifyRuntime {
  const token = environment.CONTREE_TOKEN;
  const project = environment.CONTREE_PROJECT;
  if (!token) throw new VerifyInputError('CONTREE_TOKEN is required to execute a verification');
  if (!project) throw new VerifyInputError('CONTREE_PROJECT is required to execute a verification');
  return { executor: new ContreeExecutor({ token, project }) };
}
