import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('all release-bearing packages and the public API declare 0.3.2', async () => {
  const manifests = await Promise.all([
    'package.json',
    'packages/action/package.json',
    'packages/case-lab/package.json',
    'packages/cli/package.json',
    'packages/core/package.json',
    'packages/evaluation/package.json',
    'packages/placebo/package.json',
  ].map(async (path) => JSON.parse(await text(path))));
  assert.deepEqual(manifests.map(({ version }) => version), Array(7).fill('0.3.2'));
  assert.match(await text('packages/core/src/index.ts'), /VERSION = '0\.3\.2'/u);
});

test('ordinary CI runs deterministic release contract and candidate install checks', async () => {
  const workflow = await text('.github/workflows/ci.yml');
  assert.match(workflow, /pnpm run test:release-contracts/u);
  assert.match(workflow, /pnpm run test:package/u);
});

test('ordinary CI refuses a stale Case Lab before the release contract checks run', async () => {
  const workflow = await text('.github/workflows/ci.yml');
  const gate = workflow.indexOf('release-case-lab.mjs check');
  const contracts = workflow.indexOf('pnpm run test:release-contracts');
  assert.ok(gate >= 0 && contracts > gate);
});

test('pre-push refuses a stale Case Lab after the push-freeze check', async () => {
  const hook = await text('.husky/pre-push');
  const freeze = hook.indexOf('push-freeze.mjs check');
  const gate = hook.indexOf('release-case-lab.mjs check');
  assert.ok(freeze >= 0 && gate > freeze);
});

test('ordinary CI fails a stale Action bundle before the long test suites run', async () => {
  const workflow = await text('.github/workflows/ci.yml');
  const build = workflow.indexOf('pnpm run build');
  const freshness = workflow.indexOf('node scripts/verify-bundle.mjs');
  const tests = workflow.indexOf('pnpm run test\n');
  assert.ok(build >= 0 && freshness > build && tests > freshness);
});

test('ordinary CI verifies every derived product guard after the full test suite', async () => {
  const workflow = await text('.github/workflows/ci.yml');
  const tests = workflow.indexOf('pnpm run test\n');
  const guards = workflow.indexOf('pnpm run guards:verify');
  assert.ok(tests >= 0 && guards > tests);
});

test('the polyglot Sutura repository selects its Node repair runtime explicitly', async () => {
  const policy = JSON.parse(await text('.sutura.json'));
  assert.deepEqual(policy, { version: 1, runtime: 'node' });
});

test('publication validates tag and bundle before publish, then verifies public artifacts', async () => {
  const workflow = await text('.github/workflows/publish.yml');
  assert.match(workflow, /GITHUB_REF_NAME/u);
  assert.match(workflow, /v\$\{version\}/u);
  assert.match(workflow, /git diff --exit-code -- packages\/action\/dist\/index\.cjs/u);
  assert.match(workflow, /test-candidate-install\.mjs/u);
  assert.match(workflow, /origin\/main/u);
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs/u);
  assert.match(workflow, /\.head_branch == \\"main\\" and \.event == \\"push\\"/u);
  assert.match(workflow, /npm publish --access public/u);
  assert.match(workflow, /test-public-install\.mjs --candidate-evidence "\$RUNNER_TEMP\/candidate-install-evidence\.json"/u);
  assert.match(workflow, /packageContentHash/u);
  assert.match(workflow, /upload-artifact/u);
  assert.match(workflow, /id-token: write/u);
});

// v0.3.1 and v0.3.2 both published, then failed verification because npm was
// still processing the provenance-signed package (ETARGET one second later).
test('publication waits for npm to serve the version before verifying it', async () => {
  const workflow = await text('.github/workflows/publish.yml');
  const wait = workflow.indexOf('- name: Wait for npm to serve the published version');
  const verify = workflow.indexOf('- name: Verify public npm and Action artifacts');
  assert.ok(wait > 0 && wait < verify, 'the wait step runs before the public verification');
  assert.match(workflow.slice(wait, verify), /npm view "sutura@\$version" version/u);
  assert.match(workflow.slice(wait, verify), /for attempt in \$\(seq 1 \d+\)/u);
  assert.match(workflow.slice(wait, verify), /exit 1/u);
});

test('publication trusts the exact-head CI check instead of re-running the full local gate', async () => {
  const workflow = await text('.github/workflows/publish.yml');
  assert.doesNotMatch(workflow, /pnpm run typecheck/u);
  assert.doesNotMatch(workflow, /pnpm run lint/u);
  assert.doesNotMatch(workflow, /pnpm run test\n/u);
  assert.doesNotMatch(workflow, /pnpm run test:release-contracts/u);
});

test('release candidate workflow is local-only and requires an exact commit', async () => {
  const workflow = await text('.github/workflows/release-candidate.yml');
  assert.match(workflow, /workflow_dispatch/u);
  assert.match(workflow, /action-sha/u);
  assert.match(workflow, /\^\[a-f0-9\]\{40\}\$/u);
  assert.match(workflow, /test-candidate-install\.mjs/u);
  assert.doesNotMatch(workflow, /npm publish|git push|release create/u);
});

test('Placebo live workflow is manual, read-only, exact, and case-bounded', async () => {
  const workflow = await text('.github/workflows/placebo-live-case.yml');
  assert.match(workflow, /workflow_dispatch/u);
  assert.match(workflow, /timeout-minutes: 30/u);
  assert.match(workflow, /permissions:\n  contents: read/u);
  assert.match(workflow, /ref: \$\{\{ inputs\.controller-sha \}\}/u);
  assert.match(workflow, /ref: \$\{\{ inputs\.subject-sha \}\}/u);
  assert.match(workflow, /test "\$GITHUB_SHA" = "\$CONTROLLER_SHA"/u);
  assert.match(workflow, /test-candidate-install\.mjs "\$SUBJECT_SHA"/u);
  assert.match(workflow, /--install-evidence "\$RUNNER_TEMP\/candidate-install-evidence\.json"/u);
  assert.match(workflow, /--sutura-command "\$GITHUB_WORKSPACE\/subject\/packages\/cli\/dist\/bin\.js" --case "\$CASE_ID"/u);
  assert.match(workflow, /actions\/upload-artifact@v7/u);
  assert.doesNotMatch(workflow, /pull-requests: write|issues: write|id-token: write/u);
});

// The v0.3.1 and v0.3.2 release benchmarks ran without either optional audit
// voice because this step never received their keys.
test('Placebo live workflow passes the optional audit voices their keys', async () => {
  const workflow = await text('.github/workflows/placebo-live-case.yml');
  const step = workflow.slice(workflow.indexOf('- name: Run one live Placebo case'));
  assert.match(step, /OPENAI_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/u);
  assert.match(step, /TYPESAFE_API_KEY: \$\{\{ secrets\.TYPESAFE_API_KEY \}\}/u);
});

test('versioned release evidence requirements name every authorization gate', async () => {
  const requirements = JSON.parse(await text('docs/demo/sutura-v0.3.2-release-evidence-requirements.json'));
  assert.equal(requirements.releaseVersion, '0.3.2');
  assert.deepEqual(requirements.requiredEvidenceIds, [
    'benchmark', 'candidate-matrix', 'demo', 'dogfood', 'devpost', 'feedback',
    'github-release', 'local-gate', 'marketplace', 'npm', 'public-matrix',
  ]);
  assert.deepEqual(requirements.authorizationGates, [
    'provider-contree-canaries', 'live-provider-benchmark', 'candidate-matrix',
    'release-publication', 'public-matrix', 'public-demo-enable', 'devpost-update',
  ]);
  assert.deepEqual(requirements.ownerPhaseByEvidenceId, {
    benchmark: 4,
    'candidate-matrix': 4,
    demo: 1,
    devpost: 7,
    dogfood: 4,
    feedback: 5,
    'github-release': 4,
    'local-gate': 4,
    marketplace: 4,
    npm: 4,
    'public-matrix': 4,
  });
  assert.equal(Object.keys(requirements.ownerPhaseByEvidenceId).length, 11);
});
