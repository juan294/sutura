import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliverWeeklyDigest, dueWeek, readDigestSnapshot } from './fleet-digest-email.mjs';
import { buildIncidentQueue, digest, writePrivateAtomic } from './fleet-incident-queue.mjs';
const scopeDigest = 'a'.repeat(64);
const config = { schemaVersion: 'sutura-digest-config-v1', enabled: true, scopeDigest,
  sender: 'sutura@example.com', recipient: 'owner@example.com', credentialEnv: 'TEST_MAIL_KEY',
  authorization: { scopeDigest, sender: 'sutura@example.com', recipient: 'owner@example.com', credentialEnv: 'TEST_MAIL_KEY' } };
const now = new Date('2026-10-26T09:00:00.000Z');
const queue = buildIncidentQueue({ incidents: [], observedAt: now.toISOString(), scopeDigest, scanComplete: true,
  window: { start: '2026-10-01T00:00:00.000Z', end: now.toISOString() } });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-digest-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, config, now, snapshot: { queue, source: 'current' }, credential: 'synthetic-key' };
}
test('Madrid Monday threshold and DST define the preceding complete week', () => {
  assert.equal(dueWeek(new Date('2026-10-26T08:09:00Z')).week, '2026-10-12');
  assert.deepEqual(dueWeek(new Date('2026-10-26T08:10:00Z')), {
    week: '2026-10-19', start: '2026-10-18T22:00:00.000Z', end: '2026-10-25T23:00:00.000Z' });
  assert.equal(dueWeek(new Date('2026-07-06T07:10:00Z')).week, '2026-06-29');
});
test('missing or unbound authorization never sends', async t => {
  const input = await fixture(t); let sends = 0;
  const transport = { send: async () => { sends++; return { id: 'fake' }; } };
  assert.equal((await deliverWeeklyDigest({ ...input, config: undefined, transport })).status, 'blocked');
  assert.equal((await deliverWeeklyDigest({ ...input, config: { ...config, recipient: 'else@example.com' }, transport })).status, 'blocked');
  assert.equal(sends, 0);
});
test('freezes payload and key across renderer changes and reconciles delivery without resend', async t => {
  const input = await fixture(t); const sent = [];
  const transport = { send: async (body, key) => { sent.push({ body, key }); return { id: 'mail-1' }; },
    read: async () => ({ id: 'mail-1', last_event: 'delivered' }) };
  const accepted = await deliverWeeklyDigest({ ...input, transport });
  assert.equal(accepted.status, 'accepted');
  const delivered = await deliverWeeklyDigest({ ...input, transport, rendererVersion: 'changed' });
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.contentHash, accepted.contentHash);
  assert.equal(delivered.rendererVersion, accepted.rendererVersion);
  await deliverWeeklyDigest({ ...input, transport });
  assert.equal(sent.length, 1);
  assert.doesNotMatch(await readFile(join(input.directory, 'outbox.json'), 'utf8'), /synthetic-key/);
});
test('lost responses retry the frozen body within 24h, then disclose expired ambiguity', async t => {
  const input = await fixture(t); const sent = [];
  const transport = { send: async (body, key) => { sent.push({ body, key }); throw new Error('opaque provider failure'); } };
  assert.equal((await deliverWeeklyDigest({ ...input, transport })).status, 'delivery-unknown');
  await deliverWeeklyDigest({ ...input, transport, rendererVersion: 'changed', now: new Date(now.getTime() + 1000) });
  assert.deepEqual(sent[0], sent[1]);
  const expired = await deliverWeeklyDigest({ ...input, transport, now: new Date(now.getTime() + 86_400_001) });
  assert.equal(sent.length, 2);
  assert.equal(expired.status, 'delivery-unknown');
  assert.match(expired.nextAction, /expired/);
});
test('accepted-then-crash state preserves identity; bounced and read failures never resend', async t => {
  const input = await fixture(t); let sends = 0;
  const transport = { send: async () => { sends++; return { id: 'mail-2' }; }, read: async () => ({ id: 'mail-2', last_event: 'bounced' }) };
  await deliverWeeklyDigest({ ...input, transport });
  assert.equal((await deliverWeeklyDigest({ ...input, transport })).status, 'bounced');
  await deliverWeeklyDigest({ ...input, transport });
  assert.equal(sends, 1);
});
test('validated prior snapshot survives corrupt current; unavailable and stale coverage are explicit', async t => {
  const input = await fixture(t);
  await writePrivateAtomic(join(input.directory, 'queue-prior.json'), { queue, sha256: digest(queue) });
  await writePrivateAtomic(join(input.directory, 'queue-current.json'), { queue, sha256: 'bad' });
  assert.equal((await readDigestSnapshot(input.directory, scopeDigest)).source, 'prior');
  let body;
  const transport = { send: async value => { body = value; return { id: 'mail-3' }; } };
  await deliverWeeklyDigest({ ...input, snapshot: { queue: null, source: 'unavailable' }, transport });
  assert.match(body.text, /UNAVAILABLE/);
  assert.doesNotMatch(body.text, /0 exact incidents/);
});
test('offline catch-up sends only latest week and discloses earlier unresolved delivery', async t => {
  const input = await fixture(t); const bodies = [];
  const transport = { send: async body => { bodies.push(body); return { id: `mail-${bodies.length}` }; } };
  await deliverWeeklyDigest({ ...input, transport });
  await deliverWeeklyDigest({ ...input, transport, now: new Date('2026-11-16T09:00:00Z') });
  assert.equal(bodies.length, 2);
  assert.match(bodies[1].text, /Missed intervening weekly digests: 2/);
  assert.match(bodies[1].text, /2026-10-19: accepted/);
  assert.match(bodies[1].text, /STALE\/PARTIAL/);
});
test('a new explicitly authorized recipient has separate identity; unreviewed change remains blocked', async t => {
  const input = await fixture(t); const keys = [];
  const transport = { send: async (_body, key) => { keys.push(key); return { id: 'mail' }; } };
  await deliverWeeklyDigest({ ...input, transport });
  const changed = { ...config, recipient: 'new@example.com', authorization: { ...config.authorization, recipient: 'new@example.com' } };
  await deliverWeeklyDigest({ ...input, config: changed, transport });
  assert.equal(keys.length, 2); assert.notEqual(keys[0], keys[1]);
});
test('corrupt retry metadata cannot bypass outbox integrity', async t => {
  const input = await fixture(t); let sends = 0;
  const transport = { send: async () => { sends++; throw new Error('lost'); } };
  await deliverWeeklyDigest({ ...input, transport });
  const path = join(input.directory, 'outbox.json');
  const state = JSON.parse(await readFile(path, 'utf8'));
  state.entries[0].attempts = -100;
  await writePrivateAtomic(path, state);
  await assert.rejects(deliverWeeklyDigest({ ...input, transport }), /integrity/);
  assert.equal(sends, 1);
});
test('prepared payload and ambiguous sending state survive restart without renderer changes', async t => {
  const input = await fixture(t); const sent = [];
  const transport = { send: async (body, key) => { sent.push({ body, key }); throw new Error('lost after acceptance'); } };
  await deliverWeeklyDigest({ ...input, transport });
  const path = join(input.directory, 'outbox.json');
  const state = JSON.parse(await readFile(path, 'utf8'));
  state.entries[0].status = 'sending';
  await writePrivateAtomic(path, state);
  await deliverWeeklyDigest({ ...input, transport, rendererVersion: 'v-next' });
  assert.deepEqual(sent[0], sent[1]);
});
test('next-week collection reconciles older acceptance without resending it', async t => {
  const input = await fixture(t); let sends = 0;
  const transport = { send: async () => ({ id: `mail-${++sends}` }), read: async id => ({ id, last_event: 'delivered' }) };
  await deliverWeeklyDigest({ ...input, transport });
  await deliverWeeklyDigest({ ...input, transport, now: new Date('2026-11-02T09:00:00Z') });
  const state = JSON.parse(await readFile(join(input.directory, 'outbox.json'), 'utf8'));
  assert.equal(state.entries[0].status, 'delivered');
  assert.equal(sends, 2);
});
test('large queues keep full denominators but bound email detail and frozen payload', async t => {
  const input = await fixture(t); let body;
  const large = { ...queue, incidents: 10000, groups: Array.from({ length: 100 }, (_, index) => ({ key: digest(index), state: 'open', owner: 'repository', cause: 'source-defect', occurrence: 1,
    members: Array.from({ length: 100 }, (_, n) => ({ incidentKey: `1:${index * 100 + n + 1}:1`, sourceCompletedAt: '2026-10-20T12:00:00.000Z', proofDigests: [] })) })) };
  await deliverWeeklyDigest({ ...input, snapshot: { queue: large, source: 'current' }, transport: { send: async value => { body = value; return { id: 'large-mail' }; } } });
  assert.ok(Buffer.byteLength(JSON.stringify(body)) <= 32768);
  assert.match(body.text, /10000 exact incidents/);
  assert.match(body.text, /detail omitted/);
});

test('outbox capacity measures the exact pretty-printed bytes before any write or send', async t => {
  const input = await fixture(t); const maximum = 16 * 1024 * 1024;
  const recipientHash = digest(config.recipient);
  const entries = Array.from({ length: 600 }, (_, index) => {
    const week = new Date(now.getTime() - (index + 2) * 7 * 86_400_000).toISOString().slice(0, 10);
    const payload = { from: config.sender, to: [config.recipient], text: '' };
    return { key: digest([scopeDigest, recipientHash, week]), scopeDigest, recipientHash, week,
      payload, contentHash: digest(payload), status: 'delivered', attempts: 0, preparedAt: now.toISOString() };
  });
  const state = { schemaVersion: 'sutura-digest-outbox-v1', entries };
  const bodyLength = Math.floor((maximum - 30_000 - Buffer.byteLength(JSON.stringify(state))) / entries.length);
  for (const entry of entries) {
    entry.payload.text = 'x'.repeat(bodyLength);
    entry.contentHash = digest(entry.payload);
  }
  const compact = JSON.stringify(state);
  assert.ok(Buffer.byteLength(compact) < maximum - 2048);
  assert.ok(Buffer.byteLength(JSON.stringify(state, null, 2) + '\n') > maximum);
  const path = join(input.directory, 'outbox.json');
  await writeFile(path, compact, { mode: 0o600 });
  let sends = 0;
  await assert.rejects(deliverWeeklyDigest({ ...input, transport: {
    send: async () => { sends++; return { id: 'must-not-send' }; },
  } }), /Outbox capacity/);
  assert.equal(sends, 0);
  assert.equal(await readFile(path, 'utf8'), compact);
});
test('malformed queue rate fields fall back to the valid prior snapshot', async t => {
  const input = await fixture(t);
  await writePrivateAtomic(join(input.directory, 'queue-prior.json'), { queue, sha256: digest(queue) });
  for (const malformed of [
    { windowIncidentCount: undefined }, { windowIncidentCount: -1 },
    { windowUnknownTimeIncidents: undefined }, { windowUnknownTimeIncidents: -1 },
    { failuresPerDay: undefined }, { failuresPerDay: -1 }, { failuresPerDay: 'unknown' },
  ]) {
    const invalid = { ...queue, ...malformed };
    await writePrivateAtomic(join(input.directory, 'queue-current.json'), { queue: invalid, sha256: digest(invalid) });
    assert.equal((await readDigestSnapshot(input.directory, scopeDigest)).source, 'prior');
  }
  const unknown = { ...queue, failuresPerDay: null };
  await writePrivateAtomic(join(input.directory, 'queue-current.json'), { queue: unknown, sha256: digest(unknown) });
  assert.equal((await readDigestSnapshot(input.directory, scopeDigest)).source, 'current');
});
