import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJevManifest, jevManifestHash } from '../packages/evaluation/dist/index.js';
import { parseJevEvaluationArgs, runJevEvaluation } from './jev-decisions-eval.mjs';
const questions = { applicable: { type: 'noul', instructions: 'Does this error identify the supplied category?' }, kind: { type: 'choice', instructions: 'Which supplied category describes this error?', criteria: { match: 'A matching assertion failure', other: 'An unrelated lint failure' } } };
const response = () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ model: 'jev-1.14.0', answers: { applicable: { type: 'noul', noul: .99 }, kind: { type: 'choice', choice: 'match', confidence: .9, probabilities: { match: .9, other: .1 } } }, usage: { input_tokens: 20, output_tokens: 0 } }), text: async () => '' });
async function fixture(fn) {
 const root = await mkdtemp(join(tmpdir(), 'jev-eval-')), cwd = join(root, 'repo');
 try {
  await mkdir(cwd); execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['-c', 'user.name=Jev fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd });
  const controllerSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  const manifest = createJevManifest({ controllerSha, cases: [{ id: 'assertion-example', family: 'assertion-example', role: 'classification', split: 'development', category: 'synthetic', variant: 'positive', questionVersion: 'classification-v1', state: { error: 'AssertionError: expected 1 to be 2' }, questions, candidateIds: ['match', 'other'], baselineIds: ['other', 'match'], labels: { applicable: true, kind: 'match' }, baselineLabels: { applicable: true, kind: 'other' } }] });
  const file = join(root, 'manifest.json'); await writeFile(file, JSON.stringify(manifest));
  const live = ['--manifest', file, '--live', '--max-usd', '.01', '--authorize-data', jevManifestHash(manifest)];
  await fn({ root, cwd, manifest, file, live, deps: { cwd, env: { TYPESAFE_API_KEY: 'fixture-key' } } });
 } finally { await rm(root, { recursive: true, force: true }); }
}
test('argument parser rejects missing authorization and inconsistent reconciliation', () => {
 assert.throws(() => parseJevEvaluationArgs(['--manifest', 'x', '--live']), /authorize-data/);
 assert.throws(() => parseJevEvaluationArgs(['--manifest', 'x', '--unknown']), /Unknown/);
 assert.throws(() => parseJevEvaluationArgs(['--manifest', 'x', '--manifest', 'x']), /duplicate/);
 assert.throws(() => parseJevEvaluationArgs(['--manifest', 'x', '--reconcile', 'a'.repeat(64), '--receipt', 'observation']), /exactly one/);
 assert.throws(() => parseJevEvaluationArgs(['--manifest', 'x', '--quarantine']), /require --reconcile/);
 assert.equal(parseJevEvaluationArgs(['--help']).help, true);
});
test('dry-run validates and discloses exact identity/reservation without network or journal writes', () => fixture(async ({ file, manifest, deps }) => {
 let calls = 0; const result = await runJevEvaluation(['--manifest', file], { ...deps, fetch: async () => { calls++; return response(); } });
 assert.equal(result.status, 'dry-run'); assert.equal(result.manifestHash, jevManifestHash(manifest)); assert.equal(result.maxAttempts, 6); assert.ok(result.reservedUsd > 0); assert.deepEqual(result.categories, ['synthetic']); assert.equal(calls, 0);
 await assert.rejects(stat(`${file}.journal.json`), { code: 'ENOENT' });
}));
test('live path validates authorization, clean exact SHA and configured key before provider work', () => fixture(async ({ cwd, file, live, deps }) => {
 let calls = 0; const fetch = async () => { calls++; return response(); };
 await assert.rejects(runJevEvaluation([...live.slice(0, -1), 'f'.repeat(64)], { ...deps, fetch }), /differs from manifest hash/);
 await writeFile(join(cwd, 'unexpected.txt'), 'uncommitted');
 await assert.rejects(runJevEvaluation(live, { ...deps, fetch }), /clean exact/);
 await rm(join(cwd, 'unexpected.txt'));
 await assert.rejects(runJevEvaluation(live, { ...deps, env: {}, fetch }), /TYPESAFE_API_KEY/);
 const raw = JSON.parse(await readFile(file, 'utf8')); raw.controllerSha = 'f'.repeat(40); await writeFile(file, JSON.stringify(raw));
 await assert.rejects(runJevEvaluation(['--manifest', file, '--live', '--max-usd', '.01', '--authorize-data', jevManifestHash(raw)], { ...deps, fetch }), /clean exact|manifestHash/);
 assert.equal(calls, 0);
}));
test('finite paired run retains all arms and reuses completed exact attempts on disk without resend', () => fixture(async ({ live, file, deps }) => {
 let calls = 0; const fetch = async (_url, options) => { assert.equal(options.headers.Authorization, 'Bearer fixture-key'); calls++; return response(); };
 const first = await runJevEvaluation(live, { ...deps, fetch });
 assert.equal(first.status, 'complete'); assert.equal(first.observations.length, 6); assert.equal(calls, 3); assert.ok(first.spentUsd > 0); assert.equal(first.comparison.scope, 'offline'); assert.equal(first.comparison.status, 'UNMEASURED');
 const second = await runJevEvaluation(live, { ...deps, fetch }); assert.equal(second.status, 'complete'); assert.equal(calls, 3); assert.equal(second.spentUsd, first.spentUsd); assert.deepEqual(second.observations, first.observations);
 const persisted = JSON.parse(await readFile(`${file}.journal.json`, 'utf8')); assert.equal(persisted.entries.length, 3); assert.ok(persisted.entries.every(entry => entry.status === 'settled')); assert.equal((await stat(`${file}.comparison.json`)).mode & 0o777, 0o600);
}));
test('unknown send stays pending, stops job, blocks restart, and explicit quarantine never resends that key', () => fixture(async ({ live, file, deps }) => {
 let calls = 0; const unknown = async () => { calls++; throw new Error('connection lost after send'); };
 const first = await runJevEvaluation(live, { ...deps, fetch: unknown }); assert.equal(first.status, 'pending'); assert.equal(calls, 1); assert.equal(first.observations.length, 2); assert.ok(first.nextAction.includes('--reconcile'));
 const restarted = await runJevEvaluation(live, { ...deps, fetch: unknown }); assert.equal(restarted.status, 'pending'); assert.equal(calls, 1);
 const reconciled = await runJevEvaluation(['--manifest', file, '--reconcile', first.pending[0].id, '--quarantine', '--receipt', 'Retain full unknown reservation'], deps); assert.equal(reconciled.status, 'reconciled'); assert.equal(reconciled.spentUsd, first.spentUsd);
 const next = await runJevEvaluation(live, { ...deps, fetch: async () => { calls++; return response(); } }); assert.equal(next.status, 'complete'); assert.equal(calls, 3); assert.equal(next.observations.find(row => row.arm === 'assist' && row.repetition === 0).evidence.outcome, 'unavailable');
}));
test('explicit HTTP response allows just one separately reserved retry and cap exhaustion makes zero sends', () => fixture(async ({ live, deps }) => {
 let calls = 0;
 const result = await runJevEvaluation(live, { ...deps, fetch: async () => { calls++; return calls === 1 ? { ok: false, status: 429, headers: { get: () => null }, text: async () => 'rate limited' } : response(); } });
 assert.equal(result.status, 'complete'); assert.equal(calls, 4); assert.equal(result.observations.find(row => row.arm === 'assist').evidence.attempts, 2);
}));
test('insufficient explicit cap records every missing answer with no network', () => fixture(async ({ live, deps }) => {
 let calls = 0; const args = live.map(value => value === '.01' ? '.000000001' : value);
 const result = await runJevEvaluation(args, { ...deps, fetch: async () => { calls++; return response(); } });
 assert.equal(result.status, 'complete'); assert.equal(calls, 0); assert.equal(result.observations.length, 6); assert.ok(result.observations.filter(row => row.arm === 'assist').every(row => row.error === 'semantic-cap'));
}));

test('a hung provider reaches its deadline once, preserves pending disk state, and ignores late completion', t => fixture(async ({ live, file, deps }) => {
 t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
 let calls = 0, finish;
 const running = runJevEvaluation(live, { ...deps, fetch: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
 for (let round = 0; calls === 0 && round < 10_000; round++) await new Promise(setImmediate);
 assert.equal(calls, 1);
 t.mock.timers.tick(5_000);
 const result = await running;
 assert.equal(result.status, 'pending'); assert.equal(result.observations.find(row => row.arm === 'assist').evidence.reason, 'timeout');
 finish(response()); await new Promise(setImmediate); await new Promise(setImmediate);
 const persisted = JSON.parse(await readFile(`${file}.journal.json`, 'utf8'));
 assert.equal(persisted.entries.length, 1); assert.equal(persisted.entries[0].status, 'pending'); assert.equal(calls, 1);
}));

test('saved mocked execution remains offline on resume without an injected fetch', () => fixture(async ({ live, deps }) => {
 const first = await runJevEvaluation(live, { ...deps, fetch: async () => response() });
 const originalFetch = globalThis.fetch; let sends = 0;
 globalThis.fetch = async () => { sends++; throw new Error('resume must not send'); };
 try {
  const resumed = await runJevEvaluation(live, { env: deps.env });
  assert.equal(sends, 0); assert.equal(resumed.status, 'complete'); assert.equal(resumed.comparison.scope, 'offline'); assert.equal(resumed.comparison.status, 'UNMEASURED');
  assert.deepEqual(resumed.observations, first.observations);
 } finally { globalThis.fetch = originalFetch; }
}));
test('an alternate controller checkout cannot authorize an actual provider call', () => fixture(async ({ live, deps }) => {
 const originalFetch = globalThis.fetch; let sends = 0;
 globalThis.fetch = async () => { sends++; return response(); };
 try { await assert.rejects(runJevEvaluation(live, deps), /mock transport|script checkout/u); assert.equal(sends, 0); }
 finally { globalThis.fetch = originalFetch; }
}));
test('observations sidecar cannot overwrite a manifest or the reservation journal', () => {
 assert.throws(() => parseJevEvaluationArgs(['--manifest', '/tmp/result.observations.json', '--output', '/tmp/result']), /distinct/u);
 assert.throws(() => parseJevEvaluationArgs(['--manifest', '/tmp/manifest.json', '--output', '/tmp/result', '--journal', '/tmp/result.observations.json']), /distinct/u);
});

test('default source identity binds the executing script checkout rather than process.cwd', () => fixture(async ({ live, cwd, deps }) => {
 const previousCwd = process.cwd(), originalFetch = globalThis.fetch; let sends = 0;
 try {
  process.chdir(cwd);
  globalThis.fetch = async () => { sends++; return response(); };
  await assert.rejects(runJevEvaluation(live, { env: deps.env }), /clean exact/u);
  assert.equal(sends, 0);
 } finally { process.chdir(previousCwd); globalThis.fetch = originalFetch; }
}));

test('a corrupt settled charge is rejected from disk before any provider resend', () => fixture(async ({ live, file, deps }) => {
 let calls = 0;
 const fetch = async () => { calls++; return response(); };
 await runJevEvaluation(live, { ...deps, fetch }); assert.equal(calls, 3);
 const filePath = `${file}.journal.json`, raw = JSON.parse(await readFile(filePath, 'utf8'));
 raw.entries[0].chargedUsd = 0; await writeFile(filePath, JSON.stringify(raw));
 await assert.rejects(runJevEvaluation(live, { ...deps, fetch }), /retained response.*charge/u);
 assert.equal(calls, 3);
}));
