import { describe,it,expect } from 'vitest';
import { semanticConfig } from './config.js';
import { validateSemanticDecisions } from './evidence.js';
import { DecisionSession,validateAnswers } from './call.js';
import type { TypeSafeDecision, TypeSafeQuestion } from '../llm/typesafe.js';
describe('decision boundary contracts',()=>{
 it('defaults off and rejects implicit spend, invalid roles, keys, caps and policy',()=>{
  expect(semanticConfig().maxUsd).toBe(0);expect(Object.values(semanticConfig().modes)).toEqual(['off','off','off','off']);
  for(const value of [{modes:{ranking:'assist'}},{modes:{ranking:'assist'},maxUsd:.02},{maxUsd:NaN},{maxUsd:.021},{modes:{wrong:'off'}},{model:'jev-latest'},{policyVersion:'other'}])expect(()=>semanticConfig(value)).toThrow(/semantic\./u);
 });
 it('preserves bounded evidence and rejects malformed public records',async()=>{
  const session=new DecisionSession({config:semanticConfig(),deadline:0});
  await session.judge('ranking',{}, {},'baseline',['candidate-1']);
  const envelope={schemaVersion:'sutura-semantic-decisions-v1',records:session.records,budget:session.snapshot()};
  expect(validateSemanticDecisions(envelope,['candidate-1'])).toBe(true);
  expect(validateSemanticDecisions(envelope,['foreign'])).toBe(false);
  for(const changes of [{inputHash:'bad'},{latencyMs:NaN},{role:'other'},{suggested:['foreign']},{baseline:['candidate-1','candidate-1']},{state:'must never escape'}]) {
   expect(validateSemanticDecisions({...envelope,records:[{...session.records[0],...changes}]})).toBe(false);
  }
 });
 it('rejects malformed Choice distributions and mismatched keys before policy',()=>{
  const questions:Record<string,TypeSafeQuestion>={selection:{type:'choice',instructions:'Select.',criteria:{a:'a',b:'b'}}};
  const base:TypeSafeDecision={model:'jev-1.14.0',answers:{selection:{type:'choice',choice:'a',probabilities:{a:.9,b:.1},confidence:.9}},usage:{inTok:1,outTok:0,reasoningTok:0},usd:0,latencyMs:0,requestId:null};
  expect(validateAnswers(base,questions)).toBe(true);
  for(const probabilities of [{a:.8},{a:.9,b:.1,c:0},{a:1,b:NaN},{a:.9,b:.5},{a:.1,b:.9}])expect(validateAnswers({...base,answers:{selection:{type:'choice',choice:'a',probabilities,confidence:.9}}},questions)).toBe(false);
 });
});
