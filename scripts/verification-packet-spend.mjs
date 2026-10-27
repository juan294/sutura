import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { acquireProcessLock } from './live-process-lock.mjs';
const exec = promisify(execFile);
const HASH = /^[a-f0-9]{64}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
function valid(entry) {
  return entry && ID.test(entry.packetId) && HASH.test(entry.packetDigest) && /^[\w.-]+\/[\w.-]+$/u.test(entry.repository) &&
    /^[1-9]\d*$/u.test(entry.runId) && Number.isSafeInteger(entry.attempt) && entry.attempt > 0 && SHA.test(entry.sourceSha) &&
    Number.isFinite(entry.reservationUsd) && entry.reservationUsd > 0 && entry.reservationUsd <= 100 &&
    entry.state === 'pending' && entry.actualUsd === null && typeof entry.issuedAt === 'string' && Number.isFinite(Date.parse(entry.issuedAt));
}
const BINDING = ['packetId', 'packetDigest', 'repository', 'runId', 'attempt', 'sourceSha'];
function validReceipt(receipt, reservationUsd) {
  if (!receipt || Object.keys(receipt).some(key => !['source', 'complete', 'actualUsd', 'receiptSha256', 'receiptReference'].includes(key)) || receipt.source !== 'authoritative-provider-billing' || receipt.complete !== true || !Number.isFinite(receipt.actualUsd) || receipt.actualUsd < 0 || receipt.actualUsd > reservationUsd || !HASH.test(receipt.receiptSha256) || typeof receipt.receiptReference !== 'string' || receipt.receiptReference.length > 512) return false;
  try {
    const ref = new URL(receipt.receiptReference);
    return ref.protocol === 'https:' && !ref.username && !ref.password && !ref.search && !ref.hash && Boolean(ref.hostname);
  } catch { return false; }
}
async function readAccount(path) {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 'sutura-verification-grants-v1', entries: [], settlements: [] }; throw error; }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 2_097_152 || (stat.mode & 0o077) !== 0) throw new Error('Verification grant account is not a bounded private file; reconciliation required');
    const bytes = Buffer.alloc(stat.size + 1), result = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat();
    if (result.bytesRead !== stat.size || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw new Error('Verification grant account changed; reconciliation required');
    const state = JSON.parse(bytes.subarray(0, stat.size).toString('utf8'));
    if (state?.schemaVersion !== 'sutura-verification-grants-v1' || !Array.isArray(state.entries) || state.entries.length > 1000 || state.entries.some(entry => !valid(entry)) || new Set(state.entries.map(entry => entry.packetId)).size !== state.entries.length || new Set(state.entries.map(entry => entry.packetDigest)).size !== state.entries.length) throw new Error('Verification grant account is corrupt; reconciliation required');
    state.settlements ??= [];
    if (!Array.isArray(state.settlements) || state.settlements.length > state.entries.length || new Set(state.settlements.map(item => item.packetDigest)).size !== state.settlements.length || state.settlements.some(item => {
      const original = state.entries.find(entry => BINDING.every(key => entry[key] === item[key]));
      return !original || !validReceipt(item.receipt, original.reservationUsd) || typeof item.reconciledAt !== 'string' || !Number.isFinite(Date.parse(item.reconciledAt));
    })) throw new Error('Verification grant settlements are corrupt; reconciliation required');
    return state;
  } finally { await handle.close(); }
}
async function accountLocation(caseDir) {
  const common = (await exec('git', ['-C', caseDir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeout: 15_000, maxBuffer: 16_384 })).stdout.trim();
  const directory = join(common, 'sutura-verification-grants');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || (directoryStat.mode & 0o077) !== 0) throw new Error('Verification grant directory must be private and regular');
  return { directory, path: join(directory, 'account.json') };
}
async function save(path, directory, state) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path);
    const dir = await open(directory, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  } finally { await rm(temporary, { force: true }); }
}
/** Durable one-attempt reservation. Unknown charges remain pending; there is no reset/remint API. */
export async function reserveVerificationGrant(input) {
  const entry = { packetId: input.packetId, packetDigest: input.packetDigest, repository: input.repository, runId: input.runId, attempt: input.attempt, sourceSha: input.sourceSha, reservationUsd: input.reservationUsd, state: 'pending', actualUsd: null, issuedAt: new Date().toISOString() };
  if (!valid(entry)) throw new Error('Verification grant binding or reservation is invalid');
  const { directory, path } = await accountLocation(input.caseDir), release = await acquireProcessLock(`${path}.lock`);
  try {
    const state = await readAccount(path);
    if (state.entries.some(item => item.packetId === entry.packetId || item.packetDigest === entry.packetDigest)) throw new Error('Verification packet was already issued/consumed; reconcile existing evidence');
    if (state.entries.some(item => item.repository === entry.repository && item.runId === entry.runId && item.attempt === entry.attempt && !state.settlements.some(settled => settled.packetDigest === item.packetDigest))) throw new Error('Incident has an unresolved pending verification grant; reconciliation required');
    if (state.entries.length >= 1000) throw new Error('Verification grant account bound reached; reconciliation required');
    state.entries.push(entry);
    await save(path, directory, state);
  } finally { await release(); }
}

/** Explicit reconciliation only, after the caller obtains authoritative complete billing evidence.
 * Appends proof; never edits the original reservation, remints its packet or infers unknown USD.
 */
export async function reconcileVerificationGrant(input) {
  const { directory, path } = await accountLocation(input.caseDir), release = await acquireProcessLock(`${path}.lock`);
  try {
    const state = await readAccount(path);
    const original = state.entries.find(entry => BINDING.every(key => entry[key] === input[key]));
    if (!original || original.reservationUsd !== input.reservationUsd) throw new Error('Reconciliation identity differs from the exact pending reservation');
    if (state.settlements.some(item => item.packetDigest === original.packetDigest)) throw new Error('Verification packet is already reconciled/settled');
    if (!validReceipt(input.receipt, original.reservationUsd)) throw new Error('Authoritative complete billing receipt and actual USD within reservation are required; unknown charges remain pending');
    state.settlements.push({ ...Object.fromEntries(BINDING.map(key => [key, original[key]])), receipt: structuredClone(input.receipt), reconciledAt: new Date().toISOString() });
    await save(path, directory, state);
  } finally { await release(); }
}
