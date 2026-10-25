import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protectedLoaderScript, mandatoryFullExpression, gateRunScript } from './ci-routing-workflow-v2.mjs';
import { spawnSync } from 'node:child_process';
test('mandatory full independently binds production and native trust',()=>{
 const expression=mandatoryFullExpression({ownerId:42,productionBranch:'master',extra:'github.sha == vars.RELEASE_CANDIDATE_SHA'});
 for(const part of ["refs/heads/master","github.base_ref == 'master'","github.actor_id != '42'","github.event.pull_request.user.id != 42","github.event.pull_request.head.repo.id != github.event.repository.id","github.sha == vars.RELEASE_CANDIDATE_SHA"]) assert.ok(expression.includes(part),part);
 assert.ok(!expression.includes('CI_CADENCE_MODE'));
});
test('gate runs real native child results, independent mandatory full overrides fast',()=>{
 const run=(needs,force='false')=>spawnSync('bash',['-e','-c',gateRunScript(['test'])],{env:{...process.env,NEEDS:JSON.stringify(needs),FORCE_FULL:force},encoding:'utf8'});
 assert.equal(run({routing:{result:'success',outputs:{full:'true'}},test:{result:'success'}}).status,0);
 for(const result of ['failure','cancelled','skipped',undefined]) assert.equal(run({routing:{result:'success',outputs:{full:'true'}},test:{result}}).status,1);
 assert.equal(run({routing:{result:'failure',outputs:{full:'false'}}}).status,1);
 assert.equal(run({routing:{result:'success',outputs:{full:'false'}},test:{result:'skipped'}},'true').status,1);
 assert.equal(run({routing:{result:'success',outputs:{full:'false'}}}).status,0);
});
test('loader extracts protected source and bridge does not invoke v1 admission',()=>{
 const script=protectedLoaderScript({policyChecks:true});assert.match(script,/git_read show "\$base:scripts\/ci-routing-v2.mjs"/);assert.match(script,/defaultChecks/);assert.doesNotMatch(script,/runFast\(/);assert.match(script,/installation-missing/);
});

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
function checkoutFixture(installed, fn) {
 const root=mkdtempSync(join(tmpdir(),'sutura-protected-loader-'));
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try {
  git('init','-b','develop');git('config','user.email','test@example.invalid');git('config','user.name','Fixture');
  mkdirSync(join(root,'.github'));mkdirSync(join(root,'scripts'));
  writeFileSync(join(root,'.github/ci-cadence.json'),JSON.stringify({schemaVersion:1,repository:'example/project',ownerId:42,owners:['owner'],integrationBranch:'develop',productionBranch:'main'}));
  if(installed)writeFileSync(join(root,'scripts/ci-routing-v2.mjs'),readFileSync(fileURLToPath(new URL('./ci-routing-v2.mjs',import.meta.url))));
  writeFileSync(join(root,'app.txt'),'base');git('add','.');git('commit','-m','base');const base=git('rev-parse','HEAD');
  fn({root,env,git,base});
 }finally{rmSync(root,{recursive:true,force:true});}
}
function runLoader({root,env,base,git,eventName='push',payload}) {
 const tested=git('rev-parse','HEAD'),event=join(root,'event.json'),output=join(root,'output');
 writeFileSync(event,JSON.stringify(payload??{repository:{full_name:'example/project',id:7},before:base,after:tested}));
 const run=spawnSync('bash',['-e','-c',protectedLoaderScript()],{cwd:root,env:{...env,GIT_DIR:'/unrelated/invalid/path',GITHUB_EVENT_PATH:event,GITHUB_EVENT_NAME:eventName,GITHUB_SHA:tested,GITHUB_REF:eventName==='push'?'refs/heads/develop':'refs/pull/1/merge',GITHUB_ACTOR:'owner',GITHUB_ACTOR_ID:'42',GITHUB_OUTPUT:output},encoding:'utf8'});
 return {...run,output:existsSync(output)?readFileSync(output,'utf8'):''};
}
test('real loader uses protected implementation; candidate helper cannot execute or grant fast',()=>checkoutFixture(true,fixture=>{
 const {root,git}=fixture;writeFileSync(join(root,'scripts/ci-routing-v2.mjs'),"import {writeFileSync} from 'node:fs';writeFileSync('attacked','yes');");git('add','.');git('commit','-m','change candidate helper');
 const run=runLoader(fixture);assert.equal(run.status,0,run.stderr);assert.match(run.output,/full=true/);assert.match(run.output,/reason=control-change/);assert.equal(existsSync(join(root,'attacked')),false);
}));
test('first installation runs full without importing proposed candidate helper',()=>checkoutFixture(false,fixture=>{
 const {root,git}=fixture;writeFileSync(join(root,'scripts/ci-routing-v2.mjs'),"throw new Error('candidate executed');");git('add','.');git('commit','-m','first install');
 const run=runLoader(fixture);assert.equal(run.status,0,run.stderr);assert.match(run.output,/reason=installation-missing/);assert.match(run.output,/full=true/);assert.doesNotMatch(run.stderr,/candidate executed/);
}));
test('corrected next ordinary owner event automatically selects fast',()=>checkoutFixture(true,fixture=>{
 writeFileSync(join(fixture.root,'app.txt'),'changed');fixture.git('add','.');fixture.git('commit','-m','ordinary app');
 const run=runLoader(fixture);assert.equal(run.status,0,run.stderr);assert.match(run.output,/full=false/);assert.match(run.output,/reason=owner-integration/);
}));
test('invalid physical PR merge fails and retains full output with visible cause',()=>checkoutFixture(true,fixture=>{
 writeFileSync(join(fixture.root,'app.txt'),'changed');fixture.git('add','.');fixture.git('commit','-m','not a merge');
 const run=runLoader({...fixture,eventName:'pull_request',payload:{repository:{full_name:'example/project',id:7},pull_request:{head:{sha:fixture.base},base:{sha:fixture.base,ref:'develop'}}}});
 assert.notEqual(run.status,0);assert.match(run.output,/full=true/);assert.match(run.stderr,/parent|ambiguous/);
}));

test('protected adapter failure resets a previously emitted fast output to full and stays RED',()=>checkoutFixture(true,fixture=>{
 const {root,git}=fixture;
 writeFileSync(join(root,'scripts/ci-fast.mjs'),"export const defaultChecks={policyValidation:()=>['intentional adapter failure'],lockfileValidation:()=>[],cadenceContracts:()=>[]};");
 writeFileSync(join(root,'scripts/ci-cadence-routing.mjs'),"export const loadPolicy=JSON.parse;export const blobAt=()=>()=>undefined;");
 writeFileSync(join(root,'scripts/ci-cadence.mjs'),"export const validatePolicy=()=>({valid:true,errors:[]});");
 git('add','.');git('commit','-m','protected adapter interface fixture');const base=git('rev-parse','HEAD');
 writeFileSync(join(root,'app.txt'),'ordinary app');git('add','.');git('commit','-m','ordinary app');
 const event=join(root,'event.json');writeFileSync(event,JSON.stringify({repository:{full_name:'example/project',id:7},before:base,after:git('rev-parse','HEAD')}));
 const execute=script=>{
  const output=join(root,'bridge-output');writeFileSync(output,'');
  const run=spawnSync('bash',['-e','-c',script],{cwd:root,env:{...fixture.env,GITHUB_EVENT_NAME:'push',GITHUB_EVENT_PATH:event,GITHUB_SHA:git('rev-parse','HEAD'),GITHUB_REF:'refs/heads/develop',GITHUB_ACTOR:'owner',GITHUB_ACTOR_ID:'42',GITHUB_OUTPUT:output},encoding:'utf8'});
  return {...run,full:readFileSync(output,'utf8').trim().split('\n').filter(line=>line.startsWith('full=')).at(-1)};
 };
 const script=protectedLoaderScript({policyChecks:true});const run=execute(script);
 assert.equal(run.status,1);assert.match(run.stderr,/intentional adapter failure/);assert.equal(run.full,'full=true');
 // Mutation proves the reset assertion rejects the previous cleanup-only trap.
 const mutant=execute(script.replace(/trap '[^\n]+ EXIT/,`trap 'rm -rf "$protected"' EXIT`));
 assert.equal(mutant.status,1);assert.equal(mutant.full,'full=false');
}));

test('mandatory native branch cannot be omitted or coerced to a literal undefined branch',()=>{
 for(const productionBranch of [undefined,null,'',42])assert.throws(()=>mandatoryFullExpression({ownerId:42,productionBranch}));
});
test('malformed protected check return is a visible failure rather than an empty success',()=>checkoutFixture(false,fixture=>{
 const {root,git}=fixture;
 writeFileSync(join(root,'scripts/ci-fast.mjs'),"export const defaultChecks={policyValidation:()=>[],lockfileValidation:()=>[],cadenceContracts:()=>''};");
 writeFileSync(join(root,'scripts/ci-cadence-routing.mjs'),"export const loadPolicy=JSON.parse;export const blobAt=()=>()=>undefined;");
 writeFileSync(join(root,'scripts/ci-cadence.mjs'),"export const validatePolicy=()=>({valid:true,errors:[]});");
 git('add','.');git('commit','-m','protected malformed adapter interface');const base=git('rev-parse','HEAD');writeFileSync(join(root,'app.txt'),'app');git('add','.');git('commit','-m','app');
 const event=join(root,'event.json'),output=join(root,'check-output');writeFileSync(event,JSON.stringify({repository:{full_name:'example/project',id:7},before:base,after:git('rev-parse','HEAD')}));
 const run=spawnSync('bash',['-e','-c',protectedLoaderScript({policyChecks:true})],{cwd:root,env:{...fixture.env,GITHUB_EVENT_NAME:'push',GITHUB_EVENT_PATH:event,GITHUB_SHA:git('rev-parse','HEAD'),GITHUB_REF:'refs/heads/develop',GITHUB_ACTOR:'owner',GITHUB_ACTOR_ID:'42',GITHUB_OUTPUT:output},encoding:'utf8'});
 assert.equal(run.status,1);assert.match(run.stderr,/cadenceContracts.*array/);assert.match(readFileSync(output,'utf8'),/full=true/);
}));
