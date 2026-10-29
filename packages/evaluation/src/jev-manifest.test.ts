import {describe,it,expect} from 'vitest';
import {createJevManifest,validateJevManifest,jevManifestHash,JEV_QUESTION_VERSIONS} from './jev-manifest.js';
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


it('versions the single-selection navigator contract while retaining frozen v1 manifests',()=>{
 expect(JEV_QUESTION_VERSIONS.navigator).toBe('navigator-v2');
 const seed=input();
 const navigator={...seed.cases[0],role:'navigator',questions:{applicable:{type:'noul',instructions:'Does evidence address this query?'},first:{type:'choice',instructions:'Which block best addresses this query?',criteria:{block:'Evidence',none:'No applicable evidence'}}},candidateIds:['block'],baselineIds:['block'],labels:{applicable:true,first:'block'},baselineLabels:{applicable:true,first:'block'}};
 for(const questionVersion of ['navigator-v1','navigator-v2']){
  const manifest=createJevManifest({...seed,cases:[{...navigator,questionVersion}]});
  expect(validateJevManifest(manifest).cases[0]?.questionVersion).toBe(questionVersion);
 }
 const legacy = createJevManifest({...seed,cases:[{...navigator,questionVersion:'navigator-v1',questions:{...navigator.questions,second:navigator.questions.first,third:navigator.questions.first},labels:{...navigator.labels,second:'none',third:'none'},baselineLabels:{...navigator.baselineLabels,second:'none',third:'none'}}]});
 expect(validateJevManifest(legacy)).toEqual(legacy);
 expect(jevManifestHash(validateJevManifest(legacy))).toBe(jevManifestHash(legacy));
 expect(()=>createJevManifest({...seed,cases:[{...navigator,questionVersion:'navigator-v3'}]})).toThrow(/questionVersion/u);
 expect(()=>createJevManifest({...seed,cases:[{...seed.cases[0],questionVersion:'classification-v2'}]})).toThrow(/questionVersion/u);
});


it('versions single-selection recovery while preserving frozen recovery-v1 manifests',()=>{
 expect(JEV_QUESTION_VERSIONS.recovery).toBe('recovery-v2');
 const seed=input();
 for(const questionVersion of ['recovery-v1','recovery-v2']){
  const manifest=createJevManifest({...seed,cases:[{...seed.cases[0],role:'recovery',questionVersion}]});
  expect(validateJevManifest(manifest).cases[0]?.questionVersion).toBe(questionVersion);
 }
 expect(()=>createJevManifest({...seed,cases:[{...seed.cases[0],role:'recovery',questionVersion:'recovery-v3'}]})).toThrow(/questionVersion/u);
});
