import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  FAILURE_TAXONOMY,
  ContreeError,
  ContreeExecutor,
  InMemoryExecutor,
  TavilyClient,
  VERSION,
  classify,
  classifyMechanically,
  generateCandidates,
  ground,
  prepareRepair,
  race,
  selectWinner,
  triage,
  vetPatch,
} from '@sutura/core';
import type {
  ContreeExecutorConfig,
  Executor,
  ImageId,
  InMemoryCall,
  InMemoryRunResult,
  InMemoryScript,
  PatchVerdict,
  RepairLlm,
  RunMetrics,
  RunOptions,
  RunResult,
  TaxonomyEntry,
} from '@sutura/core';

describe('@sutura/core entry point', () => {
  it('retains the scaffold version export', () => {
    expect(VERSION).toBe('0.1.0');
  });

  it('exports executor implementations and types from the package root', () => {
    expect(ContreeExecutor).toBeTypeOf('function');
    expect(ContreeError).toBeTypeOf('function');
    expect(InMemoryExecutor).toBeTypeOf('function');

    expectTypeOf<ContreeExecutorConfig>().toBeObject();
    expectTypeOf<Executor>().toBeObject();
    expectTypeOf<ImageId>().toBeString();
    expectTypeOf<InMemoryCall>().toBeObject();
    expectTypeOf<InMemoryRunResult>().toBeObject();
    expectTypeOf<InMemoryScript>().toBeFunction();
    expectTypeOf<RunMetrics>().toBeObject();
    expectTypeOf<RunOptions>().toBeObject();
    expectTypeOf<RunResult>().toBeObject();
  });

  it('exports the diagnosis and grounding API from the package root', () => {
    expect(FAILURE_TAXONOMY.typecheck.repairable).toBe(true);
    expect(classify).toBeTypeOf('function');
    expect(classifyMechanically).toBeTypeOf('function');
    expect(TavilyClient).toBeTypeOf('function');
    expect(ground).toBeTypeOf('function');
    expectTypeOf<TaxonomyEntry>().toBeObject();
  });

  it('exports the triage and repair API from the package root', () => {
    expect(triage).toBeTypeOf('function');
    expect(generateCandidates).toBeTypeOf('function');
    expect(prepareRepair).toBeTypeOf('function');
    expect(race).toBeTypeOf('function');
    expect(selectWinner).toBeTypeOf('function');
    expect(vetPatch).toBeTypeOf('function');
    expectTypeOf<PatchVerdict>().toBeObject();
    expectTypeOf<RepairLlm>().toBeObject();
  });
});
