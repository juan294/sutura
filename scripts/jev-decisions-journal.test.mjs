import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openJevJournal, jevAttemptId } from './jev-decisions-journal.mjs';
const retainedResponse = { model: 'jev-1.14.0', answers: { applicable: { type: 'noul', noul: .9 } }, usage: { inTok: 20, outTok: 0, reasoningTok: 0 }, usd: .0002, latencyMs: 100, requestId: null };
const identity = { manifestHash: 'a'.repeat(64), arm: 'assist', caseId: 'sample', repetition: 0, role: 'ranking', questionVersion: 'ranking-v1', policyHash: 'b'.repeat(64), inputHash: 'c'.repeat(64), attempt: 0 };
async function sandbox(fn) { const dir = await mkdtemp(join(tmpdir(), 'jev-journal-')); try { await fn(join(dir, 'journal.json')); } finally { await rm(dir, { recursive: true, force: true }); } }
test('reserves before send, preserves pending restart and reconciles without resetting spent dollars', () => sandbox(async file => {
 let journal = await openJevJournal(file, identity.manifestHash);
 const entry = await journal.reserve(identity, .001, .002);
 assert.equal(entry.id, jevAttemptId(identity));
 assert.equal(journal.spentUsd(), .001);
 await journal.close();
 journal = await openJevJournal(file, identity.manifestHash);
 assert.equal(journal.pending().length, 1);
 await assert.rejects(journal.reserve({ ...identity, attempt: 1 }, .001, .002), /reconcile/);
 await journal.reconcile(entry.id, { quarantine: true, receipt: 'owner quarantine: unknown provider completion' });
 assert.equal(journal.pending().length, 0); assert.equal(journal.spentUsd(), .001);
 await assert.rejects(journal.reserve({ ...identity, attempt: 1 }, .002, .002), /cap/);
 await journal.reserve({ ...identity, attempt: 1 }, .001, .002);
 await journal.settle(jevAttemptId({ ...identity, attempt: 1 }), .0002, retainedResponse);
 assert.ok(Math.abs(journal.spentUsd() - .0012) < 1e-12);
 await assert.rejects(journal.reconcile(entry.id, { observedUsd: 0, receipt: 'cannot erase quarantined prior spend' }), /pending/);
 assert.equal((await stat(file)).mode & 0o777, 0o600);
 await journal.close();
}));
test('interrupted atomic replacement leaves durable reservation and process lock prevents concurrent writers', () => sandbox(async file => {
 let journal = await openJevJournal(file, identity.manifestHash);
 await journal.reserve(identity, .001, .01);
 await assert.rejects(openJevJournal(file, identity.manifestHash), /process lock/);
 await journal.close();
 journal = await openJevJournal(file, identity.manifestHash, { beforeCommit: () => { throw new Error('interrupted disk commit'); } });
 await assert.rejects(journal.settle(jevAttemptId(identity), .0001, { ...retainedResponse, usd: .0001 }), /interrupted disk commit/);
 await journal.close();
 const actual = JSON.parse(await readFile(file, 'utf8'));
 assert.equal(actual.entries[0].status, 'pending');
 journal = await openJevJournal(file, identity.manifestHash);
 await journal.reconcile(jevAttemptId(identity), { observedUsd: .0007, receipt: 'provider statement observation-1' });
 assert.equal(journal.spentUsd(), .0007);
 await journal.close();
 await assert.rejects(openJevJournal(file, 'f'.repeat(64)), /manifestHash/);
}));


test('corrupt retained response cannot lower charged spend on restart', () => sandbox(async file => {
 const journal = await openJevJournal(file, identity.manifestHash);
 const entry = await journal.reserve(identity, .001, .01);
 await journal.settle(entry.id, retainedResponse.usd, retainedResponse);
 await journal.close();
 const raw = JSON.parse(await readFile(file, 'utf8'));
 raw.entries[0].chargedUsd = 0;
 await writeFile(file, JSON.stringify(raw));
 await assert.rejects(openJevJournal(file, identity.manifestHash), /retained response.*charge/u);
 assert.equal(JSON.parse(await readFile(file, 'utf8')).entries[0].chargedUsd, 0);
}));
