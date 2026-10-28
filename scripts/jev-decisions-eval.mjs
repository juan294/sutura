#!/usr/bin/env node
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as evaluation from '../packages/evaluation/dist/index.js';
import { DecisionSession, semanticConfig, TypeSafeClient, TypeSafeApiError, Ledger } from '../packages/core/dist/index.js';
import { openJevJournal, writeJevSidecar } from './jev-decisions-journal.mjs';
const execute = promisify(execFile);
const HASH = /^[a-f0-9]{64}$/u;
const SCRIPT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const HELP = 'node scripts/jev-decisions-eval.mjs --manifest <file> [--output <comparison.json>] [--journal <private.json>] [--live --max-usd <positive> --authorize-data <manifest-sha256>]\nReconcile: --manifest <file> --journal <file> --reconcile <attempt-id> (--observed-usd <amount> | --quarantine) --receipt <documented observation>\nDefault dry-run makes no provider calls. Live sends only manifest-authorized redacted state/questions to TypeSafe using TYPESAFE_API_KEY; the Jev cap does not cap generation or sandbox spend.';
function money(value, positive = false) {
  const parsed = Number(value);
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(parsed) || parsed < 0 || positive && parsed <= 0) throw new Error(`Expected ${positive ? 'positive' : 'nonnegative'} finite dollars`);
  return parsed;
}
export function parseJevEvaluationArgs(argv) {
  const values = {}, seen = new Set();
  const booleans = new Set(['--live', '--quarantine', '--help']);
  const allowed = new Set([...booleans, '--manifest', '--max-usd', '--authorize-data', '--output', '--journal', '--reconcile', '--observed-usd', '--receipt']);
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (!allowed.has(flag) || seen.has(flag)) throw new Error(`Unknown or duplicate Jev evaluation argument: ${flag}`);
    seen.add(flag);
    if (booleans.has(flag)) { values[flag] = true; continue; }
    const value = argv[++index]; if (typeof value !== 'string' || !value.length || value.startsWith('--') || value.length > 4096) throw new Error(`${flag} requires a bounded value`);
    values[flag] = value;
  }
  if (values['--help']) return { help: true };
  if (!values['--manifest']) throw new Error('--manifest is required');
  const options = { manifest: resolve(values['--manifest']), live: values['--live'] === true, output: resolve(values['--output'] ?? `${values['--manifest']}.comparison.json`), journal: resolve(values['--journal'] ?? `${values['--manifest']}.journal.json`) };
  if (new Set([options.manifest, options.output, options.journal, `${options.output}.observations.json`]).size !== 4) throw new Error('Manifest, output, observations and journal paths must be distinct');
  if (values['--max-usd'] !== undefined) options.maxUsd = money(values['--max-usd'], true);
  if (values['--authorize-data'] !== undefined) { if (!HASH.test(values['--authorize-data'])) throw new Error('--authorize-data must be an exact manifest SHA-256'); options.authorizeData = values['--authorize-data']; }
  if (values['--reconcile']) {
    if (!HASH.test(values['--reconcile']) || options.live || values['--authorize-data'] || values['--max-usd']) throw new Error('Reconciliation is local only and requires an exact attempt ID');
    if (!values['--receipt'] || (values['--observed-usd'] === undefined) === (values['--quarantine'] !== true)) throw new Error('Reconcile requires --receipt and exactly one of --observed-usd or --quarantine');
    options.reconcile = values['--reconcile']; options.receipt = values['--receipt'];
    if (values['--quarantine']) options.quarantine = true;
    else options.observedUsd = money(values['--observed-usd']);
  } else if (values['--receipt'] || values['--quarantine'] || values['--observed-usd']) throw new Error('Receipt/observed dollars/quarantine require --reconcile');
  if (options.live && (!(options.maxUsd > 0) || !options.authorizeData)) throw new Error('--live requires positive --max-usd and --authorize-data matching the manifest hash');
  return options;
}
async function boundedManifest(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const before = await handle.stat(); if (!before.isFile() || before.size > 16 * 1024 * 1024) throw new Error('Manifest must be a stable regular JSON file under 16 MiB'); const data = await handle.readFile('utf8'); const after = await handle.stat(); if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Manifest changed while reading; pass a stable frozen file'); return JSON.parse(data); } finally { await handle.close(); }
}
async function exactController(cwd, sha) {
  const head = (await execute('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' })).stdout.trim();
  const status = (await execute('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd, encoding: 'utf8' })).stdout;
  if (head !== sha || status.trim()) throw new Error('Jev evaluation requires a clean exact manifest controller SHA; commit/preserve intended work and regenerate the manifest before provider work');
}
function pendingResult(journal, manifest, observations, manifestHash) {
  const entry = journal.pending()[0];
  return { status: 'pending', manifestHash, spentUsd: journal.spentUsd(), pending: journal.pending(), observations, comparison: evaluation.compareJevDecisions(manifest, observations), nextAction: `Reconcile unknown spend before any resend: --reconcile ${entry.id} --observed-usd <documented charge> --receipt <observation>, or --quarantine --receipt <reason>. Prior spend remains charged.` };
}
/** A finite sequential evaluator. Only fetch and the clock are replaceable provider boundaries. */
export async function runJevEvaluation(argv, dependencies = {}) {
  const options = parseJevEvaluationArgs(argv); if (options.help) return { status: 'help', help: HELP };
  const manifest = evaluation.validateJevManifest(await boundedManifest(options.manifest));
  const manifestHash = evaluation.jevManifestHash(manifest);
  const plan = { status: 'dry-run', manifestHash, controllerSha: manifest.controllerSha, model: manifest.model, categories: [...new Set(manifest.cases.map(item => item.category))], cases: manifest.cases.map(item => ({ id: item.id, inputHash: item.inputHash, policyHash: item.policyHash, role: item.role, split: item.split })), repetitions: manifest.repetitions, maxAttempts: manifest.maxAttempts * manifest.repetitions * manifest.cases.length, reservedUsd: manifest.cases.reduce((sum, item) => sum + evaluation.jevAttemptReservation(item) * manifest.maxAttempts * manifest.repetitions, 0), output: options.output, observationsPath: `${options.output}.observations.json`, journal: options.journal, dataBoundary: 'Live sends only frozen redacted state/questions to TypeSafe; no repair or sandbox is executed.' };
  if (!options.live && !options.reconcile) return plan;
  if (options.live && options.authorizeData !== manifestHash) throw new Error('--authorize-data differs from manifest hash; inspect the dry-run and authorize the exact frozen manifest');
  const journal = await openJevJournal(options.journal, manifestHash, dependencies.journalBoundary);
  try {
    if (options.reconcile) { const entry = await journal.reconcile(options.reconcile, { receipt: options.receipt, ...(options.quarantine ? { quarantine: true } : { observedUsd: options.observedUsd }) }); return { status: 'reconciled', manifestHash, entry, spentUsd: journal.spentUsd(), nextAction: 'Reconciliation preserves spend. Run a new explicitly authorized evaluation invocation; quarantined or observed attempts are never resent.' }; }
    const observations = [];
    if (journal.pending().length) return pendingResult(journal, manifest, observations, manifestHash);
    const allDecisionsSaved = manifest.cases.every(item => Array.from({ length: manifest.repetitions }, (_, repetition) => repetition).every(repetition => journal.entries().some(entry => entry.identity.caseId === item.id && entry.identity.repetition === repetition && entry.evidence !== undefined)));
    if (!allDecisionsSaved) {
      if (dependencies.cwd !== undefined && dependencies.fetch === undefined) throw new Error('An alternate script checkout is test-only and requires a mock transport before any new provider work');
      await exactController(dependencies.cwd ?? SCRIPT_ROOT, manifest.controllerSha);
    }
    const key = (dependencies.env ?? process.env).TYPESAFE_API_KEY;
    if (!key?.trim()) throw new Error('TYPESAFE_API_KEY is required for an explicitly authorized live evaluation');
    const now = dependencies.now ?? Date.now;
    const freshLive = dependencies.fetch === undefined && dependencies.cwd === undefined;
    const provider = new TypeSafeClient({ apiKey: key, ledger: new Ledger({}), model: manifest.model }, { ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }), ...(dependencies.now === undefined ? {} : { now }) });
    let stopped = false;
    for (let repetition = 0; repetition < manifest.repetitions && !stopped; repetition++) {
      for (const item of manifest.cases) {
        for (const arm of repetition % 2 === 0 ? manifest.arms : [...manifest.arms].reverse()) {
          const itemEntries = () => journal.entries().filter(entry => entry.identity.arm === 'assist' && entry.identity.caseId === item.id && entry.identity.repetition === repetition);
          const saved = itemEntries().find(entry => entry.evidence !== undefined);
          const originalProvenance = saved?.observationProvenance ?? { live: false, contractProbe: false };
          const base = { manifestHash, arm: arm.id, caseId: item.id, repetition, live: saved ? originalProvenance.live : freshLive, contractProbe: false };
          if (arm.id === 'off') { observations.push({ ...base, ...(item.baselineLabels === undefined ? { error: 'baseline-labels-unavailable' } : { baselineLabels: item.baselineLabels }) }); continue; }
          if (saved) { observations.push({ ...base, evidence: saved.evidence, ...originalProvenance, ...(saved.evidence.outcome === 'unavailable' ? { error: saved.evidence.reason } : {}) }); continue; }
          let attempt = 0;
          let finalEntryId;
          const client = { modelId: () => provider.modelId(), decide: async (state, questions, request) => {
            if (request?.singleAttempt !== true) throw new Error('Evaluator transport requires singleAttempt=true');
            const identity = { manifestHash, arm: arm.id, caseId: item.id, repetition, role: item.role, questionVersion: item.questionVersion, policyHash: item.policyHash, inputHash: item.inputHash, attempt: attempt++ };
            const reservation = evaluation.jevAttemptReservation(item);
            const existing = journal.lookup(identity);
            if (existing) {
              if (existing.status === 'settled' && existing.response) return existing.response;
              if (existing.responseError) throw new TypeSafeApiError('Recorded explicit provider response', existing.responseError.status, 'Recorded response; no resend');
              throw new Error('Attempt was reconciled without a reusable provider response; retain unavailable result and never resend');
            }
            const entry = await journal.reserve(identity, reservation, options.maxUsd, { live: freshLive, contractProbe: false });
            finalEntryId = entry.id;
            try {
              const response = await provider.decide(state, questions, request);
              if (request.signal?.aborted) throw new Error('Unknown completion after deadline; retain pending reservation');
              await journal.settle(entry.id, response.usd, response, { live: freshLive, contractProbe: freshLive && response.model === manifest.model }); return response;
            } catch (error) {
              if (!request.signal?.aborted && error instanceof TypeSafeApiError && error.status !== undefined) await journal.quarantine(entry.id, `Explicit HTTP ${error.status}; full reservation retained conservatively`, { status: error.status });
              throw error;
            }
          } };
          const session = new DecisionSession({ config: semanticConfig({ maxUsd: Math.min(options.maxUsd, item.role === 'navigator' ? .002 : .02), modes: { ranking: 'assist', grounding: 'assist', classification: 'assist', recovery: 'assist' } }, true), client, deadline: now() + 5000, now });
          const evidence = await session.judge(item.role, item.state, item.questions, 'baseline-retained', item.candidateIds, item.baselineIds);
          const provenance = { live: itemEntries().length > 0 && itemEntries().every(entry => entry.execution?.live === true), contractProbe: false };
          provenance.contractProbe = provenance.live && evidence.resolvedModel === manifest.model && evidence.answers !== undefined;
          if (!journal.pending().length && finalEntryId !== undefined) await journal.recordEvidence(finalEntryId, evidence, provenance);
          observations.push({ ...base, evidence, ...provenance, ...(evidence.outcome === 'unavailable' ? { error: evidence.reason } : {}) });
          if (journal.pending().length) { stopped = true; break; }
        }
        if (stopped) break;
      }
    }
    const result = stopped ? pendingResult(journal, manifest, observations, manifestHash) : { status: 'complete', manifestHash, spentUsd: journal.spentUsd(), observations, comparison: evaluation.compareJevDecisions(manifest, observations), nextAction: 'Review qualification and missing results. No role is automatically enabled.' };
    await writeJevSidecar(plan.observationsPath, { schemaVersion: 'sutura-jev-observations-v1', manifestHash, observations, legacyInputs: manifest.cases.filter(item => item.legacyDecision !== undefined).map(item => ({ caseId: item.id, ...item.legacyDecision, provenance: 'frozen-input-observation-not-a-fresh-legacy-measurement' })) });
    await writeJevSidecar(options.output, result);
    return result;
  } finally { await journal.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await runJevEvaluation(process.argv.slice(2)); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (result.status === 'pending') process.exitCode = 1; }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; }
}
