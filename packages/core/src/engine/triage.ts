import type { TriageVerdict } from '../domain.js';
import {
  SNAPSHOT_CWD,
  type Executor,
  type ImageId,
  type RunResult,
} from '../executor/types.js';
import { MAX_TRIAGE_RUNS } from '../config.js';
import { shellQuote } from './shell.js';

const DEFAULT_TRIAGE_RUNS = 5;

export async function triage(
  executor: Executor,
  failingImage: ImageId,
  failingCmd: string,
  N = DEFAULT_TRIAGE_RUNS,
  observe?: (result: RunResult, attempt: number) => void,
): Promise<TriageVerdict> {
  if (!Number.isSafeInteger(N) || N <= 0 || N > MAX_TRIAGE_RUNS) {
    throw new RangeError(`N must be between 1 and ${MAX_TRIAGE_RUNS}`);
  }

  const results = await executor.runMany(
    failingImage,
    Array.from(
      { length: N },
      (_, attempt) =>
        `SUTURA_TRIAGE_ATTEMPT=${shellQuote(String(attempt))} sh -lc ${shellQuote(failingCmd)}`,
    ),
    { cwd: SNAPSHOT_CWD },
  );
  const reproduced = results.filter(({ exitCode }) => exitCode !== 0).length;
  results.forEach((result, attempt) => observe?.(result, attempt + 1));
  const status =
    reproduced === N ? 'real' : reproduced === 0 ? 'flaky' : 'intermittent';

  return { status, reproduced, of: N };
}
