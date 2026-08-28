import { createHash } from 'node:crypto';

import {
  EVALUATION_SCHEMA_VERSION,
  type EvaluationManifest,
} from './schema.js';

const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export type EvaluationManifestInput = Omit<
  EvaluationManifest,
  'schemaVersion' | 'resultHash'
> & {
  schemaVersion?: typeof EVALUATION_SCHEMA_VERSION;
  resultHash?: undefined;
  repositoryClean: boolean;
};

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedForHash(value: EvaluationManifest): unknown {
  return {
    ...value,
    startedAt: '[normalized-time]',
    completedAt: '[normalized-time]',
    resultHash: undefined,
    cases: value.cases.map((item) => ({
      ...item,
      trace: item.trace.map((event) => ({
        ...event,
        timestampMs: 0,
        ...(
          event.type === 'model-request' || event.type === 'model-response'
            ? { requestId: event.requestId === null ? null : '[request-id]' }
            : {}
        ),
      })),
    })),
  };
}

export function evaluationResultHash(value: EvaluationManifest): string {
  return createHash('sha256').update(canonicalJson(normalizedForHash(value))).digest('hex');
}

export function createEvaluationManifest(input: EvaluationManifestInput): EvaluationManifest {
  if (!input.repositoryClean) {
    throw new Error('A publishable evaluation manifest requires a clean repository');
  }
  if (!COMMIT.test(input.suturaCommit)) {
    throw new Error('suturaCommit must be an exact 40-character commit');
  }
  if (!SHA256.test(input.corpusHash)) {
    throw new Error('corpusHash must be a SHA-256 digest');
  }
  const cases = [...input.cases]
    .map((item) => ({ ...item, trace: structuredClone(item.trace) }))
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
  const manifest: EvaluationManifest = {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    evaluationId: input.evaluationId,
    suturaCommit: input.suturaCommit,
    corpusName: input.corpusName,
    corpusVersion: input.corpusVersion,
    corpusHash: input.corpusHash,
    adapterVersion: input.adapterVersion,
    modelCatalogSnapshot: [...input.modelCatalogSnapshot].sort(),
    routingProfile: input.routingProfile,
    budgetProfile: input.budgetProfile,
    cases,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    resultHash: '',
  };
  manifest.resultHash = evaluationResultHash(manifest);
  return manifest;
}
