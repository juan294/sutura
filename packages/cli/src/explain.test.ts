import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { EvidenceAnswer, NebiusFetch, TypeSafeAnswer, TypeSafeQuestion } from '@sutura/core';
import type { ExplainArguments } from './args.js';
import { explainFromFile, explainExitCode, renderEvidenceAnswer } from './explain.js';

function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('test fixture must be a record'); return value as Record<string, unknown>; }
async function fixture(run: (path: string, data: Record<string, unknown>, directory: string) => Promise<void>) {
 const directory = await mkdtemp(join(tmpdir(), 'sutura-explain-'));
 try {
  const data = record(JSON.parse(await readFile(new URL('../../core/src/report/fixtures/fixed.json', import.meta.url), 'utf8')));
  const path = join(directory, 'case.json'); await writeFile(path, JSON.stringify(data));
  await run(path, data, directory);
 } finally { await rm(directory, { recursive: true, force: true }); }
}
const request = (caseFile: string, extras: Partial<ExplainArguments> = {}): ExplainArguments => ({ command: 'explain', caseFile, query: 'Cannot find module', semantic: false, json: false, ...extras });
function semanticFetch(change?: (answers: Record<string, TypeSafeAnswer>) => void) {
 return vi.fn(async (_url: string, init: Parameters<NebiusFetch>[1]) => {
  const body = JSON.parse(init!.body as string) as { questions: Record<string, TypeSafeQuestion> };
  const answers: Record<string, TypeSafeAnswer> = {}, picked = new Set<string>();
  for (const [id, question] of Object.entries(body.questions)) {
   if (question.type === 'noul') answers[id] = { type: 'noul', noul: .99 };
   else {
    const ids = Object.keys(question.criteria), selected = ids.find(key => key !== 'none' && !picked.has(key)) ?? 'none'; picked.add(selected);
    answers[id] = { type: 'choice', choice: selected, confidence: .99, probabilities: Object.fromEntries(ids.map(key => [key, key === selected ? .99 : .01 / (ids.length - 1)])) };
   }
  }
  change?.(answers);
  return new Response(JSON.stringify({ model: 'jev-1.14.0', answers, usage: { input_tokens: 100, output_tokens: 0 } }));
 });
}

describe('local evidence navigation', () => {
 it('reads legacy case JSON with lexical evidence and never reads keys or calls HTTP', () => fixture(async path => {
  const fetch = vi.fn(async () => { throw new Error('lexical mode must not fetch'); });
  const env = { get TYPESAFE_API_KEY(): string { throw new Error('lexical mode must not read credentials'); } };
  const answer = await explainFromFile(request(path), { env, fetch });
  expect(answer.status).toBe('matched'); expect(answer.mode).toBe('lexical'); expect(answer.results.length).toBeGreaterThan(0); expect(answer.results.length).toBeLessThanOrEqual(3);
  expect(answer.results.some(result => result.kind === 'diagnosis')).toBe(true); expect(fetch).not.toHaveBeenCalled();
 }));
 it('keeps field locators and evidence IDs stable across JSON formatting and returns no match for an unrelated query', () => fixture(async (path, data) => {
  const first = await explainFromFile(request(path));
  await writeFile(path, JSON.stringify(data, null, 2));
  const second = await explainFromFile(request(path));
  expect(second.results.map(({ id, locator }) => ({ id, locator }))).toEqual(first.results.map(({ id, locator }) => ({ id, locator })));
  expect(first.results.some(result => result.locator.includes('diagnosis'))).toBe(true);
  const none = await explainFromFile(request(path, { query: 'interstellar marshmallow quantum agriculture' }));
  expect(none.status).toBe('no-match'); expect(none.results).toEqual([]); expect(explainExitCode(none)).toBe(0);
 }));
 it('accepts an explicitly supported Case Lab envelope without importing its runtime', () => fixture(async (path, data) => {
  await writeFile(path, JSON.stringify({ schemaVersion: 'sutura-case-lab-result-v1', identity: { controllerSha: 'a'.repeat(40) }, caseFile: data }));
  const answer = await explainFromFile(request(path));
  expect(answer.status).toBe('matched'); expect(answer.caseIdentity?.controllerSha).toBe('a'.repeat(40)); expect(answer.results.some(result => result.locator.includes('caseFile'))).toBe(true);
 }));
 it.each(['malformed-json', 'unsupported-schema', 'wrong-numeric-types', 'oversized', 'symlink', 'directory'] as const)('rejects %s with a fixed correction before accessing keys or HTTP', kind => fixture(async (path, data, directory) => {
  let input = path;
  if (kind === 'malformed-json') await writeFile(path, '{broken');
  if (kind === 'unsupported-schema') await writeFile(path, JSON.stringify({ schemaVersion: 'unknown', caseFile: data }));
  if (kind === 'wrong-numeric-types') { record(data.diagnosis).confidence = '0.9'; await writeFile(path, JSON.stringify(data)); }
  if (kind === 'oversized') await writeFile(path, 'x'.repeat(4 * 1024 * 1024 + 1));
  if (kind === 'symlink') { input = join(directory, 'link.json'); await symlink(path, input); }
  if (kind === 'directory') { input = join(directory, 'nested'); await mkdir(input); }
  const fetch = vi.fn(async () => { throw new Error('invalid mode must not fetch'); }); let keysRead = 0;
  const answer = await explainFromFile(request(input, { semantic: true, maxUsd: .002 }), { fetch, env: { get TYPESAFE_API_KEY() { keysRead++; return 'test-key'; } } });
  expect(answer.status).toBe('invalid-input'); expect(explainExitCode(answer)).toBe(2); expect(answer.nextAction).toContain('actual stable regular JSON file'); expect(fetch).not.toHaveBeenCalled(); expect(keysRead).toBe(0);
 }));
 it('rejects a query over two KiB before reading credentials or constructing a client', () => fixture(async path => {
  const fetch = vi.fn(async () => { throw new Error('invalid query must not fetch'); });
  const answer = await explainFromFile(request(path, { query: 'é'.repeat(1025), semantic: true, maxUsd: .002 }), { fetch, env: { get TYPESAFE_API_KEY(): string { throw new Error('invalid query must not read credentials'); } } });
  expect(answer.status).toBe('invalid-input'); expect(fetch).not.toHaveBeenCalled();
 }));
 it('discloses semantic transmission on stderr, uses only the existing key, and recovers after an outage', () => fixture(async path => {
  const errors: string[] = [], failure = vi.fn(async () => { throw new Error('network unavailable'); });
  const failed = await explainFromFile(request(path, { semantic: true, maxUsd: .002 }), { env: { TYPESAFE_API_KEY: 'existing-key' }, fetch: failure, writeError: line => errors.push(line) });
  expect(failed.status).toBe('unavailable'); expect(failed.fallback).toBe('lexical'); expect(failed.results.length).toBeGreaterThan(0); expect(explainExitCode(failed)).toBe(1); expect(failure).toHaveBeenCalledOnce();
  expect(errors.join('')).toContain('redacted query'); expect(errors.join('')).toContain('bounded evidence'); expect(errors.join('')).not.toContain('existing-key');
  const fetch = semanticFetch();
  const recovered = await explainFromFile(request(path, { semantic: true, maxUsd: .002 }), { env: { TYPESAFE_API_KEY: 'existing-key' }, fetch, writeError: () => {} });
  expect(recovered.status).toBe('matched'); expect(recovered.mode).toBe('semantic'); expect(explainExitCode(recovered)).toBe(0); expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).model).toBe('jev-1.14.0');
 }));
 it('retains lexical fallback when semantic mode lacks a key, with zero HTTP', () => fixture(async path => {
  const fetch = semanticFetch(); const answer = await explainFromFile(request(path, { semantic: true, maxUsd: .001 }), { env: {}, fetch, writeError: () => {} });
  expect(answer.status).toBe('unavailable'); expect(answer.fallback).toBe('lexical'); expect(answer.results.length).toBeGreaterThan(0); expect(fetch).not.toHaveBeenCalled();
 }));
 it('redacts credentials and escapes injected HTML/Markdown/control redirection without executing case action text', () => fixture(async (path, data, directory) => {
  const marker = join(directory, 'must-not-exist');
  record(data.diagnosis).errorExcerpt = `Cannot find module <script>run()</script> [execute](javascript:alert(1))\u001b[31m > ${marker}\nAuthorization: Bearer private-case-token`;
  data.nextAction = `touch ${marker}`; data.actions = [{ command: `touch ${marker}` }];
  await writeFile(path, JSON.stringify(data));
  const answer = await explainFromFile(request(path));
  expect(answer.status).toBe('matched'); expect(JSON.stringify(answer)).not.toContain('private-case-token');
  const text = renderEvidenceAnswer(answer, false), json = renderEvidenceAnswer(answer, true);
  expect(text).not.toContain('<script>'); expect(text).not.toContain('\u001b'); expect(text).not.toContain('[execute](javascript:');
  expect(text).toContain('locator:'); expect(text).toContain('mode: lexical'); expect(text).not.toContain(`Next action: touch ${marker}`);
  expect(json).not.toContain('<script>'); expect(JSON.parse(json)).toEqual(answer);
  await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
 }));
});

it('formats every result status with the literal exit mapping and available provenance', () => {
 for (const [status, code] of [['matched', 0], ['no-match', 0], ['unavailable', 1], ['invalid-input', 2]] as const) {
  const answer: EvidenceAnswer = { schemaVersion: 'sutura-evidence-answer-v1', status, mode: 'lexical', reason: 'fixture', results: [], nextAction: 'Choose a valid local report.' };
  expect(explainExitCode(answer)).toBe(code); expect(renderEvidenceAnswer(answer, false)).toContain(`Status: ${status}`);
 }
});

it('encodes output markup and control bytes while keeping JSON locators and provenance reviewable', () => {
 const answer: EvidenceAnswer = { schemaVersion: 'sutura-evidence-answer-v1', status: 'unavailable', mode: 'semantic', reason: 'provider-unavailable', fallback: 'lexical', nextAction: 'Choose the recorded evidence.', results: [{ id: 'evidence-fixture', locator: '$.audit.checks[0]', kind: 'diagnosis', excerpt: '<script>run()</script> [execute](javascript:alert(1))\u001b[31m > file', action: { code: 'inspect-only', text: '<img src=x onerror=run()>' } }], decision: { role: 'navigator', mode: 'assist', outcome: 'unavailable', policyVersion: 'semantic-v1', policyHash: 'a'.repeat(64), inputHash: 'b'.repeat(64), requestedModel: 'jev-1.14.0', usage: null, attempts: 1, reservedUsd: .0001, actualUsd: 0, latencyMs: 5000, reason: 'timeout', fallback: 'lexical', candidateIds: ['evidence-fixture'], baseline: ['evidence-fixture'] } };
 const text = renderEvidenceAnswer(answer, false), json = renderEvidenceAnswer(answer, true);
 expect(text).toContain('locator: $.audit.checks[0]'); expect(text).toContain('requested model=jev-1.14.0'); expect(text).toContain('resolved model=NOT RECORDED'); expect(text).toContain('Fallback: lexical');
 expect(text).not.toContain('<script>'); expect(text).not.toContain('<img'); expect(text).not.toContain('\u001b'); expect(text).not.toContain('[execute](javascript:');
 expect(json).not.toContain('<'); expect(json).not.toContain('\u001b'); expect(JSON.parse(json)).toEqual(answer);
});

it('accepts a valid JSON file exactly at the four MiB byte ceiling', () => fixture(async (path, data) => {
 const raw = JSON.stringify(data), padding = 4 * 1024 * 1024 - Buffer.byteLength(raw, 'utf8');
 await writeFile(path, raw + ' '.repeat(padding));
 const answer = await explainFromFile(request(path)); expect(answer.status).toBe('matched');
}));

it('sends redacted query and evidence without transmitting raw report or query credentials', () => fixture(async (path, data) => {
 record(data.diagnosis).errorExcerpt = 'Cannot find module\nAuthorization: Bearer private-source-token';
 await writeFile(path, JSON.stringify(data));
 const fetch = semanticFetch();
 const answer = await explainFromFile(request(path, { query: 'Cannot find module Authorization: Bearer private-query-token', semantic: true, maxUsd: .002 }), { env: { TYPESAFE_API_KEY: 'existing-key' }, fetch, writeError: () => {} });
 expect(answer.status).toBe('matched'); expect(fetch).toHaveBeenCalledOnce();
 const sent = fetch.mock.calls[0]![1]!.body as string;
 expect(sent).not.toContain('private-source-token'); expect(sent).not.toContain('private-query-token'); expect(JSON.stringify(answer)).not.toContain('private-source-token');
}));


it.each(['extra', 'missing', 'foreign'] as const)('returns labeled lexical fallback for %s semantic evidence IDs', kind => fixture(async path => {
 const baseline = await explainFromFile(request(path));
 const fetch = semanticFetch(answers => {
  if (kind === 'extra') answers.second = structuredClone(answers.first!);
  if (kind === 'missing') delete answers.first;
  if (kind === 'foreign') { const first = answers.first; if (first?.type === 'choice') first.choice = 'foreign-evidence-id'; }
 });
 const answer = await explainFromFile(request(path, { semantic: true, maxUsd: .002 }), { env: { TYPESAFE_API_KEY: 'existing-key' }, fetch, writeError: () => {} });
 expect(answer.status).toBe('unavailable'); expect(answer.fallback).toBe('lexical'); expect(answer.results).toEqual(baseline.results); expect(fetch).toHaveBeenCalledOnce(); expect(answer.results.some(result => result.id === 'foreign-evidence-id')).toBe(false);
}));

it.each(['runId', 'repo'] as const)('rejects credential-shaped %s before key access or network', field => fixture(async (path, data) => {
 const token = 'ghp_abcdefgh12345678';
 data[field] = field === 'repo' ? `${token}/widget` : token;
 await writeFile(path, JSON.stringify(data));
 let keysRead = 0;
 const fetch = vi.fn(async () => { throw new Error('Identity validation must precede network'); });
 const answer = await explainFromFile(request(path, { semantic: true, maxUsd: .002 }), {
  env: { get TYPESAFE_API_KEY() { keysRead++; return 'existing-key'; } }, fetch, writeError: () => {},
 });
 expect(answer.status).toBe('invalid-input'); expect(explainExitCode(answer)).toBe(2);
 expect(keysRead).toBe(0); expect(fetch).not.toHaveBeenCalled();
 expect(renderEvidenceAnswer(answer, false)).not.toContain(token); expect(renderEvidenceAnswer(answer, true)).not.toContain(token);
}));
