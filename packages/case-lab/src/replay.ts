import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseReplayBundle,
  replayBundle,
  type CaseFile,
  type ReplayBundle,
  type ReplayBundleOptions,
} from '@sutura/core';

import { CASE_LAB_CASES, caseLabCase, type CaseLabCase, type CaseLabCaseId } from './cases.js';
import type { ReleaseIdentity } from './dispatcher.js';
import { loadRecordedEvidence, recordedEvaluation, type RecordedEvidence, RECORDED_RESULT_FILE } from './evidence.js';
import {
  createCaseLabResult,
  type CaseLabCaseFile,
  type CaseLabResult,
} from './result.js';

export const PACKAGE_DIR = resolve(import.meta.dirname, '..');
export const REPOSITORY_ROOT = resolve(PACKAGE_DIR, '../..');
export const REPLAY_DIR = resolve(PACKAGE_DIR, 'replay');
const MAX_BUNDLE_BYTES = 16 * 1_024 * 1_024;
const EVIDENCE_URL = 'https://github.com/juan294/sutura/blob/develop/docs/demo/placebo-v0.2-live-2026-09.json';

export class CaseLabReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseLabReplayError';
  }
}

export function loadRelease(packageDir = PACKAGE_DIR): ReleaseIdentity {
  const value = JSON.parse(readFileSync(resolve(packageDir, 'release.json'), 'utf8')) as unknown;
  if (
    value === null || typeof value !== 'object'
    || typeof (value as { version?: unknown }).version !== 'string'
    || !/^[a-f0-9]{40}$/u.test(String((value as { actionSha?: unknown }).actionSha))
  ) {
    throw new CaseLabReplayError('release.json must contain a version and an exact 40-character actionSha');
  }
  const { version, actionSha } = value as { version: string; actionSha: string };
  return { version, actionSha };
}

/** Strip the ledger method and the trace so the case file is plain JSON data. */
export function plainCaseFile(caseFile: CaseFile | CaseLabCaseFile): CaseLabCaseFile {
  const { cost, ...rest } = caseFile as CaseFile;
  const withoutTrace = { ...rest } as Record<string, unknown>;
  delete withoutTrace.trace;
  return { ...(withoutTrace as Omit<CaseLabCaseFile, 'cost'>), cost: { entries: cost.entries } };
}

export function caseFileCost(caseFile: CaseLabCaseFile): { inferenceUsd: number; sandboxUsd: number } {
  const inferenceUsd = caseFile.cost.entries.reduce((sum, entry) => sum + entry.usd, 0);
  const sandboxUsd = caseFile.stages.reduce((sum, stage) => sum + (stage.metrics.cost ?? 0), 0);
  return { inferenceUsd, sandboxUsd };
}

export interface RecordedResultOptions {
  readonly release: ReleaseIdentity;
  readonly now: () => Date;
}

export function recordedResult(
  item: CaseLabCase,
  evidence: RecordedEvidence,
  options: RecordedResultOptions,
): CaseLabResult {
  const { evaluation, ledgerEntry } = recordedEvaluation(evidence, item.placeboCaseId, item.tavilyEnabled);
  const caseFile = plainCaseFile(evaluation.caseFile);
  const cost = caseFileCost(caseFile);
  return createCaseLabResult({
    schemaVersion: 'sutura-case-lab-result-v1',
    requestId: `recorded-${item.id}`,
    caseId: item.id,
    mode: 'recorded',
    release: options.release,
    identity: { controllerSha: evidence.result.controllerSha },
    outcome: caseFile.outcome,
    expectedOutcome: item.expectedOutcome,
    matchesExpectation: caseFile.outcome === item.expectedOutcome,
    links: { workflowRun: ledgerEntry.runUrl, evidence: EVIDENCE_URL },
    caseFile,
    recordedFrom: {
      file: RECORDED_RESULT_FILE,
      resultHash: evidence.result.resultHash,
      runUrl: ledgerEntry.runUrl,
      subjectSha: evidence.result.subjectSha,
      recordedAt: ledgerEntry.recordedAt,
    },
    cost: { ...cost, status: 'observed' },
    elapsedMs: evaluation.elapsedTimeMs,
    createdAt: options.now().toISOString(),
  });
}

export interface ReplayedResultOptions extends RecordedResultOptions {
  readonly bundleSha256: string;
  readonly replay?: (bundle: ReplayBundle, options?: ReplayBundleOptions) => ReturnType<typeof replayBundle>;
}

export async function replayedResult(
  item: CaseLabCase,
  bundleValue: unknown,
  options: ReplayedResultOptions,
): Promise<CaseLabResult> {
  const bundle = parseReplayBundle(bundleValue);
  if (bundle.actionSha !== options.release.actionSha) {
    throw new CaseLabReplayError(
      `replay bundle actionSha must equal release.json actionSha ${options.release.actionSha}`,
    );
  }
  if (!bundle.completeness.complete) {
    throw new CaseLabReplayError('replay bundle must be complete; partial bundles cannot produce a Case Lab result');
  }
  const replayed = await (options.replay ?? replayBundle)(bundle, { runtimeId: item.runtime });
  const caseFile = plainCaseFile(replayed.caseFile);
  if (bundle.outcome === undefined || caseFile.outcome !== bundle.outcome) {
    throw new CaseLabReplayError(
      `replay outcome mismatch: recorded ${String(bundle.outcome)}, replayed ${caseFile.outcome}`,
    );
  }
  const cost = caseFileCost(caseFile);
  return createCaseLabResult({
    schemaVersion: 'sutura-case-lab-result-v1',
    requestId: `replay-${item.id}`,
    caseId: item.id,
    mode: 'replay',
    release: options.release,
    identity: { controllerSha: bundle.actionSha },
    outcome: caseFile.outcome,
    expectedOutcome: item.expectedOutcome,
    matchesExpectation: caseFile.outcome === item.expectedOutcome,
    links: {
      workflowRun: `https://github.com/${bundle.repo}/actions/runs/${bundle.runId}`,
    },
    caseFile,
    replayedFrom: {
      bundleSha256: options.bundleSha256,
      capturedRunUrl: `https://github.com/${bundle.repo}/actions/runs/${bundle.runId}`,
      actionSha: bundle.actionSha,
    },
    cost: { ...cost, status: 'observed' },
    createdAt: options.now().toISOString(),
  });
}

export interface ReplayCatalogOptions {
  readonly rootDir?: string;
  readonly replayDir?: string;
  readonly release?: ReleaseIdentity;
  readonly now?: () => Date;
  readonly replay?: ReplayedResultOptions['replay'];
}

export function readReplayBundleFile(path: string): { value: unknown; sha256: string } {
  const bytes = readFileSync(path);
  if (bytes.byteLength > MAX_BUNDLE_BYTES) {
    throw new CaseLabReplayError(`replay bundle ${path} exceeds ${MAX_BUNDLE_BYTES} bytes`);
  }
  return {
    value: JSON.parse(bytes.toString('utf8')) as unknown,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** One deterministic result for one case: a complete replay bundle when present, else the recorded live result. */
export async function deterministicResult(
  caseId: CaseLabCaseId | string,
  options: ReplayCatalogOptions = {},
): Promise<CaseLabResult> {
  const item = caseLabCase(caseId);
  const release = options.release ?? loadRelease();
  const now = options.now ?? (() => new Date());
  const bundlePath = resolve(options.replayDir ?? REPLAY_DIR, `${item.id}.json`);
  if (existsSync(bundlePath)) {
    const { value, sha256 } = readReplayBundleFile(bundlePath);
    return replayedResult(item, value, {
      release, now, bundleSha256: sha256,
      ...(options.replay === undefined ? {} : { replay: options.replay }),
    });
  }
  const evidence = loadRecordedEvidence(options.rootDir ?? REPOSITORY_ROOT);
  return recordedResult(item, evidence, { release, now });
}

/** Every case, in the roadmap order, each validated. */
export async function replayCatalog(options: ReplayCatalogOptions = {}): Promise<CaseLabResult[]> {
  const results: CaseLabResult[] = [];
  for (const item of CASE_LAB_CASES) {
    results.push(await deterministicResult(item.id, options));
  }
  return results;
}
