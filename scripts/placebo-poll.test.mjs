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
      const response = responses[calls++];
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
test('persistent transient read failures stop after three attempts', async () => {
  const h = harness([eof(), eof(), eof()]);
  await assert.rejects(pollRun('controller', 'case', sha, h), /gh failed/);
  assert.equal(h.calls, 3);
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
