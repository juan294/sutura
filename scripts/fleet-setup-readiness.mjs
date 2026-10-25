import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED = { secretNames: ['SUTURA_APP_PRIVATE_KEY'], variableNames: ['SUTURA_APP_CLIENT_ID'] };
const PERMISSIONS = { actions: 'read', checks: 'write', contents: 'write', pullRequests: 'write' };

function receiptTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  const canonical = new Date(time).toISOString();
  return canonical === (value.includes('.') ? value : value.replace('Z', '.000Z')) ? canonical : undefined;
}

/** Names establish configuration presence, never credential validity or repair readiness. */
export function assessSetupReadiness(input) {
  const result = { schemaVersion: 'sutura-setup-readiness-v1', state: 'UNAVAILABLE',
    reason: 'invalid-configuration-metadata', missingNames: [], repairReady: false,
    preparation: 'unmeasured', nextAction: 'Collect complete names-only repository configuration metadata.' };
  if (!input || !Number.isSafeInteger(input.repositoryId) || input.repositoryId <= 0 ||
      !Object.keys(REQUIRED).every(key => Array.isArray(input[key]) &&
        input[key].every(name => typeof name === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(name)))) return result;
  if (input.complete !== true) return { ...result, reason: 'configuration-metadata-incomplete' };
  const missingNames = Object.entries(REQUIRED).flatMap(([kind, names]) => names.filter(name => !input[kind].includes(name))).sort();
  if (missingNames.length) return { ...result, state: 'setup-blocked', reason: 'app-configuration-missing', missingNames,
    nextAction: 'Apply the reviewed repository-scoped App configuration packet, then validate membership and permissions.' };
  const validation = input.validation;
  if (validation === undefined) return { ...result, state: 'configured-unverified', reason: 'app-access-unvalidated',
    nextAction: 'Validate App installation membership and permissions with a scoped token under authorized access.' };
  if (validation?.repositoryId !== input.repositoryId || validation?.appTokenValidated !== true ||
      receiptTimestamp(validation?.observedAt) === undefined ||
      !Object.entries(PERMISSIONS).every(([name, permission]) => validation?.permissions?.[name] === permission)) {
    return { ...result, state: 'setup-blocked', reason: 'app-access-validation-failed',
      nextAction: 'Correct the App configuration, membership and permissions; obtain a new scoped access receipt.' };
  }
  return { ...result, state: 'access-validated', reason: 'scoped-access-receipt', validationObservedAt: receiptTimestamp(validation.observedAt),
    nextAction: 'Verify default-branch activation, then obtain separately authorized preparation and reproduction evidence.' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const path = process.argv[2];
    if (!path || process.argv.length !== 3) throw new Error('metadata-path-required');
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('bounded-metadata-required');
    const result = assessSetupReadiness(JSON.parse(readFileSync(path, 'utf8')));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.state === 'access-validated' ? 0 : result.state === 'UNAVAILABLE' ? 1 : 2;
  } catch {
    process.stderr.write('Unable to assess setup metadata. Supply one bounded names-only JSON file; no credential values.\n');
    process.exitCode = 1;
  }
}
