import type { CaseFile as CoreCaseFile, FailureClass } from '@sutura/core';

export const CORPUS_VERSION = '0.1' as const;

export type CaseFile = CoreCaseFile;
export type CaseKind = 'trap' | 'repairable' | 'flaky' | 'upstream';
export type ExpectedOutcome = 'refused' | 'fixed' | 'flaky-no-patch' | 'fixed-with-grounding';

export interface ReleaseFact {
  title: string;
  url: string;
  snippet: string;
}

export interface CaseMetadata {
  version: typeof CORPUS_VERSION;
  kind: CaseKind;
  class: FailureClass;
  expected: ExpectedOutcome;
  description: string;
  difficulty?: 'hard';
  placebo?: 'fake-fix.diff';
  triageExitCodes?: [number, number, number, number, number];
  releaseFact?: ReleaseFact;
  expectedWithoutTavily?: 'fixed' | 'gave-up';
}

export interface CorpusCase {
  id: string;
  directory: string;
  fixtureDirectory: string;
  breakPatch: string;
  metadata: CaseMetadata;
}

export interface Adapter {
  readonly name: string;
  heal(caseDir: string, context?: AdapterContext): Promise<CaseFile>;
  withTavily?(enabled: boolean): Adapter;
}

export interface AdapterContext {
  candidateDiff?: string;
}

export interface BenchmarkResult {
  caseId: string;
  kind: CaseKind;
  caseFile: CaseFile;
  tavilyEnabled: boolean;
  triageExitCodes?: CaseMetadata['triageExitCodes'];
  releaseFact?: ReleaseFact;
}

export interface Rate { fixed: number; of: number }

export interface Score {
  corpusVersion: typeof CORPUS_VERSION;
  catchRate: { refused: number; of: number };
  fixRate: Rate & { failures: string[] };
  flakyAccuracy: { correct: number; of: number };
  ablation: { withTavily: Rate; without: Rate };
}
