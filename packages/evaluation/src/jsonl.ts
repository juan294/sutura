import { canonicalJson } from './manifest.js';
import type { EvaluationManifest } from './schema.js';
import { validateEvaluationManifest } from './validate.js';

function exportedTrace(trace: EvaluationManifest['cases'][number]['trace']) {
  return trace.map((event) => ({
    ...event,
    ...(event.type === 'model-request' || event.type === 'model-response'
      ? { requestId: event.requestId === null ? null : '[request-id]' }
      : {}),
  }));
}

export function exportJsonl(value: EvaluationManifest): string {
  const manifest = validateEvaluationManifest(value);
  return manifest.cases.map((item) => canonicalJson({
    schemaVersion: manifest.schemaVersion,
    evaluationId: manifest.evaluationId,
    suturaCommit: manifest.suturaCommit,
    corpusName: manifest.corpusName,
    corpusVersion: manifest.corpusVersion,
    caseId: item.caseId,
    outcome: item.outcome,
    trace: exportedTrace(item.trace),
  })).join('\n') + '\n';
}
