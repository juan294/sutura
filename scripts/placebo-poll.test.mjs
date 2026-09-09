import assert from 'node:assert/strict';
import test from 'node:test';
import { pollRun } from './placebo-live.mjs';
const sha = 'a'.repeat(40);
const completed = { displayTitle: 'Placebo live controller case', headSha: sha, status: 'completed', conclusion: 'success', databaseId: 42 };
function harness(responses) {
  let calls = 0;
  let elapsed = 0;
  return {
    get calls() { return calls; },
    command: async (name, args) => {
      assert.equal(name, 'gh');
      assert.deepEqual(args.slice(0, 2), ['run', 'list']);
      const response = typeof responses === 'function' ? responses(calls++) : responses[calls++];
      if (response instanceof Error) throw response;
      return response;
    },
    now: () => elapsed,
    sleep: async ms => { elapsed += ms; },
  };
}
const eof = () => Object.assign(new Error('gh failed'), { stderr: 'Get "https://api.github.com/repos/juan294/sutura/actions/workflows/placebo-live-case.yml": unexpected EOF\n' });
test('recorded GitHub EOF during read polling recovers without redispatch', async () => {
  const h = harness([eof(), JSON.stringify([completed])]);
  assert.equal((await pollRun('controller', 'case', sha, h)).databaseId, 42);
  assert.equal(h.calls, 2);
});
test('persistent transport failures stop at a finite deadline', async () => {
  const h = harness(() => eof());
  await assert.rejects(pollRun('controller', 'case', sha, {...h, timeoutMs: 25000}), /deadline|Timed out/);
  assert.ok(h.calls > 1 && h.calls < 10);
});
test('successful read resets the consecutive failure allowance', async () => {
  const h = harness([eof(), eof(), '[]', eof(), JSON.stringify([completed])]);
  assert.equal((await pollRun('controller', 'case', sha, h)).databaseId, 42);
});
for (const [label, response, message] of [
  ['authentication', new Error('HTTP 401: Bad credentials'), /401/],
  ['malformed JSON', '{', /JSON|property/i],
  ['wrong identity', JSON.stringify([{...completed, headSha:'b'.repeat(40)}]), /SHA differs/],
  ['failed job', JSON.stringify([{...completed, conclusion:'failure'}]), /failed/],
  ['duplicate jobs', JSON.stringify([completed, completed]), /Multiple/],
]) test(`${label} remains an immediate failure`, async () => {
  const h = harness([response]);
  await assert.rejects(pollRun('controller', 'case', sha, h), message);
  assert.equal(h.calls, 1);
});

test('TLS outage beyond three polls recovers within the deadline', async () => {
  const tls = () => Object.assign(new Error('gh failed'), {stderr:'net/http: TLS handshake timeout'});
  const h = harness([tls(),tls(),tls(),tls(),JSON.stringify([completed])]);
  assert.equal((await pollRun('controller','case',sha,h)).databaseId,42);
  assert.equal(h.calls,5);
});
test('checkpointed job identity uses direct run reads after restart', async () => {
  let calls=0;
  const run = await pollRun('controller','case',sha,{
    runId:'42',
    command:async (name,args)=>{calls++; assert.deepEqual(args.slice(0,3),['run','view','42']); return JSON.stringify(completed);},
  });
  assert.equal(run.databaseId,42); assert.equal(calls,1);
});
test('discovered job ID is checkpointed before waiting again', async () => {
  let saved=false; let calls=0;
  await pollRun('controller','case',sha,{
    checkpointRun:async id=>{assert.equal(id,'42');saved=true;},
    sleep:async ()=>{assert.equal(saved,true);},
    command:async (_name,args)=>{
      calls++;
      if(calls===1) return JSON.stringify([{...completed,status:'in_progress'}]);
      assert.equal(saved,true); assert.deepEqual(args.slice(0,3),['run','view','42']);return JSON.stringify(completed);
    },
  });
});
