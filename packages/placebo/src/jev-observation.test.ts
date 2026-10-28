import {describe,it,expect} from 'vitest';
import {semanticConfig} from '@sutura/core';
import {SuturaAdapter,DummyAdapter} from './adapters.js';
import {observeJevControllerRun} from './jev-observation.js';
const identity={manifestHash:'a'.repeat(64),configurationHash:'b'.repeat(64),ordinal:0,arm:'off' as const,caseId:'ranking-case',placeboCaseId:'repair-off-by-one',role:'ranking' as const,repetition:0};
describe('observed benchmark arm identity',()=>{
 it('records actual adapterconfiguration and generates an independent invocation identity',()=>{
  const first=observeJevControllerRun(new SuturaAdapter(),identity),second=observeJevControllerRun(new SuturaAdapter(),identity);
  expect(first.semantic).toBeNull();expect(first.identity).toEqual(identity);expect(first.invocationId).not.toBe(second.invocationId);
  const semantic=semanticConfig({modes:{ranking:'assist'},maxUsd:.02},true);
  const assist=observeJevControllerRun(new SuturaAdapter({semantic}),{...identity,arm:'assist'});expect(assist.semantic).toEqual(semantic);
 });
 it('rejects off-as-assist, assist-as-off, and unobserved generic/control adapters',()=>{
  expect(()=>observeJevControllerRun(new SuturaAdapter(),{...identity,arm:'assist'})).toThrow(/configuration/u);
  expect(()=>observeJevControllerRun(new SuturaAdapter({semantic:semanticConfig({modes:{ranking:'assist'},maxUsd:.02},true)}),identity)).toThrow(/off/u);
  expect(()=>observeJevControllerRun(new DummyAdapter(),identity)).toThrow(/Sutura/u);
 });
});
