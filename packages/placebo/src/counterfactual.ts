import { createHash } from 'node:crypto';
import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COUNTERFACTUAL_GATES,
  COUNTERFACTUAL_INTENTS,
  createDefaultRepositoryPolicy,
  runMechanicalChecks,
  validateCandidateDiff,
  type CounterfactualGate,
  type CounterfactualIntent,
  type Diagnosis,
  type FailureClass,
} from '@sutura/core';
import { canonicalJson } from '@sutura/evaluation';

import {
  applyPatch,
  copyPortableTestRuntime,
  createCorpusManifest,
  createPlaceboTemporaryDirectory,
  createPortableTestRuntime,
  discoverCases,
  installFixture,
  runFixtureSuite,
  verifyCandidateWithHiddenTests,
  type PortableTestRuntime,
} from './corpus.js';
import type {
  CorpusCase,
  FixtureLanguage,
  HiddenVerificationResult,
} from './types.js';

export const COUNTERFACTUAL_SCHEMA_VERSION = 'sutura-counterfactual-v1' as const;
export const COUNTERFACTUAL_SET_VERSION = '0.2' as const;

const DEFAULT_COUNTERFACTUAL_DIRECTORY = fileURLToPath(
  new URL('../counterfactual', import.meta.url),
);
const ALTERNATIVE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const DIFF_FILE = /^[a-z0-9][a-z0-9-]{0,63}\.diff$/u;
const GATES = new Set<string>(COUNTERFACTUAL_GATES);
const INTENTS = new Set<string>(COUNTERFACTUAL_INTENTS);

/**
 * The gates the offline harness can reach with no provider, in the production
 * order the audit applies them. `suite-rerun`, `adjudication`, and
 * `repository-policy` are recorded as not reached with their reason.
 */
export const DETERMINISTIC_GATES = ['patch-policy', 'mechanical', 'verification'] as const;
const PROVIDER_GATE_REASONS: Readonly<Record<string, string>> = {
  'suite-rerun': 'The offline harness runs the visible suite once; there is no second image to rerun.',
  adjudication: 'The adversarial Ultra audit requires an authorized provider.',
  'repository-policy': 'The Placebo fixtures declare no repository policy commands.',
};

function notReachedGates(
  reached: readonly CounterfactualGate[],
  rejectedAt: CounterfactualGate | null,
): Array<{ gate: CounterfactualGate; reason: string }> {
  return COUNTERFACTUAL_GATES.filter((gate) => !reached.includes(gate)).map((gate) => ({
    gate,
    reason: PROVIDER_GATE_REASONS[gate] ??
      `An earlier gate refused the alternative at ${rejectedAt ?? 'an earlier gate'}.`,
  }));
}

export interface CounterfactualAlternativeDeclaration {
  id: string;
  intent: CounterfactualIntent;
  rationale: string;
  file: string;
  expectedRejection: { gate: CounterfactualGate; rule: string } | null;
}

export interface CounterfactualAcceptedDeclaration {
  outcome: 'fixed' | 'refused';
  patch: string;
  evidence: string;
}

export interface CounterfactualCaseDeclaration {
  version: typeof COUNTERFACTUAL_SET_VERSION;
  caseId: string;
  accepted: CounterfactualAcceptedDeclaration;
  alternatives: CounterfactualAlternativeDeclaration[];
}

export interface CounterfactualCase {
  declaration: CounterfactualCaseDeclaration;
  directory: string;
  corpusCase: CorpusCase;
  diffs: Map<string, string>;
  acceptedDiff: string;
}

export interface CounterfactualObservation {
  gate: CounterfactualGate;
  rule: string;
  evidence: string;
}

export interface CounterfactualAlternativeReport {
  id: string;
  intent: CounterfactualIntent;
  rationale: string;
  diffHash: string;
  rejected: boolean;
  observed: CounterfactualObservation | null;
  expected: { gate: CounterfactualGate; rule: string } | null;
  matchesExpectation: boolean;
  reachedGates: CounterfactualGate[];
  notReached: Array<{ gate: CounterfactualGate; reason: string }>;
  visibleSuiteExitCode: number | null;
  hiddenVerification?: HiddenVerificationResult;
  cost: { inferenceUsd: 0; sandboxOperations: number; elapsedTimeSec: number };
}

export interface CounterfactualCaseReport {
  caseId: string;
  kind: CorpusCase['metadata']['kind'];
  language: FixtureLanguage;
  failureClass: FailureClass;
  accepted: CounterfactualAcceptedDeclaration & {
    diffHash: string;
    visibleSuiteExitCode: number;
    deterministicGatesPassed: boolean;
    hiddenVerification?: HiddenVerificationResult;
  };
  alternatives: CounterfactualAlternativeReport[];
}

export interface CounterfactualReport {
  schemaVersion: typeof COUNTERFACTUAL_SCHEMA_VERSION;
  corpusVersion: string;
  corpusHash: string;
  counterfactualHash: string;
  cases: CounterfactualCaseReport[];
  totals: {
    cases: number;
    alternatives: number;
    rejected: number;
    shortcuts: number;
    shortcutsRejected: number;
    expectationMismatches: number;
    inferenceUsd: 0;
    sandboxOperations: number;
    elapsedTimeSec: number;
  };
  resultHash: string;
}

function refuse(message: string): never {
  throw new Error(message);
}

function parseDeclaration(text: string, caseId: string): CounterfactualCaseDeclaration {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    refuse(`Counterfactual set ${caseId} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`Counterfactual set ${caseId} must be an object`);
  }
  const declaration = value as Record<string, unknown>;
  if (declaration.version !== COUNTERFACTUAL_SET_VERSION) {
    refuse(`Counterfactual set ${caseId} must declare version ${COUNTERFACTUAL_SET_VERSION}`);
  }
  if (declaration.caseId !== caseId) {
    refuse(`Counterfactual set ${caseId} declares a different caseId`);
  }
  const accepted = declaration.accepted as Record<string, unknown> | undefined;
  if (
    typeof accepted !== 'object' || accepted === null ||
    (accepted.outcome !== 'fixed' && accepted.outcome !== 'refused') ||
    typeof accepted.patch !== 'string' || !accepted.patch.trim() ||
    typeof accepted.evidence !== 'string' || !accepted.evidence.trim()
  ) refuse(`Counterfactual set ${caseId} must declare an accepted outcome, patch, and evidence`);
  if (!Array.isArray(declaration.alternatives)) {
    refuse(`Counterfactual set ${caseId} must declare an alternatives array`);
  }
  const alternatives = declaration.alternatives.map((entry, index): CounterfactualAlternativeDeclaration => {
    const name = `${caseId}.alternatives[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      refuse(`${name} must be an object`);
    }
    const item = entry as Record<string, unknown>;
    for (const key of Object.keys(item)) {
      if (!['id', 'intent', 'rationale', 'file', 'expectedRejection'].includes(key)) {
        refuse(`${name} has an unsupported field: ${key}`);
      }
    }
    if (typeof item.id !== 'string' || !ALTERNATIVE_ID.test(item.id)) {
      refuse(`${name}.id must match ${ALTERNATIVE_ID.source}`);
    }
    if (typeof item.intent !== 'string' || !INTENTS.has(item.intent)) {
      refuse(`${name}.intent must be one of ${[...INTENTS].join(', ')}`);
    }
    if (typeof item.rationale !== 'string' || !item.rationale.trim() || item.rationale.length > 240) {
      refuse(`${name}.rationale must be a non-empty string of at most 240 characters`);
    }
    if (typeof item.file !== 'string' || !DIFF_FILE.test(item.file)) {
      refuse(`${name}.file must be a bounded .diff name inside the case directory`);
    }
    const expected = item.expectedRejection;
    if (expected !== null) {
      if (typeof expected !== 'object' || expected === null || Array.isArray(expected)) {
        refuse(`${name}.expectedRejection must be an object or null`);
      }
      const rejection = expected as Record<string, unknown>;
      if (typeof rejection.gate !== 'string' || !GATES.has(rejection.gate)) {
        refuse(`${name}.expectedRejection.gate must be a counterfactual gate`);
      }
      if (typeof rejection.rule !== 'string' || !rejection.rule.trim()) {
        refuse(`${name}.expectedRejection.rule must be non-empty`);
      }
    }
    return {
      id: item.id,
      intent: item.intent as CounterfactualIntent,
      rationale: item.rationale,
      file: item.file,
      expectedRejection: expected === null
        ? null
        : expected as CounterfactualAlternativeDeclaration['expectedRejection'],
    };
  });
  if (alternatives.length < 2 || alternatives.length > 3) {
    refuse(`Counterfactual set ${caseId} must declare two or three alternatives`);
  }
  if (new Set(alternatives.map(({ id }) => id)).size !== alternatives.length) {
    refuse(`Counterfactual set ${caseId} alternative ids must be distinct`);
  }
  if (!alternatives.some(({ intent }) => intent === 'shortcut')) {
    refuse(`Counterfactual set ${caseId} must include at least one shortcut`);
  }
  return {
    version: COUNTERFACTUAL_SET_VERSION,
    caseId,
    accepted: accepted as unknown as CounterfactualAcceptedDeclaration,
    alternatives,
  };
}

export async function discoverCounterfactualCases(
  counterfactualDirectory = DEFAULT_COUNTERFACTUAL_DIRECTORY,
  corpusCases?: CorpusCase[],
): Promise<CounterfactualCase[]> {
  const corpus = new Map(
    (corpusCases ?? await discoverCases()).map((item) => [item.id, item] as const),
  );
  const entries = await readdir(counterfactualDirectory, { withFileTypes: true });
  const cases = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async ({ name }) => {
      const directory = join(counterfactualDirectory, name);
      const declaration = parseDeclaration(
        await readFile(join(directory, 'alternatives.json'), 'utf8'),
        name,
      );
      const corpusCase = corpus.get(name);
      if (corpusCase === undefined) {
        refuse(`Counterfactual set ${name} names a case that is not in the corpus`);
      }
      const diffs = new Map<string, string>();
      for (const alternative of declaration.alternatives) {
        diffs.set(alternative.id, await readFile(join(directory, alternative.file), 'utf8'));
      }
      if (new Set(diffs.values()).size !== diffs.size) {
        refuse(`Counterfactual set ${name} alternative diffs must be distinct`);
      }
      return {
        declaration,
        directory,
        corpusCase,
        diffs,
        acceptedDiff: await readFile(join(directory, declaration.accepted.patch), 'utf8'),
      };
    }));
  return cases.sort((left, right) =>
    left.declaration.caseId.localeCompare(right.declaration.caseId));
}

async function treeHash(directory: string): Promise<string> {
  const files: Array<{ path: string; sha256: string }> = [];
  async function visit(current: string, prefix = ''): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path, relative);
      else if (entry.isFile()) {
        files.push({
          path: relative,
          sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
        });
      } else refuse(`Counterfactual set contains an unsupported entry: ${relative}`);
    }
  }
  await visit(directory);
  return createHash('sha256').update(canonicalJson(files)).digest('hex');
}

export function createCounterfactualManifestHash(
  directory = DEFAULT_COUNTERFACTUAL_DIRECTORY,
): Promise<string> {
  return treeHash(directory);
}

function mechanicalDiagnosis(benchmarkCase: CorpusCase): Diagnosis {
  return {
    class: benchmarkCase.metadata.class,
    confidence: 1,
    signals: [`placebo:${benchmarkCase.metadata.riskClass}`],
    failingCmd: benchmarkCase.metadata.expectedChecks[0] ?? 'pnpm test',
    errorExcerpt: benchmarkCase.metadata.description,
  };
}

interface GateOutcome {
  observed: CounterfactualObservation | null;
  reachedGates: CounterfactualGate[];
  visibleSuiteExitCode: number | null;
  sandboxOperations: number;
  elapsedTimeSec: number;
}

/**
 * Applies one patch to a fresh copy of the broken fixture and walks the
 * deterministic gates in the production order: the repository and built-in
 * patch policy, then the mechanical green-washing checks, then the visible
 * verification suite. The first gate that refuses is the recorded one, which
 * is the same rule `evaluateCounterfactuals` records on the live path.
 */
async function runDeterministicGates(
  benchmarkCase: CorpusCase,
  diff: string,
  portableRuntime: PortableTestRuntime,
  clock: () => number,
): Promise<GateOutcome> {
  const startedAt = clock();
  const reachedGates: CounterfactualGate[] = ['patch-policy'];
  const policy = createDefaultRepositoryPolicy();
  const validation = validateCandidateDiff(diff, mechanicalDiagnosis(benchmarkCase), policy);
  if (!validation.ok) {
    return {
      observed: {
        gate: 'patch-policy',
        rule: validation.violations[0]!,
        evidence: validation.violations.join('; '),
      },
      reachedGates,
      visibleSuiteExitCode: null,
      sandboxOperations: 0,
      elapsedTimeSec: Math.max(0, (clock() - startedAt) / 1_000),
    };
  }
  reachedGates.push('mechanical');
  const mechanical = runMechanicalChecks(diff).find(({ passed }) => !passed);
  if (mechanical !== undefined) {
    return {
      observed: {
        gate: 'mechanical',
        rule: mechanical.name,
        evidence: mechanical.evidence ?? 'No evidence recorded',
      },
      reachedGates,
      visibleSuiteExitCode: null,
      sandboxOperations: 0,
      elapsedTimeSec: Math.max(0, (clock() - startedAt) / 1_000),
    };
  }
  reachedGates.push('verification');
  const temporaryRoot = await createPlaceboTemporaryDirectory(`cf-${benchmarkCase.id}-`);
  const fixture = join(temporaryRoot, 'fixture');
  let sandboxOperations = 0;
  try {
    await cp(benchmarkCase.fixtureDirectory, fixture, { recursive: true });
    if (benchmarkCase.metadata.language !== 'python') {
      await copyPortableTestRuntime(fixture, portableRuntime);
    }
    await applyPatch(fixture, benchmarkCase.breakPatch);
    const patchFile = join(temporaryRoot, 'alternative.diff');
    await writeFile(patchFile, diff);
    await applyPatch(fixture, patchFile);
    sandboxOperations += 1;
    if (benchmarkCase.metadata.language !== 'python') {
      await installFixture(fixture, portableRuntime.storeDirectory);
      sandboxOperations += 1;
    }
    const exitCode = await runFixtureSuite(fixture);
    sandboxOperations += 1;
    return {
      observed: exitCode === 0 ? null : {
        gate: 'verification',
        rule: 'verification-command',
        evidence: `The diagnosed verification command exited ${exitCode}`,
      },
      reachedGates,
      visibleSuiteExitCode: exitCode,
      sandboxOperations,
      elapsedTimeSec: Math.max(0, (clock() - startedAt) / 1_000),
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export interface CounterfactualCheckOptions {
  caseId?: string;
  counterfactualDirectory?: string;
  storeDirectory?: string;
  clock?: () => number;
}

function normalizedForHash(report: Omit<CounterfactualReport, 'resultHash'>): unknown {
  return {
    ...report,
    totals: { ...report.totals, elapsedTimeSec: 0 },
    cases: report.cases.map((item) => ({
      ...item,
      alternatives: item.alternatives.map((alternative) => ({
        ...alternative,
        cost: { ...alternative.cost, elapsedTimeSec: 0 },
      })),
    })),
  };
}

export async function runCounterfactualCheck(
  options: CounterfactualCheckOptions = {},
): Promise<CounterfactualReport> {
  const clock = options.clock ?? (() => Date.now());
  const corpusCases = await discoverCases();
  const discovered = await discoverCounterfactualCases(
    options.counterfactualDirectory ?? DEFAULT_COUNTERFACTUAL_DIRECTORY,
    corpusCases,
  );
  const selected = options.caseId === undefined
    ? discovered
    : discovered.filter(({ declaration }) => declaration.caseId === options.caseId);
  if (options.caseId !== undefined && selected.length !== 1) {
    refuse(`Unknown counterfactual case: ${options.caseId}`);
  }
  const portableRuntime = await createPortableTestRuntime(options.storeDirectory);
  const cases: CounterfactualCaseReport[] = [];
  try {
    for (const item of selected) {
      const { corpusCase, declaration } = item;
      const accepted = await runDeterministicGates(corpusCase, item.acceptedDiff, portableRuntime, clock);
      const acceptedHidden = await verifyCandidateWithHiddenTests(
        corpusCase, item.acceptedDiff, portableRuntime,
      );
      const alternatives: CounterfactualAlternativeReport[] = [];
      for (const alternative of declaration.alternatives) {
        const diff = item.diffs.get(alternative.id)!;
        const outcome = await runDeterministicGates(corpusCase, diff, portableRuntime, clock);
        const hidden = await verifyCandidateWithHiddenTests(corpusCase, diff, portableRuntime);
        const expected = alternative.expectedRejection;
        alternatives.push({
          id: alternative.id,
          intent: alternative.intent,
          rationale: alternative.rationale,
          diffHash: createHash('sha256').update(diff).digest('hex'),
          rejected: outcome.observed !== null,
          observed: outcome.observed,
          expected,
          matchesExpectation: expected === null
            ? outcome.observed === null
            : outcome.observed !== null &&
              outcome.observed.gate === expected.gate &&
              outcome.observed.rule === expected.rule,
          reachedGates: outcome.reachedGates,
          notReached: notReachedGates(outcome.reachedGates, outcome.observed?.gate ?? null),
          visibleSuiteExitCode: outcome.visibleSuiteExitCode,
          ...(hidden ? { hiddenVerification: hidden } : {}),
          cost: {
            inferenceUsd: 0,
            sandboxOperations: outcome.sandboxOperations,
            elapsedTimeSec: outcome.elapsedTimeSec,
          },
        });
      }
      cases.push({
        caseId: declaration.caseId,
        kind: corpusCase.metadata.kind,
        language: corpusCase.metadata.language,
        failureClass: corpusCase.metadata.class,
        accepted: {
          ...declaration.accepted,
          diffHash: createHash('sha256').update(item.acceptedDiff).digest('hex'),
          visibleSuiteExitCode: accepted.visibleSuiteExitCode ?? -1,
          deterministicGatesPassed: accepted.observed === null,
          ...(acceptedHidden ? { hiddenVerification: acceptedHidden } : {}),
        },
        alternatives,
      });
    }
  } finally {
    await portableRuntime.cleanup();
  }

  const everyAlternative = cases.flatMap(({ alternatives }) => alternatives);
  const shortcuts = everyAlternative.filter(({ intent }) => intent === 'shortcut');
  const base = {
    schemaVersion: COUNTERFACTUAL_SCHEMA_VERSION,
    corpusVersion: corpusCases[0]?.metadata.version ?? '0.2',
    corpusHash: (await createCorpusManifest(corpusCases)).corpusHash,
    counterfactualHash: await treeHash(
      options.counterfactualDirectory ?? DEFAULT_COUNTERFACTUAL_DIRECTORY,
    ),
    cases,
    totals: {
      cases: cases.length,
      alternatives: everyAlternative.length,
      rejected: everyAlternative.filter(({ rejected }) => rejected).length,
      shortcuts: shortcuts.length,
      shortcutsRejected: shortcuts.filter(({ rejected }) => rejected).length,
      expectationMismatches: everyAlternative.filter(({ matchesExpectation }) => !matchesExpectation).length,
      inferenceUsd: 0 as const,
      sandboxOperations: everyAlternative.reduce((total, { cost }) => total + cost.sandboxOperations, 0),
      elapsedTimeSec: everyAlternative.reduce((total, { cost }) => total + cost.elapsedTimeSec, 0),
    },
  };
  return {
    ...base,
    resultHash: createHash('sha256').update(canonicalJson(normalizedForHash(base))).digest('hex'),
  };
}
