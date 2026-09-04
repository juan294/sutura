import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { contentHash } from './canonical.js';
import type { CaseLabCaseFile } from './result.js';

export const RECORDED_RESULT_FILE = 'docs/demo/placebo-v0.2-live-2026-09.json';
export const RECORDED_LEDGER_FILE = 'docs/demo/placebo-v0.2-live-ledger-2026-09.json';
const MAX_EVIDENCE_BYTES = 64 * 1_024 * 1_024;

export interface RecordedEvaluation {
  readonly caseId: string;
  readonly caseFile: CaseLabCaseFile & { readonly trace?: unknown };
  readonly elapsedTimeMs: number;
  readonly tavilyEnabled?: boolean;
}

export interface RecordedResultFile {
  readonly schemaVersion: 'sutura-placebo-live-result-v1';
  readonly controllerSha: string;
  readonly subjectSha: string;
  readonly subjectVersion: string;
  readonly ledgerHash: string;
  readonly resultHash: string;
  readonly results: readonly RecordedEvaluation[];
}

export interface RecordedLedgerEntry {
  readonly caseId: string;
  readonly runId: string;
  readonly runUrl: string;
  readonly recordedAt: string;
  readonly inferenceUsd: number;
  readonly sandboxUsd: number;
}

export interface RecordedLedgerFile {
  readonly schemaVersion: 'sutura-placebo-live-ledger-v1';
  readonly entries: readonly RecordedLedgerEntry[];
  readonly resultHash: string;
}

export interface RecordedEvidence {
  readonly result: RecordedResultFile;
  readonly ledger: RecordedLedgerFile;
  readonly resultFile: string;
  readonly ledgerFile: string;
}

export class CaseLabEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseLabEvidenceError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(path: string, label: string): unknown {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new CaseLabEvidenceError(`${label} is missing at ${path}`);
  }
  if (bytes.byteLength > MAX_EVIDENCE_BYTES) {
    throw new CaseLabEvidenceError(`${label} exceeds ${MAX_EVIDENCE_BYTES} bytes`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new CaseLabEvidenceError(`${label} is not valid JSON`);
  }
}

/**
 * Load the committed live benchmark result and ledger and prove their
 * self-referential hashes, so a tampered evidence file cannot feed a
 * recorded Case Lab result.
 */
export function loadRecordedEvidence(rootDir: string): RecordedEvidence {
  const resultFile = resolve(rootDir, RECORDED_RESULT_FILE);
  const ledgerFile = resolve(rootDir, RECORDED_LEDGER_FILE);
  const result = readJson(resultFile, RECORDED_RESULT_FILE);
  const ledger = readJson(ledgerFile, RECORDED_LEDGER_FILE);
  if (!isRecord(result) || result.schemaVersion !== 'sutura-placebo-live-result-v1' || !Array.isArray(result.results)) {
    throw new CaseLabEvidenceError(`${RECORDED_RESULT_FILE} must be a sutura-placebo-live-result-v1 document`);
  }
  if (!isRecord(ledger) || ledger.schemaVersion !== 'sutura-placebo-live-ledger-v1' || !Array.isArray(ledger.entries)) {
    throw new CaseLabEvidenceError(`${RECORDED_LEDGER_FILE} must be a sutura-placebo-live-ledger-v1 document`);
  }
  const { resultHash: recordedResultHash, ...resultBase } = result;
  if (contentHash(resultBase) !== recordedResultHash) {
    throw new CaseLabEvidenceError(`${RECORDED_RESULT_FILE} resultHash does not match its content`);
  }
  if (contentHash(ledger.entries) !== ledger.resultHash) {
    throw new CaseLabEvidenceError(`${RECORDED_LEDGER_FILE} resultHash does not match its entries`);
  }
  if (result.ledgerHash !== ledger.resultHash) {
    throw new CaseLabEvidenceError(`${RECORDED_RESULT_FILE} ledgerHash does not match ${RECORDED_LEDGER_FILE}`);
  }
  return {
    result: result as unknown as RecordedResultFile,
    ledger: ledger as unknown as RecordedLedgerFile,
    resultFile,
    ledgerFile,
  };
}

export function recordedEvaluation(
  evidence: RecordedEvidence,
  placeboCaseId: string,
  tavilyEnabled: boolean,
): { evaluation: RecordedEvaluation; ledgerEntry: RecordedLedgerEntry } {
  const candidates = evidence.result.results.filter((item) => item.caseId === placeboCaseId);
  const evaluation = candidates.length > 1
    ? candidates.find((item) => item.tavilyEnabled === tavilyEnabled)
    : candidates[0];
  if (!evaluation) {
    throw new CaseLabEvidenceError(`${RECORDED_RESULT_FILE} has no evaluation for ${placeboCaseId}`);
  }
  const ledgerEntry = evidence.ledger.entries.find((entry) => entry.caseId === placeboCaseId);
  if (!ledgerEntry) {
    throw new CaseLabEvidenceError(`${RECORDED_LEDGER_FILE} has no entry for ${placeboCaseId}`);
  }
  return { evaluation, ledgerEntry };
}
