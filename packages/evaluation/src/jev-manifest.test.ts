import {describe,it,expect} from 'vitest';
import {createJevManifest,validateJevManifest,jevManifestHash} from './jev-manifest.js';
const input=()=>({controllerSha:'a'.repeat(40),cases:[{id:'public-assertion',family:'assertion',role:'classification',split:'development',category:'synthetic',variant:'positive',questionVersion:'classification-v1',state:{error:'expected 2 to be 1'},questions:{applicable:{type:'noul',instructions:'Does this contain an assertion failure?'}},candidateIds:[],baselineIds:[],labels:{applicable:true},baselineLabels:{applicable:true}}]});
describe('frozen Jev evaluation manifest',()=>{
 it('defaults finite paired arms and three repetitions and binds all data',()=>{
  const manifest=createJevManifest(input());expect(manifest.repetitions).toBe(3);expect(manifest.arms.map(a=>a.id)).toEqual(['off','assist']);
  expect(validateJevManifest(manifest)).toEqual(manifest);expect(jevManifestHash(manifest)).toHaveLength(64);
  expect(()=>validateJevManifest({...manifest,controllerSha:'b'.repeat(40)},'a'.repeat(40))).toThrow(/controllerSha/u);
  const changed=structuredClone(manifest);changed.cases[0]!.state={error:'different'};expect(()=>validateJevManifest(changed)).toThrow(/inputHash/u);
 });
 it('rejects changed policy, corpus, split family leakage, unsafe state and oversize input',()=>{
  const manifest=createJevManifest(input());
  for(const mutation of [{...manifest,model:'jev-latest'},{...manifest,corpusHash:'b'.repeat(64)},{...manifest,thresholds:{...manifest.thresholds,noulTrue:.7}}])expect(()=>validateJevManifest(mutation)).toThrow();
  const seed=input();seed.cases.push({...seed.cases[0]!,id:'leaked-family',split:'evaluation'});expect(()=>createJevManifest(seed)).toThrow(/split/u);
  const secret=input();secret.cases[0]!.state={error:'Authorization: Bearer secret-value'};expect(()=>createJevManifest(secret)).toThrow(/redact/u);
  const big=input();big.cases[0]!.state={error:'x'.repeat(25000)};expect(()=>createJevManifest(big)).toThrow(/24 KiB/u);
 });
});

it('requires labels for every required question and rejects malformed HTTP instructions/criteria',()=>{
 const seed=input();
 const incomplete={...seed,cases:[{...seed.cases[0],questions:{...seed.cases[0]!.questions,selection:{type:'choice',instructions:'Which class?',criteria:{assertion:'assertion',lint:'lint'}}}}]};
 expect(()=>createJevManifest(incomplete)).toThrow(/labels.selection/u);
 for(const q of [{type:'noul',instructions:7},{type:'noul',instructions:'Applies?',criteria:'invalid'},{type:'noul',instructions:'Applies?',criteria:{other:'unsupported'}},{type:'choice',instructions:'Which?',criteria:{one:3}}]){
  expect(()=>createJevManifest({...seed,cases:[{...seed.cases[0],questions:{applicable:q}}]})).toThrow(/questions.applicable/u);
 }
});
