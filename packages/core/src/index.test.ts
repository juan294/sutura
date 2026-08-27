import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ContreeError,
  ContreeExecutor,
  InMemoryExecutor,
  VERSION,
} from '@sutura/core';
import type {
  ContreeExecutorConfig,
  Executor,
  ImageId,
  InMemoryCall,
  InMemoryRunResult,
  InMemoryScript,
  RunMetrics,
  RunOptions,
  RunResult,
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
});
