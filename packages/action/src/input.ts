import { MAX_RACE_CANDIDATES, MAX_TRIAGE_RUNS } from '@sutura/core';

export type InputReader = (name: string) => string;

export interface ActionConfiguration {
  githubToken: string;
  runId: string;
  triageN: number;
  raceK: number;
  environment: Readonly<Record<string, string>>;
}

export class ActionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionInputError';
  }
}

function required(read: InputReader, name: string): string {
  const value = read(name).trim();
  if (!value) throw new ActionInputError(`Missing required action input: ${name}`);
  return value;
}

function boundedInteger(
  value: string,
  fallback: number,
  maximum: number,
  name: string,
): number {
  if (!value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new ActionInputError(`${name} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

function optional(
  environment: Record<string, string>,
  read: InputReader,
  input: string,
  variable: string,
): void {
  const value = read(input).trim();
  if (value) environment[variable] = value;
}

export function mapActionInputs(read: InputReader): ActionConfiguration {
  const runId = required(read, 'run-id');
  if (!/^[1-9]\d*$/.test(runId)) {
    throw new ActionInputError('run-id must be a positive decimal id');
  }
  const triageN = boundedInteger(read('triage-n'), 5, MAX_TRIAGE_RUNS, 'triage-n');
  const raceK = boundedInteger(read('race-k'), 3, MAX_RACE_CANDIDATES, 'race-k');
  const environment: Record<string, string> = {
    NEBIUS_API_KEY: required(read, 'nebius-api-key'),
    CONTREE_TOKEN: required(read, 'contree-token'),
    CONTREE_PROJECT: required(read, 'contree-project'),
    SUTURA_TRIAGE_N: String(triageN),
    SUTURA_RACE_K: String(raceK),
  };
  optional(environment, read, 'tavily-api-key', 'TAVILY_API_KEY');
  optional(environment, read, 'model-nano', 'SUTURA_MODEL_NANO');
  optional(environment, read, 'model-super', 'SUTURA_MODEL_SUPER');
  optional(environment, read, 'model-ultra', 'SUTURA_MODEL_ULTRA');

  return {
    githubToken: required(read, 'github-token'),
    runId,
    triageN,
    raceK,
    environment,
  };
}
