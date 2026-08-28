import { cp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  applyPatch,
  copyPortableTestRuntime,
  createPlaceboTemporaryDirectory,
  createPortableTestRuntime,
  discoverCases,
  installFixture,
  type PortableTestRuntime,
} from './corpus.js';
import { score } from './score.js';
import type { Adapter, BenchmarkResult, CaseKind, CorpusCase, Score } from './types.js';

export interface BenchmarkOptions { only?: CaseKind; noTavily?: boolean }
export interface BenchmarkReport { adapter: string; results: BenchmarkResult[]; score: Score }

async function evaluate(
  adapter: Adapter,
  benchmarkCase: CorpusCase,
  tavilyEnabled: boolean,
  portableRuntime: PortableTestRuntime,
): Promise<BenchmarkResult> {
  const temporaryRoot = await createPlaceboTemporaryDirectory(`run-${benchmarkCase.id}-`);
  const fixture = join(temporaryRoot, 'fixture');
  try {
    await cp(benchmarkCase.fixtureDirectory, fixture, { recursive: true });
    await copyPortableTestRuntime(fixture, portableRuntime);
    await applyPatch(fixture, benchmarkCase.breakPatch);
    if (benchmarkCase.metadata.kind === 'upstream') {
      await installFixture(fixture, portableRuntime.storeDirectory);
    }
    const configured = adapter.withTavily?.(tavilyEnabled) ?? adapter;
    const candidateDiff = benchmarkCase.metadata.placebo
      ? await readFile(join(benchmarkCase.directory, benchmarkCase.metadata.placebo), 'utf8')
      : undefined;
    const context = {
      ...(candidateDiff ? { candidateDiff } : {}),
    };
    return {
      caseId: benchmarkCase.id,
      kind: benchmarkCase.metadata.kind,
      caseFile: await configured.heal(fixture, context),
      tavilyEnabled,
      ...(benchmarkCase.metadata.triageExitCodes ? { triageExitCodes: benchmarkCase.metadata.triageExitCodes } : {}),
      ...(benchmarkCase.metadata.releaseFact ? { releaseFact: benchmarkCase.metadata.releaseFact } : {}),
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function runBenchmark(adapter: Adapter, options: BenchmarkOptions = {}): Promise<BenchmarkReport> {
  const cases = (await discoverCases()).filter(({ metadata }) => !options.only || metadata.kind === options.only);
  const results: BenchmarkResult[] = [];
  const portableRuntime = await createPortableTestRuntime();
  try {
    for (const benchmarkCase of cases) {
      if (benchmarkCase.metadata.kind === 'upstream' && !options.noTavily) {
        results.push(await evaluate(adapter, benchmarkCase, true, portableRuntime));
        results.push(await evaluate(adapter, benchmarkCase, false, portableRuntime));
      } else {
        results.push(await evaluate(adapter, benchmarkCase, !options.noTavily, portableRuntime));
      }
    }
  } finally {
    await portableRuntime.cleanup();
  }
  return { adapter: adapter.name, results, score: score(results) };
}
