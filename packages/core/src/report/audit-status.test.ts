import { parseAuditCheckMetadata } from './audit-status.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AuditFile, CaseFile } from '../domain.js';
import { renderComment } from './markdown.js';
import { renderCaseFile } from './casefile.js';
import { renderAuditMarkdown } from './audit-markdown.js';
import { renderAuditCaseFile } from './audit-casefile.js';

function files() {
  const file = JSON.parse(readFileSync(new URL('./fixtures/fixed.json', import.meta.url), 'utf8')) as CaseFile;
  file.cost.totalUsd = () => 0;
  const auditFile: AuditFile = {
    assurance: 'reduced', outcome: 'audit-approved',
    diagnosis: { before: file.diagnosis, after: file.diagnosis }, policy: file.policy,
    audit: file.audit!, cost: file.cost,
  };
  return { file, auditFile };
}

describe('typed optional audit status presentation', () => {
  for (const status of ['approved', 'refused', 'uncertain', 'skipped', undefined] as const) {
    it(`renders ${status ?? 'not recorded'} independently of the passing control boolean`, () => {
      const { file, auditFile } = files();
      const check = {
        name: 'typesafe-audit' as const, passed: status !== 'refused',
        evidence: 'legacy free text claims approved: never derive status from it',
        ...(status === undefined ? {} : { metadata: {
          status, requestedModel: 'jev-latest', ...(status === 'skipped' ? {} : { resolvedModel: 'jev-1.14.0' }),
          policyVersion: 'legacy-v1', policyHash: 'a'.repeat(64),
        } }),
      };
      file.audit!.checks = [check];
      const expected = status?.toUpperCase() ?? 'NOT RECORDED';
      for (const render of [() => renderComment(file), () => renderCaseFile(file), () => renderAuditMarkdown(auditFile), () => renderAuditCaseFile(auditFile)]) {
        const output = render();
        expect(output).toContain(expected);
        expect(output).toContain('Optional voice status describes that judgment; repair acceptance still requires all mandatory gates.');
        expect(output).not.toContain('typesafe-audit | PASS');
      }
      expect(check.passed).toBe(status !== 'refused');
      expect(file.audit!.approved).toBe(true);
    });
  }
});

// Removing any named parser guard must make its matching field assertion fail.
describe('public audit metadata parser guards',()=>{
 const valid={status:'approved',requestedModel:'jev-latest',resolvedModel:'jev-1.14.0',policyVersion:'legacy-v1',policyHash:'a'.repeat(64)};
 it('retains only the validated flat metadata contract',()=>{expect(parseAuditCheckMetadata(valid)).toEqual(valid);});
 it.each([
  [null,'metadata must be an object'],
  [{...valid,rawState:'private'},'metadata contains an unsupported field'],
  [{...valid,status:'pass'},'metadata.status'],
  [{...valid,requestedModel:'jev\nsecret'},'metadata.requestedModel'],
  [{...valid,policyHash:'bad'},'metadata.policyHash'],
 ] as const)('rejects malformed metadata %j with a field-specific recovery cause',(value,message)=>{expect(()=>parseAuditCheckMetadata(value)).toThrow(message);});
});
