import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessSetupReadiness } from './fleet-setup-readiness.mjs';

const metadata = { repositoryId: 42, complete: true,
  secretNames: ['NEBIUS_API_KEY', 'CONTREE_TOKEN'], variableNames: ['CONTREE_PROJECT'] };
const configured = { ...metadata, secretNames: [...metadata.secretNames, 'SUTURA_APP_PRIVATE_KEY'],
  variableNames: [...metadata.variableNames, 'SUTURA_APP_CLIENT_ID'] };
test('missing App metadata is a typed setup incident with exact missing names and remedy', () => {
  const result = assessSetupReadiness(metadata);
  assert.equal(result.state, 'setup-blocked');
  assert.deepEqual(result.missingNames, ['SUTURA_APP_CLIENT_ID', 'SUTURA_APP_PRIVATE_KEY']);
  assert.equal(result.reason, 'app-configuration-missing');
  assert.match(result.nextAction, /repository-scoped App configuration/);
  assert.equal(result.repairReady, false);
});
test('incomplete and malformed metadata cannot establish absence or readiness', () => {
  assert.equal(assessSetupReadiness({ ...metadata, complete: false }).state, 'UNAVAILABLE');
  assert.equal(assessSetupReadiness({ ...metadata, secretNames: 'SUTURA_APP_PRIVATE_KEY' }).reason, 'invalid-configuration-metadata');
  assert.equal(assessSetupReadiness({ ...configured, repositoryId: 0 }).state, 'UNAVAILABLE');
});
test('name presence is configured-unverified, while exact scoped validation proves only access', () => {
  const present = assessSetupReadiness(configured);
  assert.equal(present.state, 'configured-unverified');
  assert.equal(present.repairReady, false);
  const validation = { repositoryId: 42, observedAt: '2026-10-25T08:00:00Z',
    appTokenValidated: true, permissions: { actions: 'read', checks: 'write', contents: 'write', pullRequests: 'write' } };
  const restored = assessSetupReadiness({ ...configured, validation });
  assert.equal(restored.state, 'access-validated');
  assert.equal(restored.repairReady, false);
  assert.equal(restored.preparation, 'unmeasured');
  assert.equal(assessSetupReadiness({ ...configured, validation: { ...validation, repositoryId: 43 } }).state, 'setup-blocked');
  assert.equal(assessSetupReadiness({ ...configured, validation: { ...validation, permissions: { actions: 'read' } } }).state, 'setup-blocked');
});
test('invalid credential/access receipts are actionable without exposing their payload', () => {
  const result = assessSetupReadiness({ ...configured, validation: { repositoryId: 42, appTokenValidated: false, error: 'secret-value' } });
  assert.equal(result.reason, 'app-access-validation-failed');
  assert.match(result.nextAction, /membership and permissions/);
  assert.equal(JSON.stringify(result).includes('secret-value'), false);
  assert.equal(assessSetupReadiness({ ...configured, validation: { repositoryId: 42, appTokenValidated: true } }).state, 'setup-blocked');
});
test('coercible or annotated receipt timestamps cannot establish access or leak free text', () => {
  for (const observedAt of [1, '2026-10-25 (synthetic-sensitive-payload)', '2026-02-30T08:00:00Z']) {
    const result = assessSetupReadiness({ ...configured, validation: { repositoryId: 42,
      appTokenValidated: true, observedAt,
      permissions: { actions: 'read', checks: 'write', contents: 'write', pullRequests: 'write' } } });
    assert.equal(result.state, 'setup-blocked');
    assert.equal(JSON.stringify(result).includes('synthetic-sensitive-payload'), false);
  }
});
