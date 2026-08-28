export const DEFAULT_MODELS = {
  nano: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
  super: 'nvidia/nemotron-3-super-120b-a12b',
  ultra: 'nvidia/Nemotron-3-Ultra-550b-a55b',
} as const;

export const MAX_TRIAGE_RUNS = 20;
export const MAX_RACE_CANDIDATES = 10;
export const MAX_STAGE_EVIDENCE_ENTRIES = 100;

export interface Config {
  nebiusApiKey: string;
  tavilyApiKey?: string;
  contreeToken?: string;
  contreeProject?: string;
  triageN: number;
  raceK: number;
  models: Record<keyof typeof DEFAULT_MODELS, string>;
  maxOps: number;
}

export type ConfigEnvironment = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function required(env: ConfigEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optional(env: ConfigEnvironment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function positiveInteger(
  env: ConfigEnvironment,
  name: string,
  fallback: number,
): number {
  const value = optional(env, name);
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive integer`);
  }

  return parsed;
}

function boundedPositiveInteger(
  env: ConfigEnvironment,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const value = positiveInteger(env, name, fallback);
  if (value > maximum) {
    throw new ConfigError(`${name} must be at most ${maximum}`);
  }
  return value;
}

export function loadConfig(env: ConfigEnvironment): Config {
  const config: Config = {
    nebiusApiKey: required(env, 'NEBIUS_API_KEY'),
    triageN: boundedPositiveInteger(
      env,
      'SUTURA_TRIAGE_N',
      5,
      MAX_TRIAGE_RUNS,
    ),
    raceK: boundedPositiveInteger(
      env,
      'SUTURA_RACE_K',
      3,
      MAX_RACE_CANDIDATES,
    ),
    models: {
      nano: optional(env, 'SUTURA_MODEL_NANO') ?? DEFAULT_MODELS.nano,
      super: optional(env, 'SUTURA_MODEL_SUPER') ?? DEFAULT_MODELS.super,
      ultra: optional(env, 'SUTURA_MODEL_ULTRA') ?? DEFAULT_MODELS.ultra,
    },
    maxOps: positiveInteger(env, 'SUTURA_MAX_OPS', 40),
  };

  const tavilyApiKey = optional(env, 'TAVILY_API_KEY');
  if (tavilyApiKey !== undefined) {
    config.tavilyApiKey = tavilyApiKey;
  }

  const contreeToken = optional(env, 'CONTREE_TOKEN');
  if (contreeToken !== undefined) {
    config.contreeToken = contreeToken;
  }

  const contreeProject = optional(env, 'CONTREE_PROJECT');
  if (contreeProject !== undefined) {
    config.contreeProject = contreeProject;
  }

  return config;
}
