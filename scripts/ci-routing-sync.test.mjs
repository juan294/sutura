import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, renameSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncRouting } from './ci-routing-sync.mjs';
function fixture(fn) { const root=mkdtempSync(join(tmpdir(),'sutura-routing-sync-')); try{mkdirSync(join(root,'.github'));writeFileSync(join(root,'.github/ci-cadence.json'),JSON.stringify({schemaVersion:1,repository:'example/project'}));fn(root);}finally{rmSync(root,{recursive:true,force:true});} }
test('check is read-only; installation is explicit and deterministic',()=>fixture(root=>{
 assert.equal(syncRouting({root}).ok,false);assert.equal(existsSync(join(root,'scripts/ci-routing-v2.mjs')),false);
 assert.equal(syncRouting({root,install:true}).ok,true);assert.equal(syncRouting({root}).ok,true);
 const marker=readFileSync(join(root,'.github/sutura-routing.json'),'utf8');syncRouting({root,install:true});assert.equal(readFileSync(join(root,'.github/sutura-routing.json'),'utf8'),marker);
}));
test('drift is visible and cannot overwrite unowned local code',()=>fixture(root=>{
 mkdirSync(join(root,'scripts'));writeFileSync(join(root,'scripts/ci-routing-v2.mjs'),'unowned code');assert.throws(()=>syncRouting({root,install:true}),/unowned/);assert.equal(readFileSync(join(root,'scripts/ci-routing-v2.mjs'),'utf8'),'unowned code');
}));
test('managed drift needs an explicit install; corrupt ownership cannot be adopted',()=>fixture(root=>{
 syncRouting({root,install:true});writeFileSync(join(root,'scripts/ci-routing-v2.mjs'),'changed');assert.equal(syncRouting({root}).ok,false);assert.equal(readFileSync(join(root,'scripts/ci-routing-v2.mjs'),'utf8'),'changed');assert.equal(syncRouting({root,install:true}).ok,true);
 writeFileSync(join(root,'.github/sutura-routing.json'),JSON.stringify({owner:'other'}));assert.throws(()=>syncRouting({root,install:true}),/ownership/);
}));
test('a target without cadence policy is not turned into a new routing consumer',()=>fixture(root=>{
 rmSync(join(root,'.github/ci-cadence.json'));assert.throws(()=>syncRouting({root,install:true}),/policy/);
}));

test('installation rejects symlink leaves and parents without altering outside bytes',()=>{
 for(const target of ['module','marker','scripts-parent','github-parent','dangling'])fixture(root=>{
  syncRouting({root,install:true});const outside=mkdtempSync(join(tmpdir(),'sutura-routing-outside-'));
  try {
   const external=join(outside,'external');writeFileSync(external,'outside bytes');
   if(target==='module'||target==='dangling'){rmSync(join(root,'scripts/ci-routing-v2.mjs'));symlinkSync(target==='dangling'?join(outside,'missing'):external,join(root,'scripts/ci-routing-v2.mjs'));}
   if(target==='marker'){writeFileSync(external,readFileSync(join(root,'.github/sutura-routing.json')));rmSync(join(root,'.github/sutura-routing.json'));symlinkSync(external,join(root,'.github/sutura-routing.json'));}
   if(target==='scripts-parent'){renameSync(join(root,'scripts'),join(root,'saved-scripts'));symlinkSync(outside,join(root,'scripts'));}
   if(target==='github-parent'){writeFileSync(join(outside,'ci-cadence.json'),readFileSync(join(root,'.github/ci-cadence.json')));writeFileSync(join(outside,'sutura-routing.json'),readFileSync(join(root,'.github/sutura-routing.json')));renameSync(join(root,'.github'),join(root,'saved-github'));symlinkSync(outside,join(root,'.github'));}
   const before=readFileSync(external,'utf8');assert.throws(()=>syncRouting({root,install:true}),/symlink/,target);assert.equal(readFileSync(external,'utf8'),before,target);assert.equal(existsSync(join(outside,'missing')),false);
  }finally{rmSync(outside,{recursive:true,force:true});}
 });
});
test('atomic replacement does not mutate another hard link to a managed file',()=>fixture(root=>{
 syncRouting({root,install:true});const outside=mkdtempSync(join(tmpdir(),'sutura-routing-hardlink-'));try{
  const file=join(root,'scripts/ci-routing-v2.mjs'),external=join(outside,'original');writeFileSync(file,'managed drift');linkSync(file,external);
  assert.equal(syncRouting({root,install:true}).ok,true);assert.equal(readFileSync(external,'utf8'),'managed drift');
 }finally{rmSync(outside,{recursive:true,force:true});}
}));
