import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import { validateCodeqlReferences } from './codeql-coherence.mjs';

const workflow = (refs) => ({jobs: {scan: {steps: refs.map(([action, ref]) => ({uses: `github/codeql-action/${action}@${ref}`}))}}});
test('all CodeQL components move together under the actual Dependabot group', () => {
  const config = parse(readFileSync(new URL('../.github/dependabot.yml', import.meta.url), 'utf8'));
  const entry = config.updates.find(e => e['package-ecosystem'] === 'github-actions');
  const names = ['github/codeql-action', 'github/codeql-action/init', 'github/codeql-action/analyze', 'github/codeql-action/upload-sarif'];
  const groupFor = name => Object.entries(entry.groups ?? {}).find(([, group]) =>
    (group['applies-to'] ?? 'version-updates') === 'version-updates' &&
    group.patterns.some(p => new RegExp(`^${p.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(name)))?.[0];
  assert.ok(groupFor(names[0]), 'CodeQL has no update group');
  const selected = entry.groups[groupFor(names[0])];
  assert.equal(selected['exclude-patterns'], undefined, 'CodeQL group must include all components');
  assert.equal(selected['update-types'], undefined, 'CodeQL group must cover every version update');
  for (const name of names) assert.equal(groupFor(name), groupFor(names[0]));
  const original = workflow(['init','analyze','upload-sarif'].map(a => [a, 'a'.repeat(40)]));
  const updated = structuredClone(original);
  for (const step of updated.jobs.scan.steps) {
    const name = step.uses.split('@')[0];
    if (groupFor(name) === groupFor(names[0])) step.uses = `${name}@${'b'.repeat(40)}`;
  }
  assert.deepEqual(validateCodeqlReferences(updated), []);
  assert.ok(updated.jobs.scan.steps.every(s => s.uses.endsWith('b'.repeat(40))));
  updated.jobs.scan.steps[0].uses = `github/codeql-action/init@${'a'.repeat(40)}`;
  assert.match(validateCodeqlReferences(updated)[0], /inconsistent/);
});
test('validator catches mismatched versions and accepts aligned steps in each job', () => {
  assert.equal(validateCodeqlReferences(workflow([['init','v4'],['analyze','v3']])).length, 1);
  assert.deepEqual(validateCodeqlReferences(workflow([['init','v4'],['analyze','v4']])), []);
  const installed = parse(readFileSync(new URL('../.github/workflows/codeql.yml', import.meta.url), 'utf8'));
  assert.deepEqual(validateCodeqlReferences(installed), []);
});
