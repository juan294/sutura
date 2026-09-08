import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initializeManifestSpend, withManifestSpend } from './manifest-spend.mjs';
import { validateRunManifest } from './verified-program-evidence.mjs';
const source = JSON.parse(await readFile(new URL('../docs/demo/run-manifests/development-validation-v1.json', import.meta.url)));
const manifest = validateRunManifest(source);
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'manifest-spend-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { directory, manifest, capUsd: 1, initialReserveUsd: 0.4, caseId: manifest.subjects[0], controllerSha: manifest.identity.candidateCommit, subjectSha: manifest.identity.candidateCommit };
  await initializeManifestSpend(options);
  return options;
}
test('restart with an empty case ledger still counts earlier manifest spending', async (t) => {
  const options = await fixture(t);
  await withManifestSpend(options, async () => ({ artifact: { totalUsd: 0.7, githubRunId: '123' } }));
  await assert.rejects(withManifestSpend(options, () => assert.fail('must not dispatch')), /cap-reserve/);
  await assert.rejects(initializeManifestSpend(options), /EEXIST/);
});
test('unknown cost survives an interrupted dispatch and blocks a restart', async (t) => {
  const options = await fixture(t);
  await assert.rejects(withManifestSpend(options, async () => { throw new Error('download failed'); }), /download failed/);
  await assert.rejects(withManifestSpend(options, () => assert.fail('must not dispatch')), /unsettled/);
});
test('missing spend state fails closed, and changing cap or manifest cannot reset it', async (t) => {
  const options = await fixture(t);
  await assert.rejects(withManifestSpend({ ...options, capUsd: 2 }, () => assert.fail()), /identity or cap/);
  await assert.rejects(withManifestSpend({ ...options, manifest: validateRunManifest({ ...manifest, purpose: 'changed' }) }, () => assert.fail()), /identity or cap/);
  await assert.rejects(withManifestSpend({ ...options, manifest: validateRunManifest({ ...manifest, manifestId: 'missing' }) }, () => assert.fail()), /ENOENT/);
});
test('concurrent controllers cannot spend the same reserve', async (t) => {
  const options = await fixture(t);
  await withManifestSpend(options, async () => {
    await assert.rejects(withManifestSpend(options, () => assert.fail()), /EEXIST/);
    return { artifact: { totalUsd: 0.1, githubRunId: '123' } };
  });
});
test('candidate and subjects are checked before dispatch', async (t) => {
  const options = await fixture(t);
  for (const change of [{ caseId: 'unlisted' }, { controllerSha: 'a'.repeat(40) }]) {
    await assert.rejects(withManifestSpend({ ...options, ...change }, () => assert.fail()), /candidate or subject/);
  }
});
test('invalid or unexpectedly high completion cost cannot restore budget', async (t) => {
  const options = await fixture(t);
  await withManifestSpend(options, async (pending) => {
    assert.match(pending.controllerId, /^pl-/);
    return { artifact: { totalUsd: 1.2, githubRunId: '123' } };
  });
  await assert.rejects(withManifestSpend(options, () => assert.fail()), /cap-reserve/);
});
test('missing completion cost stays unsettled', async (t) => {
  const options = await fixture(t);
  await assert.rejects(withManifestSpend(options, async () => ({ artifact: { githubRunId: '123' } })), /amount/);
  await assert.rejects(withManifestSpend(options, () => assert.fail()), /unsettled/);
});
