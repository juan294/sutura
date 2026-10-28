import type { AuditCheckMetadata, AuditVerdict } from '../domain.js';

/** Presentation only. Callers must keep using passed/approved for control flow. */
export function auditCheckLabel(check: AuditVerdict['checks'][number]): string {
  if (check.metadata !== undefined) return check.metadata.status.toUpperCase();
  if (check.name === 'typesafe-audit' || check.name === 'second-opinion') return 'NOT RECORDED';
  return check.passed ? 'PASS' : 'FAIL';
}

export function auditVoiceDisclosure(checks: AuditVerdict['checks']): string {
  return checks.some((check) => check.name === 'typesafe-audit' || check.name === 'second-opinion')
    ? 'Optional voice status describes that judgment; repair acceptance still requires all mandatory gates.'
    : '';
}

export function auditCheckEvidence(check: AuditVerdict['checks'][number]): string {
  const evidence = check.evidence ?? 'No evidence recorded';
  const metadata = check.metadata;
  return metadata === undefined ? evidence : `${evidence}; requested model=${metadata.requestedModel}; resolved model=${metadata.resolvedModel ?? 'NOT RECORDED'}; policy=${metadata.policyVersion} sha256=${metadata.policyHash}`;
}

/** Strict serializable presentation projection; no unrecognized fields survive. */
export function parseAuditCheckMetadata(value: unknown): AuditCheckMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('metadata must be an object');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !['status', 'requestedModel', 'resolvedModel', 'policyVersion', 'policyHash'].includes(key))) throw new Error('metadata contains an unsupported field');
  const { status, requestedModel, resolvedModel, policyVersion, policyHash } = raw;
  if (!['approved', 'refused', 'uncertain', 'skipped'].includes(status as string)) throw new Error('metadata.status must be approved, refused, uncertain, or skipped');
  for (const [key, item] of Object.entries({ requestedModel, policyVersion, ...(resolvedModel === undefined ? {} : { resolvedModel }) })) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 256 || /[\r\n]/u.test(item)) throw new Error(`metadata.${key} must be a bounded nonempty single-line string`);
  }
  if (typeof policyHash !== 'string' || !/^[a-f0-9]{64}$/u.test(policyHash)) throw new Error('metadata.policyHash must be an exact lowercase SHA-256');
  return { status: status as AuditCheckMetadata['status'], requestedModel: requestedModel as string, ...(resolvedModel === undefined ? {} : { resolvedModel: resolvedModel as string }), policyVersion: policyVersion as string, policyHash };
}
