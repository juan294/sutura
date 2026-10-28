import { describe, expect, it, vi } from 'vitest';
import { DecisionSession, choice, noul } from './call.js';
import { semanticConfig } from './config.js';
import type { NebiusFetch } from '../llm/nebius.js';
import { Ledger } from '../llm/cost.js';
import { TypeSafeClient } from '../llm/typesafe.js';

const questions = { applicable: { type: 'noul' as const, instructions: 'Is evidence sufficient?' } };
const config = () => semanticConfig({ modes: { ranking: 'assist' }, maxUsd: .02 }, true);
function client(fetch: ReturnType<typeof vi.fn>) { return new TypeSafeClient({apiKey:'test',ledger:new Ledger({}),model:'jev-1.14.0'}, {fetch:fetch as NebiusFetch}); }
function response(status=200) { return { ok: status===200,status,headers:{get:()=>null},text:async()=>'',json:async()=>({model:'jev-1.14.0',answers:{applicable:{type:'noul',noul:.9}},usage:{input_tokens:10,output_tokens:0}}) }; }
describe('bounded semantic calls',()=>{
 it('off and shadow never send; shadow captures redacted bounded input',async()=>{
  const fetch=vi.fn(); const capture=vi.fn();
  await new DecisionSession({config:semanticConfig(),client:client(fetch),deadline:Date.now()+5000}).judge('ranking',{secret:'Bearer abc'},questions,'baseline');
  const session=new DecisionSession({config:semanticConfig({modes:{ranking:'shadow'},maxUsd:.02},true),client:client(fetch),deadline:Date.now()+5000,capture});
  const result=await session.judge('ranking',{token:'Bearer abc'},questions,'baseline');
  expect(fetch).not.toHaveBeenCalled(); expect(capture).toHaveBeenCalledOnce(); expect(result.reason).toBe('shadow-captured');
  expect(JSON.stringify(capture.mock.calls)).not.toContain('Bearer abc');
 });
 it('retries only an explicit 429/5xx with separate reservation',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(response(429)).mockResolvedValue(response());
  const session=new DecisionSession({config:config(),client:client(fetch),deadline:Date.now()+5000});
  expect((await session.judge('ranking',{},questions,'baseline')).outcome).toBe('answered');
  expect(fetch).toHaveBeenCalledTimes(2); expect(session.snapshot().attempts).toBe(2);
 });
 it('unknown transport completion is not resent and retains spend',async()=>{
  const fetch=vi.fn().mockRejectedValue(new Error('lost connection'));
  const session=new DecisionSession({config:config(),client:client(fetch),deadline:Date.now()+5000});
  expect((await session.judge('ranking',{},questions,'baseline')).reason).toBe('provider-unavailable');
  expect(fetch).toHaveBeenCalledTimes(1);expect(session.snapshot().reservedUsd).toBeGreaterThan(0);
 });
 it('rejects wrong models, malformed answers, deadlines, size and cap before use',async()=>{
  const fetch=vi.fn().mockResolvedValue(response());
  const expired=new DecisionSession({config:config(),client:client(fetch),deadline:0});
  expect((await expired.judge('ranking',{},questions,'baseline')).reason).toBe('deadline');
  expect(fetch).not.toHaveBeenCalled();
  const session=new DecisionSession({config:config(),client:client(fetch),deadline:Date.now()+5000});
  expect((await session.judge('ranking','x'.repeat(24577),questions,'baseline')).reason).toBe('input-too-large');
  expect(fetch).not.toHaveBeenCalled();
 });
 it('times out once even if transport completes late, then a fresh invocation recovers',async()=>{
  vi.useFakeTimers();
  try {
   const fetch=vi.fn().mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve(response()),6000)));
   const session=new DecisionSession({config:config(),client:client(fetch),deadline:Date.now()+5000});
   const pending=session.judge('ranking',{},questions,'baseline'); await vi.advanceTimersByTimeAsync(5000);
   const evidence=await pending;expect(evidence.reason).toBe('timeout');const spent=session.snapshot().reservedUsd;
   await vi.advanceTimersByTimeAsync(1000);expect(session.snapshot().reservedUsd).toBe(spent);expect(fetch).toHaveBeenCalledTimes(1);
   const next=new DecisionSession({config:config(),client:client(vi.fn().mockResolvedValue(response())),deadline:Date.now()+5000});
   expect((await next.judge('ranking',{},questions,'baseline')).outcome).toBe('answered');
  } finally {vi.useRealTimers();}
 });
 it('uses frozen inclusive thresholds and validates exact distributions',()=>{
  expect(noul({type:'noul',noul:.2})).toBe(false);expect(noul({type:'noul',noul:.8})).toBe(true);
  expect(noul({type:'noul',noul:.20001})).toBeUndefined();expect(noul({type:'noul',noul:.79999})).toBeUndefined();
  expect(choice({type:'choice',choice:'a',probabilities:{a:.8,b:.2},confidence:.1})).toBe('a');
  expect(choice({type:'choice',choice:'b',probabilities:{a:.8,b:.2},confidence:.99})).toBeUndefined();
 });
});

describe('semantic validation and accounting recovery',()=>{
 it('does not charge a late completed transport to the shared ledger',async()=>{
  vi.useFakeTimers();try{
   const ledger=new Ledger({});const fetch=vi.fn().mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve(response()),6000)));
   const port=new TypeSafeClient({apiKey:'test',ledger,model:'jev-1.14.0'},{fetch});
   const pending=new DecisionSession({config:config(),client:port,deadline:Date.now()+5000}).judge('ranking',{},questions,'baseline');
   await vi.advanceTimersByTimeAsync(5000);await pending;await vi.advanceTimersByTimeAsync(1000);expect(ledger.entries).toHaveLength(0);
  }finally{vi.useRealTimers();}
 });
 it.each([
  {model:'other'},
  {answers:{applicable:{type:'noul',noul:NaN}}},
  {answers:{applicable:{type:'noul',noul:.9},extra:{type:'noul',noul:.9}}},
  {answers:{}},
 ])('falls back for invalid response %j',async(overrides)=>{
  const fetch=vi.fn().mockResolvedValue({...response(),json:async()=>({...await response().json(),...overrides})});
  expect((await new DecisionSession({config:config(),client:client(fetch),deadline:Date.now()+5000}).judge('ranking',{},questions,'baseline')).outcome).toBe('unavailable');
 });
 it('holds failed attempt spend and stops at eight sends',async()=>{
  const fetch=vi.fn().mockRejectedValue(new Error('unknown'));
  const session=new DecisionSession({config:config(),client:client(fetch),deadline:Date.now()+5000});
  for(let i=0;i<9;i++)await session.judge('ranking',{},questions,'baseline');
  expect(fetch).toHaveBeenCalledTimes(8);expect(session.records.at(-1)?.reason).toBe('semantic-cap');
 });
 it('retains the original request cap when the explicit cap is too small',async()=>{
  const fetch=vi.fn();const session=new DecisionSession({config:semanticConfig({modes:{ranking:'assist'},maxUsd:1e-10},true),client:client(fetch),deadline:Date.now()+5000});
  expect((await session.judge('ranking',{},questions,'baseline')).reason).toBe('semantic-cap');expect(fetch).not.toHaveBeenCalled();
 });
});

it('bounds shadow capture without network and redacts questions as well as state',async()=>{
 vi.useFakeTimers();try{
  const fetch=vi.fn(), capture=vi.fn(()=>new Promise<void>(()=>{}));
  const session=new DecisionSession({config:semanticConfig({modes:{ranking:'shadow'},maxUsd:.02},true),client:client(fetch),capture,deadline:Date.now()+5000});
  const pending=session.judge('ranking',{}, {applicable:{type:'noul',instructions:'Authorization: Bearer private-value'}},'baseline');
  await vi.advanceTimersByTimeAsync(100);expect((await pending).reason).toBe('shadow-capture-failed');
  expect(JSON.stringify(capture.mock.calls)).not.toContain('private-value');expect(fetch).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
it('navigator never retries even on explicit provider overload',async()=>{
 const fetch=vi.fn().mockResolvedValue(response(500));
 await new DecisionSession({config:config(),client:client(fetch),deadline:Date.now()+5000}).judge('navigator',{},questions,'lexical');
 expect(fetch).toHaveBeenCalledTimes(1);
});
