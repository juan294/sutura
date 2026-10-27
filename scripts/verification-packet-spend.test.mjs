import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { reserveVerificationGrant, reconcileVerificationGrant } from './verification-packet-spend.mjs';

const exec = promisify(execFile);
test('one durable incident reservation spans processes and linked worktrees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sutura-grants-'));
  try {
    const repo = join(root, 'repo'), linked = join(root, 'linked');
    await exec('git', ['init', '-q', repo]);
    await exec('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'base']);
    await exec('git', ['-C', repo, 'worktree', 'add', '--detach', linked]);
    const input = { caseDir: repo, packetId: 'approved-one', packetDigest: 'b'.repeat(64), repository: 'example/project', runId: '42', attempt: 1, sourceSha: 'a'.repeat(40), reservationUsd: 2 };
    const outcomes = await Promise.allSettled([reserveVerificationGrant(input), reserveVerificationGrant({ ...input, caseDir: linked })]);
    assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
    await assert.rejects(reserveVerificationGrant(input), /pending|issued|consumed|reconciliation/);
    await assert.rejects(reserveVerificationGrant({ ...input, caseDir: linked, packetId: 'replacement', packetDigest: 'c'.repeat(64) }), /pending|reconciliation/);
    const { stdout } = await exec('git', ['-C', linked, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
    const state = JSON.parse(await readFile(join(stdout.trim(), 'sutura-verification-grants', 'account.json'), 'utf8'));
    assert.equal(state.entries.length, 1);
    assert.equal(state.entries[0].state, 'pending');
    assert.equal(state.entries[0].actualUsd, null);
    const invocation = `import { reserveVerificationGrant } from ${JSON.stringify(new URL('./verification-packet-spend.mjs', import.meta.url).href)}; await reserveVerificationGrant(JSON.parse(process.argv[1]));`;
    await assert.rejects(exec(process.execPath, ['--input-type=module', '-e', invocation, JSON.stringify(input)]));
    await assert.rejects(reserveVerificationGrant({ ...input, runId: '43', packetId: 'approved-one' }), /issued|consumed/);
    await reserveVerificationGrant({ ...input, runId: '43', packetId: 'different-incident', packetDigest: 'd'.repeat(64) });
    const receipt = { source: 'authoritative-provider-billing', complete: true, actualUsd: 1.25, receiptSha256: 'e'.repeat(64), receiptReference: 'https://billing.example.com/receipts/approved-one' };
    const before = await readFile(join(stdout.trim(), 'sutura-verification-grants', 'account.json'), 'utf8');
    for (const invalid of [{ ...receipt, complete: false }, { ...receipt, actualUsd: null }, { ...receipt, actualUsd: 3 }, { ...receipt, receiptSha256: 'unknown' }, { ...receipt, receiptReference: '' }]) {
      await assert.rejects(reconcileVerificationGrant({ ...input, receipt: invalid }));
    }
    assert.equal(await readFile(join(stdout.trim(), 'sutura-verification-grants', 'account.json'), 'utf8'), before);
    await assert.rejects(reconcileVerificationGrant({ ...input, sourceSha: 'f'.repeat(40), receipt }), /identity/);
    await reconcileVerificationGrant({ ...input, receipt });
    await assert.rejects(reconcileVerificationGrant({ ...input, receipt }), /settled|reconciled/);
    await assert.rejects(reserveVerificationGrant(input), /issued|consumed/);
    await reserveVerificationGrant({ ...input, packetId: 'new-approved-attempt', packetDigest: 'f'.repeat(64) });
    const settled = JSON.parse(await readFile(join(stdout.trim(), 'sutura-verification-grants', 'account.json'), 'utf8'));
    assert.deepEqual(settled.entries[0], state.entries[0]);
    assert.equal(settled.settlements.length, 1);
    assert.equal(settled.settlements[0].receipt.actualUsd, 1.25);
  } finally { await rm(root, { recursive: true, force: true }); }
});
