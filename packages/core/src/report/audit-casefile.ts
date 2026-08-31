import type { AuditFile } from '../domain.js';
import { escapeHtml, formatUsd } from './format.js';

export function renderAuditCaseFile(auditFile: AuditFile): string {
  const rows = auditFile.audit.checks.map((check) => `<tr><th>${escapeHtml(check.name)}</th><td>${check.passed ? 'PASS' : 'FAIL'}</td><td>${escapeHtml(check.evidence ?? 'No evidence recorded')}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sutura reduced-assurance audit</title>
<style>body{font:16px/1.5 system-ui;margin:2rem auto;max-width:70rem;padding:0 1rem;color:#17221e}aside{border:3px solid #976812;padding:1rem;background:#fff8e8}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:.6rem;text-align:left}code{overflow-wrap:anywhere}</style></head>
<body><main><h1>Sutura reduced-assurance audit</h1><aside><strong>Reduced assurance</strong><p>This report classifies supplied logs and a supplied diff. Sutura did not execute or verify the patch.</p></aside>
<h2>${escapeHtml(auditFile.outcome)}</h2><p>Before: <code>${escapeHtml(auditFile.diagnosis.before.failingCmd)}</code>. After: <code>${escapeHtml(auditFile.diagnosis.after.failingCmd)}</code>.</p>
<table><thead><tr><th>Audit check</th><th>Result</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>
<p>Inference cost: ${formatUsd(auditFile.cost.totalUsd())}</p><p>Policy: <code>${escapeHtml(auditFile.policy.policySha)}</code></p></main></body></html>`;
}
