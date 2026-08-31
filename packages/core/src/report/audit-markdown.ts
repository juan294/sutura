import type { AuditFile } from '../domain.js';
import { escapeMarkdown, formatUsd } from './format.js';

export function renderAuditMarkdown(auditFile: AuditFile): string {
  const rows = auditFile.audit.checks.map((check) =>
    `| ${escapeMarkdown(check.name)} | ${check.passed ? 'PASS' : 'FAIL'} | ${escapeMarkdown(check.evidence ?? 'No evidence recorded')} |`,
  );
  return [
    '# Sutura reduced-assurance audit',
    '',
    '> Reduced assurance: this report classifies supplied logs and a supplied diff. Sutura did not execute or verify the patch.',
    '',
    `**Outcome:** ${auditFile.outcome}`,
    '',
    `**Before:** ${escapeMarkdown(auditFile.diagnosis.before.class)} via \`${escapeMarkdown(auditFile.diagnosis.before.failingCmd)}\``,
    '',
    `**After:** ${escapeMarkdown(auditFile.diagnosis.after.class)} via \`${escapeMarkdown(auditFile.diagnosis.after.failingCmd)}\``,
    '',
    '| Audit check | Result | Evidence |',
    '| --- | :---: | --- |',
    ...rows,
    '',
    `**Inference cost:** ${formatUsd(auditFile.cost.totalUsd())}`,
    '',
    `**Policy:** ${escapeMarkdown(auditFile.policy.policySha)}`,
    '',
  ].join('\n');
}
