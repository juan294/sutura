import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { digest, renderIncidentQueue, writePrivateAtomic } from './fleet-incident-queue.mjs';

const DAY = 86_400_000;
const HASH = /^[a-f0-9]{64}$/u;
const address = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/u;
const localParts = date => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
function madridMidnight(day) {
  let instant = day;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(instant));
    instant += day - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return new Date(instant).toISOString();
}
export function dueWeek(now) {
  const p = localParts(now);
  const today = Date.UTC(p.year, p.month - 1, p.day);
  const weekday = (new Date(today).getUTCDay() + 6) % 7;
  let monday = today - weekday * DAY;
  if (weekday === 0 && p.hour * 60 + p.minute < 550) monday -= 7 * DAY;
  const start = monday - 7 * DAY;
  return { week: new Date(start).toISOString().slice(0, 10), start: madridMidnight(start), end: madridMidnight(monday) };
}
function validQueue(queue, scopeDigest) {
  return queue?.schemaVersion === 'sutura-incident-queue-v1' && queue.scopeDigest === scopeDigest &&
    Number.isFinite(Date.parse(queue.observedAt)) &&
    [queue.window?.start, queue.window?.end].every(value => typeof value === 'string' && new Date(value).toISOString() === value) && Array.isArray(queue.groups) && queue.groups.length <= 100_000 &&
    Number.isSafeInteger(queue.incidents) && queue.incidents >= 0 && Number.isSafeInteger(queue.verifiedRecoveries) &&
    Number.isFinite(queue.measuredCostUsd) && Number.isSafeInteger(queue.costMeasuredIncidents) &&
    Number.isSafeInteger(queue.windowIncidentCount) && queue.windowIncidentCount >= 0 &&
    Number.isSafeInteger(queue.windowUnknownTimeIncidents) && queue.windowUnknownTimeIncidents >= 0 &&
    (queue.failuresPerDay === null || (Number.isFinite(queue.failuresPerDay) && queue.failuresPerDay >= 0)) &&
    queue.groups.every(group => HASH.test(group.key ?? '') && ['open', 'closed'].includes(group.state) &&
      ['repository', 'installation', 'provider', 'sutura', 'unknown'].includes(group.owner) &&
      Array.isArray(group.members) && group.members.every(member => /^[1-9]\d*:[1-9]\d*:[1-9]\d*$/u.test(member.incidentKey)));
}
async function readJson(path, maximumBytes = 16 * 1024 * 1024) {
  if ((await stat(path)).size > maximumBytes) throw new Error('Private digest state exceeds size limit');
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function readDigestSnapshot(directory, scopeDigest) {
  for (const source of ['current', 'prior']) {
    try {
      const envelope = await readJson(join(directory, `queue-${source}.json`));
      if (envelope.sha256 === digest(envelope.queue) && validQueue(envelope.queue, scopeDigest)) return { queue: envelope.queue, source };
    } catch { /* Preserve corrupt bytes; only a validated generation can be used. */ }
  }
  return { queue: null, source: 'unavailable' };
}
export async function persistDigestSnapshot(directory, queue) {
  if (!validQueue(queue, queue?.scopeDigest)) throw new Error('Invalid digest snapshot');
  const prior = await readDigestSnapshot(directory, queue.scopeDigest);
  if (prior.queue) await writePrivateAtomic(join(directory, 'queue-prior.json'), { queue: prior.queue, sha256: digest(prior.queue) });
  await writePrivateAtomic(join(directory, 'queue-current.json'), { queue, sha256: digest(queue) });
}
function authorized(config, credential) {
  return config?.schemaVersion === 'sutura-digest-config-v1' && config.enabled === true && HASH.test(config.scopeDigest ?? '') &&
    address.test(config.sender ?? '') && address.test(config.recipient ?? '') &&
    /^[A-Z][A-Z0-9_]{0,100}$/u.test(config.credentialEnv ?? '') && typeof credential === 'string' && credential.length > 0 &&
    ['scopeDigest', 'sender', 'recipient', 'credentialEnv'].every(key => config.authorization?.[key] === config[key]);
}
function safeQueue(queue) {
  // Re-render only allowlisted fields. A snapshot never supplies mail headers or raw log/free text.
  const causes = new Set(['source-defect', 'installation', 'credential-boundary', 'provider-resource', 'network',
    'generated-bundle-stale', 'action-version-mismatch', 'live-probe', 'sutura-internal', 'unknown']);
  return { ...queue, groups: queue.groups.slice(0, 20).map(group => ({ ...group,
    cause: causes.has(group.cause) ? group.cause : 'unknown',
    nextAction: 'Review the private queue and exact native evidence before authorizing further action.',
    occurrence: Number.isSafeInteger(group.occurrence) && group.occurrence > 0 ? group.occurrence : 1,
    members: group.members.slice(0, 5).map(member => ({ incidentKey: member.incidentKey,
      sourceRunUrl: typeof member.sourceRunUrl === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/u.test(member.sourceRunUrl) ? member.sourceRunUrl : null,
      proofDigests: Array.isArray(member.proofDigests) ? member.proofDigests.filter(value => HASH.test(value)).slice(0, 3) : [],
    })),
  })) };
}
function renderPayload(config, snapshot, week, now, entries, collectionFailed) {
  const queue = validQueue(snapshot?.queue, config.scopeDigest) ? snapshot.queue : null;
  const age = queue ? now.getTime() - Date.parse(queue.observedAt) : null;
  const stale = age === null || age < 0 || age > 36 * 3_600_000;
  const previous = entries.filter(entry => entry.scopeDigest === config.scopeDigest && entry.recipientHash === digest(config.recipient) && entry.week < week.week).sort((a, b) => a.week.localeCompare(b.week));
  const last = previous.at(-1);
  const missingWeeks = last ? Math.max(0, Math.round((Date.parse(week.week) - Date.parse(last.week)) / (7 * DAY)) - 1) : null;
  const weeklyIncidents = queue?.groups.flatMap(group => group.members).filter(member => Date.parse(member.sourceCompletedAt) >= Date.parse(week.start) && Date.parse(member.sourceCompletedAt) < Date.parse(week.end)).length;
  return { from: config.sender, to: [config.recipient], subject: `Sutura recovery digest: week ${week.week}`,
    text: [
      `Complete ISO week in Europe/Madrid: ${week.start} to ${week.end}.`,
      `Collection: ${collectionFailed ? 'FAILED; ' : ''}${stale ? 'STALE/PARTIAL' : queue?.scan_complete ? 'complete' : 'PARTIAL; scan_complete=false'}. Snapshot: ${queue?.observedAt ?? 'UNAVAILABLE'} (${snapshot?.source ?? 'unavailable'}).`,
      missingWeeks === null ? 'Earlier delivery coverage: unmeasured.' : `Missed intervening weekly digests: ${missingWeeks}. Only the newest due digest is sent.`,
      queue ? `${weeklyIncidents} observed incidents completed in this week. Active queue below covers ${queue.window.start} to ${queue.window.end}.` : 'Coverage UNAVAILABLE; no incident counts can be established.',
      queue ? renderIncidentQueue(safeQueue(queue)) : '',
      queue && (queue.groups.length > 20 || queue.groups.some(group => group.members.length > 5)) ? 'Additional incident detail omitted from email; complete denominators and evidence remain in the private queue.' : '',
      `Earlier unresolved mail receipts: ${previous.filter(entry => !['delivered'].includes(entry.status)).slice(-20).map(entry => `${entry.week}: ${entry.status}`).join(', ') || 'none recorded'}.`,
      'Owner comprehension: unmeasured. Native GitHub notifications are unchanged.',
    ].filter(Boolean).join('\n\n') };
}

/** Caller must hold the OS lock for the complete read/modify/send transaction. */
export async function deliverWeeklyDigest({ directory, config, snapshot, now = new Date(), credential,
  transport, rendererVersion = 'sutura-digest-text-v1', collectionFailed = false }) {
  if (!authorized(config, credential)) return { status: 'blocked', nextAction: 'Review and authorize the exact sender, recipient, scope and protected credential reference.' };
  const path = join(directory, 'outbox.json');
  let outbox;
  try { outbox = await readJson(path); } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Outbox integrity unavailable; preserve bytes and reconcile before sending');
    outbox = { schemaVersion: 'sutura-digest-outbox-v1', entries: [] };
  }
  if (outbox.schemaVersion !== 'sutura-digest-outbox-v1' || !Array.isArray(outbox.entries) || outbox.entries.length > 10_000 ||
      new Set(outbox.entries.map(entry => entry.key)).size !== outbox.entries.length ||
      outbox.entries.some(entry => !HASH.test(entry.key ?? '') || !HASH.test(entry.scopeDigest ?? '') || !HASH.test(entry.recipientHash ?? '') ||
        entry.key !== digest([entry.scopeDigest, entry.recipientHash, entry.week]) || digest(entry.payload) !== entry.contentHash ||
        !Number.isSafeInteger(entry.attempts) || entry.attempts < 0 || entry.attempts > 3 ||
        !Number.isFinite(Date.parse(entry.preparedAt)) || (entry.attempts > 0 && !Number.isFinite(Date.parse(entry.firstSendAt))) ||
        !['prepared', 'sending', 'accepted', 'delivered', 'bounced', 'delivery-unknown'].includes(entry.status))) throw new Error('Outbox integrity failure; no send');
  const week = dueWeek(now), recipientHash = digest(config.recipient);
  const key = digest([config.scopeDigest, recipientHash, week.week]);
  let receipt = outbox.entries.find(entry => entry.key === key);
  const persist = () => {
    if (Buffer.byteLength(JSON.stringify(outbox, null, 2) + '\n') > 16 * 1024 * 1024) throw new Error('Outbox capacity reached; preserve receipts and review archival before further sending');
    return writePrivateAtomic(path, outbox);
  };
  const reconcile = async receipt => {
    try {
      const evidence = await transport.read(receipt.providerId);
      if (evidence.id !== receipt.providerId) throw new Error('Provider identity mismatch');
      receipt.status = evidence.last_event === 'delivered' ? 'delivered' : ['bounced', 'failed'].includes(evidence.last_event) ? 'bounced' : 'accepted';
      receipt.observedAt = now.toISOString();
      receipt.nextAction = receipt.status === 'delivered' ? 'Ask the owner to assess usefulness separately.' : receipt.status === 'bounced' ? 'Review sender/recipient delivery failure; do not resend this week automatically.' : 'Await bounded provider delivery readback; acceptance is not delivery.';
    } catch {
      receipt.observedAt = now.toISOString();
      receipt.nextAction = 'Provider readback unavailable; retain accepted receipt and retry readback on the next collection.';
    }
  };
  const priorPending = outbox.entries.filter(entry => entry.key !== key && entry.scopeDigest === config.scopeDigest &&
    entry.recipientHash === recipientHash && entry.providerId && !['delivered', 'bounced'].includes(entry.status))
    .sort((a, b) => (a.observedAt ?? a.acceptedAt).localeCompare(b.observedAt ?? b.acceptedAt)).slice(0, 2);
  for (const prior of priorPending) await reconcile(prior);
  if (priorPending.length) await persist();
  if (!receipt) {
    const payload = renderPayload(config, snapshot, week, now, outbox.entries, collectionFailed);
    if (Buffer.byteLength(JSON.stringify(payload)) > 32768) throw new Error('Digest content exceeds bounded email size; inspect private queue');
    receipt = { key, scopeDigest: config.scopeDigest, recipientHash, week: week.week, rendererVersion,
      payload, contentHash: digest(payload), status: 'prepared', attempts: 0, preparedAt: now.toISOString(),
      nextAction: 'Send the reviewed frozen digest through the authorized provider.' };
    outbox.entries.push(receipt);
    await persist(); // Freeze before external side effects.
  }
  if (receipt.payload.from !== config.sender || receipt.payload.to?.length !== 1 || receipt.payload.to[0] !== config.recipient) {
    return { ...receipt, nextAction: 'Frozen sender or recipient differs; reconcile this receipt before changing delivery authority.' };
  }
  if (['delivered', 'bounced'].includes(receipt.status)) return receipt;
  if (receipt.providerId) {
    await reconcile(receipt);
    await persist();
    return receipt;
  }
  if (receipt.firstSendAt && (now.getTime() - Date.parse(receipt.firstSendAt) >= DAY || now.getTime() < Date.parse(receipt.firstSendAt) || receipt.attempts >= 3)) {
    receipt.status = 'delivery-unknown';
    receipt.nextAction = 'Idempotency window expired or retry bound reached; reconcile provider evidence, never blindly resend.';
    await persist();
    return receipt;
  }
  receipt.firstSendAt ??= now.toISOString();
  receipt.status = 'sending';
  receipt.attempts++;
  receipt.lastAttemptAt = now.toISOString();
  await persist();
  try {
    const accepted = await transport.send(receipt.payload, receipt.key);
    if (typeof accepted.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(accepted.id)) throw new Error('Invalid provider acceptance');
    receipt.providerId = accepted.id;
    receipt.status = 'accepted';
    receipt.acceptedAt = now.toISOString();
    receipt.nextAction = 'Await provider delivery readback; acceptance is not delivery.';
  } catch {
    receipt.status = 'delivery-unknown';
    receipt.nextAction = 'Reconcile provider acceptance or retry the identical key and body within 24 hours (maximum three attempts).';
  }
  await persist();
  return receipt;
}

export function resendTransport(credential, request = fetch) {
  async function api(path, options = {}) {
    const response = await request(`https://api.resend.com${path}`, { ...options,
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', ...options.headers },
      signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Mail provider status ${response.status}`);
    const reader = response.body.getReader(); let bytes = 0; const chunks = [];
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > 2 * 1024 * 1024) throw new Error('Mail readback exceeds bound');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  return { send: (payload, key) => api('/emails', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload) }),
    read: id => api(`/emails/${encodeURIComponent(id)}`) };
}
