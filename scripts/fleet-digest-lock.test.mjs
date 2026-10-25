import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withDigestEvaluation } from './fleet-digest-worker.mjs';
test('failed collection still evaluates due digest and preserves original error', async () => {
  let evaluated = false;
  await assert.rejects(withDigestEvaluation(async () => { throw new Error('collection failed'); }, async failed => {
    assert.equal(failed, true); evaluated = true; throw new Error('secondary');
  }), /collection failed/);
  assert.equal(evaluated, true);
});
test('OS lock serializes collectors and releases when the actual writer is killed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-mail-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const args = ['scripts/fleet-digest-lock.py', join(directory, 'writer.lock'), process.execPath, '-e'];
  const first = spawn('python3', [...args, 'process.stdout.write("ready"); setTimeout(() => {}, 10000)']);
  t.after(() => first.kill('SIGKILL'));
  await once(first.stdout, 'data');
  const second = spawn('python3', [...args, 'process.exit(0)']);
  assert.equal((await once(second, 'exit'))[0], 75);
  const exited = once(first, 'exit'); first.kill('SIGKILL'); await exited;
  const third = spawn('python3', [...args, 'process.exit(0)']);
  assert.equal((await once(third, 'exit'))[0], 0);
});
