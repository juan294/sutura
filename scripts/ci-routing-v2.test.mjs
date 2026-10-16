import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planVerification, inspectCheckout, controlPath, applicationGate } from './ci-routing-v2.mjs';
const policy = { schemaVersion: 1, repository: 'example/project', owners: ['owner'], ownerId: 42, integrationBranch: 'develop', productionBranch: 'main' };
const sha = n => String(n).repeat(40);
const context = { eventName: 'pull_request', repository: policy.repository, repositoryId: 7, actor: 'owner', actorId: 42, author: 'owner', authorId: 42, headRepository: policy.repository, headRepositoryId: 7, ref: 'refs/pull/1/merge', baseRef: 'develop' };
const identity = { sourceSha: sha(1), baseSha: sha(2), testedSha: sha(3), definitionSha: sha(2) };
const plan = overrides => planVerification({ policy, context, identity, changedPaths: ['src/app.ts'], ...overrides });
test('authenticated ordinary integration work is fast independently of any mode variable', () => {
  const result = plan(); assert.equal(result.full, false); assert.equal(result.trust, 'owner'); assert.equal(result.schemaVersion, 2);
  assert.equal(result.allowPrivileged, false); assert.equal(result.allowDeploy, false); assert.deepEqual(result.identity, identity);
});
test('wrong numeric identity, bot author, fork and bot rerun always require full readonly verification', () => {
  for (const fields of [{actorId: 43}, {actorId:'42e0'}, {author: 'repair[bot]', authorId: 99}, {headRepository: 'fork/project', headRepositoryId: 8}, {authorId: '42'}, {actor: 'unknown'}]) {
    const result = plan({ context: {...context,...fields} }); assert.equal(result.full,true); assert.equal(result.trust,'untrusted'); assert.equal(result.allowDeploy,false);
  }
});
test('production, refresh, manual, unknown branch and absent installation require full', () => {
  for (const fields of [{baseRef:'main'}, {eventName:'schedule'}, {eventName:'workflow_dispatch'}, {baseRef:'unknown'}]) assert.equal(plan({context:{...context,...fields}}).full,true);
  assert.equal(plan({installed:false}).reason,'installation-missing');
});
test('all execution control and runtime changes require full in the original event', () => {
  for (const path of ['.github/workflows/new.yml','.github/actions/nested/file.sh','.github/ci-cadence.json','scripts/ci-fast.mjs','scripts/verify-full.sh','apps/web/scripts/run-ci.mjs','supabase/config.toml','scripts/ci-routing-v2.mjs','package-lock.json','sub/package.json','pnpm-lock.yaml','pyproject.toml','uv.lock','.node-version','Dockerfile','.nvmrc','tsconfig.json','.npmrc','next.config.ts','playwright.config.ts','eslint.config.mjs']) {
    assert.equal(controlPath(path),true,path); assert.equal(plan({changedPaths:[path]}).reason,'control-change',path);
  }
  assert.equal(controlPath('src/github/client.ts'),false);
});
test('malformed policy, missing identities and repository mismatch fail visibly', () => {
  for (const overrides of [{policy:{...policy,ownerId:undefined}}, {identity:{...identity,baseSha:'bad'}}, {identity:{...identity,definitionSha:sha(4)}}, {context:{...context,repository:'attacker/project'}}, {changedPaths:undefined}]) assert.throws(()=>plan(overrides));
});
test('full application gate requires actual success from every expected child', () => {
  const route={result:'success',outputs:{full:'true'}};
  assert.deepEqual(applicationGate({route,required:['test','build'],needs:{test:{result:'success'},build:{result:'success'}}}),[]);
  for(const result of ['skipped','cancelled','failure',undefined]) assert.match(applicationGate({route,required:['test'],needs:{test:{result}}}).join(' '),/test/);
  assert.match(applicationGate({route:{result:'failure',outputs:{full:'false'}},required:[],needs:{}}).join(' '),/routing/);
  assert.match(applicationGate({route:{result:'success',outputs:{}},required:[],needs:{}}).join(' '),/routing/);
  assert.deepEqual(applicationGate({route:{result:'success',outputs:{full:'false'}},required:['test'],needs:{}}),[]);
  assert.match(applicationGate({route:{result:'success',outputs:{full:'false'}},mandatoryFull:true,required:['test'],needs:{test:{result:'skipped'}}}).join(' '),/test/);
});
function fixture(fn) {
 const root=mkdtempSync(join(tmpdir(),'routing-v2-')); const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try { git('init','-b','develop'); git('config','user.email','test@example.invalid'); git('config','user.name','Fixture'); mkdirSync(join(root,'.github'));writeFileSync(join(root,'.github/ci-cadence.json'),JSON.stringify(policy));writeFileSync(join(root,'app.txt'),'base'); git('add','.');git('commit','-m','base'); const base=git('rev-parse','HEAD');
  git('checkout','-b','feature');writeFileSync(join(root,'app.txt'),'candidate');git('add','.');git('commit','-m','candidate');const head=git('rev-parse','HEAD');git('checkout','develop');git('merge','--no-ff','feature','-m','merge');const tested=git('rev-parse','HEAD');fn({root,git,base,head,tested,env});
 } finally {rmSync(root,{recursive:true,force:true});}
}
test('PR physical parents bind distinct head/base/tested merge and reject stale checkout',()=>fixture(({root,base,head,tested})=>{
 const payload={repository:{full_name:policy.repository,id:7},pull_request:{user:{login:'owner',id:42},head:{sha:head,repo:{full_name:policy.repository,id:7}},base:{sha:base,ref:'develop'}}};
 const native={eventName:'pull_request',payload,sha:tested,ref:context.ref,actor:'owner',actorId:'42'};
 const inspected=inspectCheckout({root,native,base});assert.deepEqual(inspected.identity,{sourceSha:head,baseSha:base,testedSha:tested,definitionSha:base});assert.deepEqual(inspected.changedPaths,['app.txt']);
 assert.throws(()=>inspectCheckout({root,native:{...native,payload:{...payload,pull_request:{...payload.pull_request,head:{...payload.pull_request.head,sha:base}}}},base}),/parent/);
 assert.throws(()=>inspectCheckout({root,native,base:head}),/base/);
}));
test('push source must be checked out and protected before must be an ancestor',()=>fixture(({root,base,head,tested})=>{
 const native={eventName:'push',payload:{repository:{full_name:policy.repository,id:7},before:base,after:tested,sender:{login:'owner',id:42}},sha:tested,ref:'refs/heads/develop',actor:'owner',actorId:'42'};
 assert.equal(inspectCheckout({root,native,base}).identity.sourceSha,tested);
 assert.throws(()=>inspectCheckout({root,native:{...native,payload:{...native.payload,after:head}},base}),/checkout/);
}));
test('CLI emits fail-safe full before a malformed identity failure and a useful recovery message',()=>fixture(({root,base,head,tested,env})=>{
 const event=join(root,'event.json'),output=join(root,'output');writeFileSync(event,JSON.stringify({repository:{full_name:policy.repository,id:7},before:base,after:head}));
 const run=spawnSync(process.execPath,[fileURLToPath(new URL('./ci-routing-v2.mjs',import.meta.url)),'--base',base],{cwd:root,env:{...env,GITHUB_EVENT_PATH:event,GITHUB_EVENT_NAME:'push',GITHUB_SHA:tested,GITHUB_REF:'refs/heads/develop',GITHUB_ACTOR:'owner',GITHUB_ACTOR_ID:'42',GITHUB_OUTPUT:output},encoding:'utf8'});
 assert.equal(run.status,1);assert.match(readFileSync(output,'utf8'),/full=true/);assert.match(run.stderr,/Sutura/);assert.doesNotMatch(run.stderr,/set.*legacy|set.*lean/);
}));
