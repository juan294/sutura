import {
  MAX_EXPLAIN_FILE_BYTES,
  Ledger,
  TypeSafeClient,
  explainEvidence,
  parseEvidenceCase,
  readBoundedRegularFile,
  validateEvidenceQuery,
  type EvidenceAnswer,
  type EvidenceProjection,
  type NebiusFetch,
} from '@sutura/core';
import type { ExplainArguments } from './args.js';

export interface ExplainFileDependencies {
  env?: NodeJS.ProcessEnv;
  fetch?: NebiusFetch;
  writeError?: (value: string) => void;
}
export const EXPLAIN_SEMANTIC_DISCLOSURE = 'Semantic navigation sends only the redacted query and bounded evidence candidates to TypeSafe using the existing TYPESAFE_API_KEY. No repair, replay or command is executed.\n';
function invalid(request: ExplainArguments, reason: string, nextAction: string): EvidenceAnswer {
  return { schemaVersion: 'sutura-evidence-answer-v1', status: 'invalid-input', mode: request.semantic ? 'semantic' : 'lexical', reason, results: [], nextAction };
}
/** Reads one explicitly chosen file; no repository scan, provider discovery or runtime execution. */
export async function explainFromFile(request: ExplainArguments, dependencies: ExplainFileDependencies = {}): Promise<EvidenceAnswer> {
  let query: string;
  try { query = validateEvidenceQuery(request.query); }
  catch { return invalid(request, 'invalid-query', 'Pass a nonempty query of at most 2 KiB in UTF-8.'); }
  if (request.semantic ? request.maxUsd === undefined || !Number.isFinite(request.maxUsd) || request.maxUsd <= 0 || request.maxUsd > .002 : request.maxUsd !== undefined) {
    return invalid(request, 'invalid-semantic-options', 'Use lexical mode, or select --semantic with an explicit positive --max-usd at most 0.002.');
  }
  let projection: EvidenceProjection;
  try {
    const bytes = await readBoundedRegularFile(request.caseFile, MAX_EXPLAIN_FILE_BYTES);
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    projection = parseEvidenceCase(value);
  } catch { return invalid(request, 'invalid-case-file', 'Pass the actual stable regular JSON file, at most 4 MiB; choose its real path rather than a symlink and correct malformed or unsupported report data.'); }
  if (!request.semantic) return explainEvidence(projection, query);
  (dependencies.writeError ?? (value => process.stderr.write(value)))(EXPLAIN_SEMANTIC_DISCLOSURE);
  const key = (dependencies.env ?? process.env).TYPESAFE_API_KEY;
  const client = key?.trim() ? new TypeSafeClient({ apiKey: key, model: 'jev-1.14.0', ledger: new Ledger({}) }, dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }) : undefined;
  return explainEvidence(projection, query, { semantic: true, maxUsd: request.maxUsd!, ...(client === undefined ? {} : { client }) });
}

export function explainExitCode(answer: EvidenceAnswer): number {
  return answer.status === 'invalid-input' ? 2 : answer.status === 'unavailable' ? 1 : 0;
}
function safeDisplay(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f]/gu, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
    .replace(/[\\`*_[\]{}()#!|]/gu, '\\$&');
}
/** Produces safe plain text or JSON encoding; selected strings never become executable markup. */
export function renderEvidenceAnswer(answer: EvidenceAnswer, json: boolean): string {
  if (json) return JSON.stringify(answer).replace(/[<>&\u007f-\u009f\u2028\u2029]/gu, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const lines = [`Status: ${safeDisplay(answer.status)}; mode: ${safeDisplay(answer.mode)}; reason: ${safeDisplay(answer.reason)}`];
  if (answer.caseIdentity) lines.push(`Case: ${safeDisplay(answer.caseIdentity.repo)} / ${safeDisplay(answer.caseIdentity.runId)}${answer.caseIdentity.controllerSha ? `; controller: ${safeDisplay(answer.caseIdentity.controllerSha)}` : ''}`);
  if (answer.fallback) lines.push(`Fallback: ${safeDisplay(answer.fallback)}; provider assurance remains unavailable.`);
  for (const result of answer.results) {
    // The core's closed JSON-path grammar contains no executable markup. Preserve
    // its literal array indices so this remains an exact field locator in a terminal.
    const locator = /^\$(?:\.[A-Za-z][A-Za-z0-9]*|\[(?:0|[1-9]\d*)\])*$/u.test(result.locator) ? result.locator : safeDisplay(result.locator);
    lines.push('', `Evidence: ${safeDisplay(result.id)}; kind: ${safeDisplay(result.kind)}`, `locator: ${locator}`, safeDisplay(result.excerpt));
    if (result.action) lines.push(`Recorded action: ${safeDisplay(result.action.code)}; ${safeDisplay(result.action.text)}`);
  }
  if (answer.decision) {
    const decision = answer.decision;
    lines.push('', `Provenance: requested model=${safeDisplay(decision.requestedModel)}; resolved model=${safeDisplay(decision.resolvedModel ?? 'NOT RECORDED')}; policy=${safeDisplay(decision.policyVersion)}; policy hash=${safeDisplay(decision.policyHash)}; input hash=${safeDisplay(decision.inputHash)}; outcome=${safeDisplay(decision.outcome)}`);
  }
  lines.push('', `Next action: ${safeDisplay(answer.nextAction)}`);
  return lines.join('\n');
}
