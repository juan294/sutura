/** Local cumulative accounting, separate from replaceable result ledgers.
 * An unknown dispatch cost stays pending. Never infer zero from a failed job.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateRunManifest } from './verified-program-evidence.mjs';

function amount(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('Manifest spend amount must be between USD 0 and 100');
  return Math.round(value * 1_000_000);
}

function identity(options) {
  const manifest = validateRunManifest(options.manifest);
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(manifest.manifestId ?? '') || manifest.mode !== 'live') {
    throw new Error('Manifest spend requires a valid live manifest id');
  }
  const cap = amount(options.capUsd);
  if (cap <= 0 || options.capUsd > manifest.caps.inferenceUsd) throw new Error('Manifest spend cap exceeds manifest cap');
  return { manifest, cap, path: join(options.directory, `${manifest.manifestId}.json`) };
}

export async function initializeManifestSpend(options) {
  const { manifest, cap, path } = identity(options);
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  // Exclusive creation: restarting or copying a result ledger cannot reset spend.
  await writeFile(path, JSON.stringify({
    schemaVersion: 'sutura-manifest-spend-v1', manifestHash: manifest.manifestHash,
    cap, entries: [], pending: null,
  }), { flag: 'wx', mode: 0o600 });
  return { manifestId: manifest.manifestId, capUsd: cap / 1_000_000 };
}

async function save(path, state) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function withManifestSpend(options, operation) {
  const { manifest, cap, path } = identity(options);
  if (options.controllerSha !== manifest.identity.candidateCommit ||
      options.subjectSha !== manifest.identity.candidateCommit || !manifest.subjects.includes(options.caseId)) {
    throw new Error('Manifest spend candidate or subject differs from manifest');
  }
  const initialReserve = amount(options.initialReserveUsd);
  if (initialReserve <= 0 || initialReserve > cap) throw new Error('Manifest spend requires a positive reserve within cap');
  const lockPath = `${path}.lock`;
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    const state = JSON.parse(await readFile(path, 'utf8'));
    if (state.schemaVersion !== 'sutura-manifest-spend-v1' || state.manifestHash !== manifest.manifestHash || state.cap !== cap) {
      throw new Error('Manifest spend identity or cap differs from initialized account');
    }
    if (!Array.isArray(state.entries) || state.entries.some((entry) =>
      !Number.isSafeInteger(entry.microUsd) || entry.microUsd < 0 ||
      !manifest.subjects.includes(entry.caseId) || !/^[1-9]\d{0,19}$/u.test(entry.runId ?? '')) ||
      new Set(state.entries.map((entry) => entry.runId)).size !== state.entries.length) {
      throw new Error('Manifest spend entries are invalid');
    }
    if (state.pending !== null) throw new Error('Manifest spend has an unsettled dispatch; reconcile its cost before continuing');
    const spent = state.entries.reduce((sum, entry) => sum + entry.microUsd, 0);
    const reserve = Math.max(initialReserve, ...state.entries.map((entry) => entry.microUsd));
    if (spent + reserve > cap) throw new Error('Manifest spend stopped for cap-reserve');
    state.pending = { caseId: options.caseId, controllerId: `pl-${Date.now()}-${randomUUID().slice(0, 8)}`,
      reserveMicroUsd: reserve, startedAt: new Date().toISOString() };
    await save(path, state);
    const completed = await operation(state.pending);
    const microUsd = amount(completed?.artifact?.totalUsd);
    const runId = completed?.artifact?.githubRunId;
    if (!/^[1-9]\d{0,19}$/u.test(runId ?? '') || state.entries.some((entry) => entry.runId === runId)) {
      throw new Error('Manifest spend completed run id is invalid or duplicate');
    }
    state.entries.push({ caseId: options.caseId, runId, microUsd });
    state.pending = null;
    await save(path, state);
    return completed;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
