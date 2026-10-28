#!/usr/bin/env node
/** Read-only preparation and retained-result import. No provider or benchmark dispatch lives here. */
import {constants} from 'node:fs';
import {open,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {canonicalJson,validateJevManifest,jevManifestHash,nextJevControllerRun,qualifyJevControllerRuns,importJevControllerRun} from '../packages/evaluation/dist/index.js';
import {validateRunManifest} from './verified-program-evidence.mjs';
const hash=v=>createHash('sha256').update(canonicalJson(v)).digest('hex');
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
function verifySource(manifest,proof,sourceBudget,pricing){
 const source=validateRunManifest(sourceBudget);
 if(source.mode!=='live'||source.identity.candidateCommit!==manifest.controllerSha||source.manifestHash!==proof.sourceManifestHash||source.identity.corpusHash.replace(/^sha256:/u,'')!==proof.corpusHash||Object.values(proof.subjects).some(id=>!source.subjects.includes(id)))throw new Error('Full-run source manifest/corpus/subject hash differs from the approved proof');
 if(!pricing||Object.keys(pricing).some(k=>!['schemaVersion','usdPerRawUnit','asOf','source'].includes(k))||pricing.schemaVersion!=='sutura-sandbox-price-v1'||!positive(pricing.usdPerRawUnit)||!/^\d{4}-\d{2}-\d{2}$/u.test(pricing.asOf??''))throw new Error('Sandbox price evidence must state a positive USD unit conversion and date');
 let url;try{url=new URL(pricing.source);}catch{throw new Error('Sandbox price evidence requires its source URL');}
 if(url.protocol!=='https:'||url.username||url.password||hash(pricing)!==proof.priceEvidenceHash)throw new Error('Sandbox price evidence hash/source differs from the frozen proof');
 // Reserve the declared entire inference ceiling plus the new independent role cap.
 if(proof.maximumInferenceUsd+1e-12<source.caps.inferenceUsd+.02||proof.maximumSandboxUsd+1e-12<source.caps.rawSandboxUnits*pricing.usdPerRawUnit)throw new Error('Full-run proof understates the existing inference/sandbox maximum; obtain bounded budget evidence before a paid run');
 return source;
}
export function prepareJevControllerComparison({manifest:rawManifest,proof,sourceBudget,pricing,records=[]}){
 const manifest=validateJevManifest(rawManifest);verifySource(manifest,proof,sourceBudget,pricing);
 const admitted=nextJevControllerRun(manifest,proof,records);
 const proposedRun=admitted.status==='ready'?admitted.next:null;
 const next=admitted.status==='ready'?{status:'blocked',reason:'full-controller-runtime-bound-unavailable',nextAction:'The standalone local runtime has no proven binding between its actual provider/sandbox limits and this declaration. Use the existing separately approved paid-run reservation/recovery procedure with enforced full limits before execution.',remainingUsd:admitted.remainingUsd}:admitted;
 return {schemaVersion:'sutura-jev-controller-preparation-v1',manifestHash:jevManifestHash(manifest),dispatchPerformed:false,localFullRunAdmission:'UNMEASURED',next,proposedRun,command:null,qualifications:qualifyJevControllerRuns(manifest,proof,records),nextAction:'Preparation and retained-result import are read-only. No executable paid command is published: actual local full-runtime spending bounds are unsupported/unmeasured. Use the existing separately approved paid-run reservation/recovery procedure and re-import complete receipts; a Jev-only cap does not bound the full controller.'};
}
async function readJson(file){const h=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const before=await h.stat();if(!before.isFile()||before.size>16*1024*1024)throw new Error(`${file}: select a bounded regular JSON file`);const buffer=Buffer.alloc(before.size+1),{bytesRead}=await h.read(buffer,0,buffer.length,0),after=await h.stat();if(bytesRead!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error(`${file}: file changed; preserve a stable evidence file`);return JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));}finally{await h.close();}}
export async function runJevControllerPreparation(args){
 const values={};for(let i=0;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!['--manifest','--proof','--source-budget','--pricing','--runs','--import-report','--measurement','--output'].includes(flag)||Object.hasOwn(values,flag)||!value||value.startsWith('--'))throw new Error('Use --manifest --proof --source-budget --pricing [--runs] [--import-report --measurement] [--output]');values[flag]=resolve(value);}
 for(const flag of ['--manifest','--proof','--source-budget','--pricing'])if(!values[flag])throw new Error(`${flag} is required`);
 if(Boolean(values['--import-report'])!==Boolean(values['--measurement']))throw new Error('--import-report and --measurement must be supplied together');
 if(values['--output']&&Object.entries(values).some(([key,value])=>key!=='--output'&&value===values['--output']))throw new Error('Output must preserve all input evidence files');
 const manifest=await readJson(values['--manifest']),proof=await readJson(values['--proof']),sourceBudget=await readJson(values['--source-budget']),pricing=await readJson(values['--pricing']);
 let records=values['--runs']?await readJson(values['--runs']):[];if(!Array.isArray(records))throw new Error('--runs must contain the complete retained record array');let previousPartial;
 if(values['--import-report']){const report=await readJson(values['--import-report']),measurement=await readJson(values['--measurement']);const identity=report.jevComparison?.identity;if(!identity)throw new Error('Historical report has no observed arm identity; retain it as partial evidence rather than qualify it');const imported=importJevControllerRun(manifest,proof,identity,report,measurement);
  if(identity.ordinal===records.length-1&&records.at(-1)?.status!=='COMPLETE'&&records.at(-1)?.reportHash===imported.reportHash&&records.at(-1)?.invocationId===imported.invocationId){previousPartial=records.at(-1);records=[...records.slice(0,-1),imported];}else if(identity.ordinal===records.length)records=[...records,imported];else throw new Error('Imported retained report is not the exact next run or the same partial run reconciliation');}
 const result={...prepareJevControllerComparison({manifest,proof,sourceBudget,pricing,records}),records,...(previousPartial?{previousPartial}: {})};
 if(values['--output'])await writeFile(values['--output'],JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const result=await runJevControllerPreparation(process.argv.slice(2));process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.next.status==='blocked')process.exitCode=1;}catch(error){process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=2;}}
