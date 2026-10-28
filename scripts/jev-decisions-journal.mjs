import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { acquireProcessLock } from './live-process-lock.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const IDENTITY_KEYS = ['manifestHash', 'arm', 'caseId', 'repetition', 'role', 'questionVersion', 'policyHash', 'inputHash', 'attempt'];
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function validResponse(value, chargedUsd) {
  if (!record(value) || Object.keys(value).some(key => !['model', 'answers', 'usage', 'usd', 'latencyMs', 'requestId'].includes(key)) || typeof value.model !== 'string' || !value.model.length || value.model.length > 256 || !amount(value.usd) || value.usd !== chargedUsd || !amount(value.latencyMs) || !(value.requestId === null || typeof value.requestId === 'string' && value.requestId.length <= 256)) return false;
  if (!record(value.usage) || ![value.usage.inTok, value.usage.outTok, value.usage.reasoningTok].every(number => Number.isSafeInteger(number) && number >= 0) || value.usage.reasoningTok !== 0) return false;
  if (!record(value.answers) || Object.keys(value.answers).length < 1 || Object.keys(value.answers).length > 256) return false;
  const probability = number => amount(number) && number <= 1;
  return Object.entries(value.answers).every(([id, answer]) => {
    if (!id.length || id.length > 200 || !record(answer)) return false;
    if (answer.type === 'noul') return Object.keys(answer).every(key => ['type', 'noul'].includes(key)) && probability(answer.noul);
    if (answer.type !== 'choice' || Object.keys(answer).some(key => !['type', 'choice', 'confidence', 'probabilities'].includes(key)) || typeof answer.choice !== 'string' || !probability(answer.confidence) || !record(answer.probabilities) || !Object.hasOwn(answer.probabilities, answer.choice)) return false;
    const probabilities = Object.values(answer.probabilities);
    return probabilities.length > 0 && probabilities.length <= 255 && probabilities.every(probability) && Math.abs(probabilities.reduce((sum, number) => sum + number, 0) - 1) <= 1e-6 && answer.probabilities[answer.choice] === Math.max(...probabilities);
  });
}
function validateIdentity(value) {
  if (!record(value) || Object.keys(value).length !== IDENTITY_KEYS.length || IDENTITY_KEYS.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid Jev attempt identity');
  if (![value.manifestHash, value.policyHash, value.inputHash].every(hash => typeof hash === 'string' && HASH.test(hash)) || !['off', 'assist'].includes(value.arm) || !['ranking', 'grounding', 'classification', 'recovery', 'navigator', 'audit-v2'].includes(value.role)) throw new Error('Invalid Jev attempt identity hash/arm/role');
  if (!['caseId', 'questionVersion'].every(key => typeof value[key] === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value[key])) || !Number.isInteger(value.repetition) || value.repetition < 0 || value.repetition > 2 || !Number.isInteger(value.attempt) || value.attempt < 0 || value.attempt > 1) throw new Error('Invalid Jev attempt identity case/repetition/attempt');
}
export function jevAttemptId(identity) {
  validateIdentity(identity);
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(IDENTITY_KEYS.map(key => [key, identity[key]])))).digest('hex');
}
function validateJournal(value, manifestHash) {
  if (!record(value) || value.schemaVersion !== 'sutura-jev-journal-v1' || value.manifestHash !== manifestHash || !Array.isArray(value.entries) || value.entries.length > 8192) throw new Error('Jev journal manifestHash/schema is invalid; preserve and reconcile the existing journal');
  const ids = new Set();
  for (const entry of value.entries) {
    if (!record(entry) || !record(entry.identity) || entry.identity.manifestHash !== manifestHash || entry.id !== jevAttemptId(entry.identity) || ids.has(entry.id) || !['pending', 'settled', 'quarantined'].includes(entry.status) || !amount(entry.reservedUsd) || entry.reservedUsd <= 0 || entry.status === 'settled' && !amount(entry.chargedUsd) || entry.status === 'quarantined' && entry.chargedUsd !== entry.reservedUsd) throw new Error('Jev journal attempt is invalid; preserve and reconcile the existing journal');
    ids.add(entry.id);
    if (entry.response !== undefined && (entry.status !== 'settled' || !validResponse(entry.response, entry.chargedUsd))) throw new Error('Jev journal retained response schema or charge differs; preserve the journal and reconcile observed usage before any resend');
    for (const key of ['execution', 'observationProvenance']) if (entry[key] !== undefined && (!record(entry[key]) || typeof entry[key].live !== 'boolean' || typeof entry[key].contractProbe !== 'boolean')) throw new Error('Jev journal execution provenance is invalid; preserve the original offline/live classification');
  }
  return value;
}
/** Atomic private sidecars: fsync bytes before rename and directory after rename. */
export async function writeJevSidecar(file, value, { beforeCommit } = {}) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync(); await handle.close(); handle = undefined;
    await beforeCommit?.(temp, file);
    await rename(temp, file);
    const dir = await open(dirname(file), 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  } finally { await handle?.close(); await rm(temp, { force: true }); }
}
export async function openJevJournal(file, manifestHash, options = {}) {
  if (!HASH.test(manifestHash)) throw new Error('Invalid Jev journal manifestHash');
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const release = await acquireProcessLock(`${file}.lock`);
  try {
    let state;
    try {
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stats = await handle.stat();
        if (!stats.isFile() || stats.size > 8 * 1024 * 1024) throw new Error('Jev journal must be a regular file under 8 MiB');
        state = validateJournal(JSON.parse(await handle.readFile('utf8')), manifestHash);
      } finally { await handle.close(); }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { schemaVersion: 'sutura-jev-journal-v1', manifestHash, entries: [] };
    }
    let closed = false;
    const commit = async next => { if (closed) throw new Error('Jev journal is closed'); validateJournal(next, manifestHash); await writeJevSidecar(file, next, options); state = next; };
    const entry = id => state.entries.find(item => item.id === id);
    const pending = () => state.entries.filter(item => item.status === 'pending');
    const spentUsd = () => state.entries.reduce((sum, item) => sum + (item.status === 'pending' ? item.reservedUsd : item.chargedUsd), 0);
    const change = async (id, changes) => {
      const previous = entry(id); if (!previous || previous.status !== 'pending') throw new Error('Only an existing pending Jev attempt can be settled or reconciled');
      await commit({ ...state, entries: state.entries.map(item => item.id === id ? { ...item, ...changes } : item) });
      return structuredClone(entry(id));
    };
    return {
      entries: () => structuredClone(state.entries), pending: () => structuredClone(pending()), spentUsd,
      lookup: identity => structuredClone(entry(jevAttemptId(identity))),
      async reserve(identity, reservedUsd, maxUsd, execution = { live: false, contractProbe: false }) {
        validateIdentity(identity); if (identity.manifestHash !== manifestHash) throw new Error('Jev attempt manifestHash mismatch');
        const existing = entry(jevAttemptId(identity)); if (existing) return structuredClone(existing);
        if (pending().length) throw new Error(`Pending Jev spend requires reconciliation; run --reconcile ${pending()[0].id} with --observed-usd and --receipt, or --quarantine and --receipt`);
        if (!amount(reservedUsd) || reservedUsd <= 0 || !amount(maxUsd) || maxUsd <= 0 || spentUsd() + reservedUsd > maxUsd + 1e-12) throw new Error('Jev cumulative cap exhausted; reconcile prior spend or supply a separately authorized larger cap');
        const value = { id: jevAttemptId(identity), identity, status: 'pending', reservedUsd, execution };
        await commit({ ...state, entries: [...state.entries, value] }); return structuredClone(value);
      },
      settle: (id, chargedUsd, response, execution) => {
        if (!amount(chargedUsd)) throw new Error('Observed Jev usage must be finite and nonnegative');
        return change(id, { status: 'settled', chargedUsd, ...(response === undefined ? {} : { response }), ...(execution === undefined ? {} : { execution }) });
      },
      async recordEvidence(id, evidence, observationProvenance = { live: false, contractProbe: false }) {
        const previous = entry(id);
        if (!previous || previous.status === 'pending' || !record(evidence)) throw new Error('Only a completed Jev attempt can retain decision evidence');
        await commit({ ...state, entries: state.entries.map(item => item.id === id ? { ...item, evidence, observationProvenance } : item) });
      },
      quarantine: (id, receipt, responseError) => {
        if (typeof receipt !== 'string' || !receipt.trim() || receipt.length > 2048) throw new Error('Quarantine requires a bounded nonempty receipt');
        const previous = entry(id); return change(id, { status: 'quarantined', chargedUsd: previous?.reservedUsd, receipt, ...(responseError === undefined ? {} : { responseError }) });
      },
      async reconcile(id, input) {
        if (!record(input) || typeof input.receipt !== 'string' || !input.receipt.trim() || input.receipt.length > 2048 || input.quarantine === true && input.observedUsd !== undefined) throw new Error('Reconcile requires either observed dollars or quarantine, with a nonempty receipt');
        if (input.quarantine === true) return this.quarantine(id, input.receipt);
        if (!amount(input.observedUsd)) throw new Error('Reconcile observed dollars must be finite and nonnegative');
        return change(id, { status: 'settled', chargedUsd: input.observedUsd, receipt: input.receipt });
      },
      async close() { if (!closed) { closed = true; await release(); } },
    };
  } catch (error) { await release(); throw error; }
}
