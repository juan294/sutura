import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createJevManifest,jevControllerBudgetHash,canonicalJson} from '../packages/evaluation/dist/index.js';
import {validateRunManifest} from './verified-program-evidence.mjs';
import {prepareJevControllerComparison} from './jev-controller-compare.mjs';
const digest=v=>createHash('sha256').update(canonicalJson(v)).digest('hex');
const source=validateRunManifest(JSON.parse(await readFile(new URL('../docs/demo/run-manifests/development-validation-v1.json',import.meta.url))));
function fixture(){
 const pricing={schemaVersion:'sutura-sandbox-price-v1',usdPerRawUnit:.001,asOf:'2026-10-28',source:'https://example.test/invented-test-price'};
 const proof={schemaVersion:'sutura-jev-controller-budget-v1',controllerSha:source.identity.candidateCommit,corpusHash:source.identity.corpusHash,sourceManifestHash:source.manifestHash,priceEvidenceHash:digest(pricing),maximumInferenceUsd:source.caps.inferenceUsd+.02,maximumSandboxUsd:source.caps.rawSandboxUnits*.001,nativeCancellationBound:true,subjects:{'case-0':source.subjects[0]}};
 const manifest=createJevManifest({controllerSha:proof.controllerSha,cases:[{id:'case-0',family:'independent-fixture',role:'ranking',split:'evaluation',category:'synthetic',variant:'positive',questionVersion:'ranking-v1',state:'invented budget calculation',questions:{sufficient:{type:'noul',instructions:'Is this sufficient?'}},candidateIds:[],baselineIds:[],labels:{sufficient:true}}],controller:{cumulativeUsd:100,inferenceUsd:100,sandboxUsd:100,repairLimitsHash:'a'.repeat(64),policyHash:'b'.repeat(64),providerModels:{model:'test-model'},budgetEvidenceHash:jevControllerBudgetHash(proof)}});
 return {manifest,proof,sourceBudget:source,pricing,records:[]};
}
test('retains one nonexecuting descriptor while unsupported runtime bounds withhold paid commands',()=>{
 const input=fixture(),result=prepareJevControllerComparison(input);
 assert.equal(result.next.status,'blocked');assert.equal(result.dispatchPerformed,false);assert.equal(result.proposedRun.arm,'off');
 assert.equal(result.command,null);assert.equal(result.localFullRunAdmission,'UNMEASURED');assert.match(result.next.nextAction,/reservation\/recovery/u);
 assert.equal(result.qualifications[0].status,'UNMEASURED');
});
test('refuses unpriced, wrong-source, and insufficient full allocations',()=>{
 const input=fixture();assert.throws(()=>prepareJevControllerComparison({...input,pricing:{...input.pricing,usdPerRawUnit:0}}),/price/u);
 assert.throws(()=>prepareJevControllerComparison({...input,sourceBudget:{...source,identity:{...source.identity,candidateCommit:'c'.repeat(40)}}}),/source/u);
 const result=prepareJevControllerComparison({...input,manifest:{...input.manifest,controller:{...input.manifest.controller,cumulativeUsd:.00001}}});assert.equal(result.next.status,'blocked');assert.equal(result.command,null);
});
test('withholds executable controller work when declared low caps are not enforced by the runtime',()=>{
 const input=fixture(),small=validateRunManifest({...input.sourceBudget,caps:{...input.sourceBudget.caps,inferenceUsd:.001}});
 const proof={...input.proof,sourceManifestHash:small.manifestHash,maximumInferenceUsd:.021};
 const manifest=createJevManifest({controllerSha:input.manifest.controllerSha,cases:input.manifest.cases,controller:{...input.manifest.controller,budgetEvidenceHash:jevControllerBudgetHash(proof)}});
 const result=prepareJevControllerComparison({...input,sourceBudget:small,proof,manifest});assert.equal(result.next.status,'blocked');assert.equal(result.command,null);
});
