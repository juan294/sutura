import { cp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_ROUTING_PROFILE_ID, TraceRecorder, selectWinner } from '@sutura/core';
import { createEvaluationManifest } from '@sutura/evaluation';
import {
  applyPatch,
  copyPortableTestRuntime,
  createPlaceboTemporaryDirectory,
  createPortableTestRuntime,
  createCorpusManifest,
  discoverBenchmarkCases,
  installFixture,
  verifyCandidateWithHiddenTests,
  type PortableTestRuntime,
} from './corpus.js';
import { score } from './score.js';
import {
  CORPUS_VERSION,
  type Adapter,
  type BenchmarkManifestOptions,
  type BenchmarkReport,
  type BenchmarkResult,
  type CaseKind,
  type CorpusCase,
} from './types.js';

export interface BenchmarkOptions {
  only?: CaseKind;
  caseId?: string;
  noTavily?: boolean;
  manifest?: BenchmarkManifestOptions;
  clock?: () => number;
}

async function evaluate(
  adapter: Adapter,
  benchmarkCase: CorpusCase,
  tavilyEnabled: boolean,
  portableRuntime: PortableTestRuntime,
  clock: () => number,
): Promise<BenchmarkResult> {
  const startedAt = clock();
  const temporaryRoot = await createPlaceboTemporaryDirectory(`run-${benchmarkCase.id}-`);
  const fixture = join(temporaryRoot, 'fixture');
  try {
    await cp(benchmarkCase.fixtureDirectory, fixture, { recursive: true });
    if (benchmarkCase.metadata.language !== 'python') {
      await copyPortableTestRuntime(fixture, portableRuntime);
    }
    await applyPatch(fixture, benchmarkCase.breakPatch);
    if (benchmarkCase.metadata.kind === 'upstream') {
      await installFixture(fixture, portableRuntime.storeDirectory);
    }
    const configured = adapter.withTavily?.(tavilyEnabled) ?? adapter;
    const candidateDiff = benchmarkCase.metadata.placebo
      ? await readFile(join(benchmarkCase.directory, benchmarkCase.metadata.placebo), 'utf8')
      : undefined;
    const context = {
      language: benchmarkCase.metadata.language,
      ...(candidateDiff ? { candidateDiff } : {}),
    };
    const caseFile = await configured.heal(fixture, context);
    const hiddenCandidate = benchmarkCase.metadata.kind === 'trap'
      ? candidateDiff
      : selectWinner(caseFile.race)?.candidate.diff;
    const hiddenVerification = await verifyCandidateWithHiddenTests(
      benchmarkCase,
      hiddenCandidate,
      portableRuntime,
    );
    let tracedCaseFile = caseFile;
    if (caseFile.trace === undefined) {
      const runId = `placebo-${benchmarkCase.id}-${tavilyEnabled ? 'with' : 'without'}-tavily`;
      const trace = new TraceRecorder(runId);
      trace.record({ type: 'run-start', stage: 'run', summary: 'Placebo adapter evaluation started' });
      trace.record({ type: 'run-finish', stage: 'run', outcome: caseFile.outcome });
      tracedCaseFile = { ...caseFile, trace: trace.events() };
    }
    return {
      caseId: benchmarkCase.id,
      kind: benchmarkCase.metadata.kind,
      language: benchmarkCase.metadata.language,
      caseFile: tracedCaseFile,
      tavilyEnabled,
      elapsedTimeMs: Math.max(0, clock() - startedAt),
      ...(benchmarkCase.metadata.triageExitCodes ? { triageExitCodes: benchmarkCase.metadata.triageExitCodes } : {}),
      ...(benchmarkCase.metadata.releaseFact ? { releaseFact: benchmarkCase.metadata.releaseFact } : {}),
      ...(benchmarkCase.metadata.kind === 'repairable'
        ? { difficulty: benchmarkCase.metadata.difficulty ?? 'standard' as const }
        : {}),
      failureClass: benchmarkCase.metadata.class,
      ...(benchmarkCase.metadata.flakePattern ? { flakePattern: benchmarkCase.metadata.flakePattern } : {}),
      ...(hiddenVerification ? { hiddenVerification } : {}),
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function runBenchmark(adapter: Adapter, options: BenchmarkOptions = {}): Promise<BenchmarkReport> {
  const discovered = await discoverBenchmarkCases();
  const cases = discovered.filter((benchmarkCase) =>
    (!options.only || benchmarkCase.metadata.kind === options.only) &&
    (!options.caseId || benchmarkCase.id === options.caseId));
  if (options.caseId !== undefined && cases.length !== 1) {
    throw new Error(`Unknown Placebo case: ${options.caseId}`);
  }
  const results: BenchmarkResult[] = [];
  const portableRuntime = await createPortableTestRuntime();
  const clock = options.clock ?? performance.now.bind(performance);
  try {
    for (const benchmarkCase of cases) {
      if (benchmarkCase.metadata.kind === 'upstream' && !options.noTavily) {
        results.push(await evaluate(adapter, benchmarkCase, true, portableRuntime, clock));
        results.push(await evaluate(adapter, benchmarkCase, false, portableRuntime, clock));
      } else {
        results.push(await evaluate(adapter, benchmarkCase, !options.noTavily, portableRuntime, clock));
      }
    }
  } finally {
    await portableRuntime.cleanup();
  }
  const benchmarkScore = score(results);
  const manifest = options.manifest === undefined
    ? undefined
    : createEvaluationManifest({
        ...options.manifest,
        completedAt: options.manifest.completedAt ?? new Date().toISOString(),
        corpusName: 'placebo',
        corpusVersion: CORPUS_VERSION,
        corpusHash: (await createCorpusManifest()).corpusHash,
        adapterVersion: '0.2.1',
        modelCatalogSnapshot: [...new Set(results.flatMap(({ caseFile }) =>
          caseFile.trace?.flatMap((event) =>
            event.type === 'model-response' ? [event.model] : []) ?? []))],
        routingProfile: DEFAULT_ROUTING_PROFILE_ID,
        budgetProfile: 'default',
        cases: results.map(({ caseId, caseFile, tavilyEnabled }) => ({
          caseId: `${caseId}:${tavilyEnabled ? 'with-tavily' : 'without-tavily'}`,
          outcome: caseFile.outcome,
          trace: caseFile.trace!,
        })),
      });
  return {
    adapter: adapter.name,
    results,
    score: benchmarkScore,
    ...(manifest === undefined ? {} : { manifest }),
  };
}
