import type { IncidentCause, IncidentClassificationInput, IncidentClassificationRecord } from './types.js';

const CAUSES: readonly IncidentCause[] = ['source-defect', 'generated-bundle-stale', 'action-version-mismatch', 'installation',
  'credential-boundary', 'live-probe', 'provider-resource', 'network', 'sutura-internal', 'unknown'];
const DIGEST = /^[a-f0-9]{64}$/u, SHA = /^[a-f0-9]{40}$/u;
const scopeKeys = ['repositoryId', 'workflowId', 'workflowPath', 'jobKey', 'localTreeDigest', 'remoteSourceSha'] as const;

/** Classification is descriptive. Trusted admission, credentials and spend gates remain independent. */
export function classifyIncident(input: IncidentClassificationInput): IncidentClassificationRecord {
  const { assessment, trigger, causeEvidence, protectedPolicy } = input;
  const result: IncidentClassificationRecord = { schemaVersion: 'sutura-incident-classification-v1', trigger: { ...trigger },
    cause: 'unknown', confidence: 'unknown', disposition: 'escalation', outcome: input.outcome ?? 'unmeasured',
    support: assessment.support, reason: 'cause-evidence-unavailable', ownerDomain: 'unknown',
    requiredInput: ['complete-cause-evidence'], nextAction: 'Capture complete selected-step evidence and retain unknown cause until it is supported.', executionAuthorized: false };
  if (trigger.authenticated && causeEvidence?.complete && DIGEST.test(causeEvidence.digest) &&
      CAUSES.includes(causeEvidence.cause) && ['confirmed', 'suspected', 'unknown'].includes(causeEvidence.confidence) &&
      assessment.observation.complete && !assessment.observation.truncated &&
      scopeKeys.every(key => causeEvidence.scope[key] === assessment.scope[key])) {
    result.cause = causeEvidence.cause;
    result.confidence = causeEvidence.confidence;
    result.reason = `evidenced-${causeEvidence.cause}`;
    result.ownerDomain = ['installation', 'credential-boundary'].includes(result.cause) ? 'installation'
      : ['provider-resource', 'network'].includes(result.cause) ? 'provider'
      : result.cause === 'sutura-internal' ? 'sutura' : result.cause === 'unknown' ? 'unknown' : 'repository';
  }
  if (protectedPolicy && (protectedPolicy.schemaVersion !== 'sutura-protected-repair-policy-v1' ||
      !Number.isSafeInteger(protectedPolicy.scope?.repositoryId) || (protectedPolicy.scope.repositoryId ?? 0) <= 0 ||
      !Number.isSafeInteger(protectedPolicy.scope?.workflowId) || (protectedPolicy.scope.workflowId ?? 0) <= 0 ||
      !scopeKeys.every(key => protectedPolicy.scope?.[key] === assessment.scope[key]) ||
      !SHA.test(protectedPolicy.sourceSha) || !DIGEST.test(protectedPolicy.digest))) {
    return { ...result, disposition: 'escalation', reason: 'protected-policy-scope-unavailable',
      requiredInput: ['scoped-protected-policy'], nextAction: 'Capture authenticated protected policy for this repository, workflow, selected job and source scope.' };
  }
  if (protectedPolicy?.repair === 'excluded') {
    return { ...result, disposition: 'intentionally-excluded', reason: 'protected-policy-exclusion',
      requiredInput: ['reviewed-policy-change'], nextAction: 'Retain diagnostic coverage; reassess support before a reviewed reactivation change.' };
  }
  if (result.cause === 'source-defect' && result.confidence === 'confirmed' && assessment.support === 'candidate-supported') {
    return { ...result, disposition: 'repair-supported', requiredInput: ['trusted-admission-and-execution-scope'],
      nextAction: 'Apply independent trust, policy, credential and execution-budget gates before attempting repair.' };
  }
  if (result.cause === 'sutura-internal') {
    return { ...result, disposition: 'escalation', requiredInput: ['sutura-diagnostic-evidence'],
      nextAction: 'Escalate the evidenced Sutura fault with its source and step identity; do not classify it as an environmental skip.' };
  }
  if (assessment.support === 'unsupported' || (result.confidence === 'confirmed' &&
      ['live-probe', 'provider-resource', 'network', 'installation', 'credential-boundary'].includes(result.cause))) {
    return { ...result, disposition: 'observe-only', requiredInput: assessment.requiredInput,
      nextAction: assessment.support === 'unsupported' ? assessment.nextAction : 'Resolve the evidenced setup, probe or resource boundary before a distinct authorized attempt.' };
  }
  return result;
}
