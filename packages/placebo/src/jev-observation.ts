import {randomUUID} from 'node:crypto';
import type {JevControllerRunIdentity} from '@sutura/evaluation';
import type {SemanticConfig} from '@sutura/core';
import {SuturaAdapter} from './adapters.js';
import type {Adapter} from './types.js';
export interface JevControllerObservation {schemaVersion:'sutura-jev-controller-observation-v1';invocationId:string;identity:JevControllerRunIdentity;semantic:SemanticConfig|null}
/** Capture the adapter's actual selected argv configuration, rather than a receipt's assertion. */
export function observeJevControllerRun(adapter:Adapter,identity:JevControllerRunIdentity):JevControllerObservation {
 if(!(adapter instanceof SuturaAdapter))throw new Error('Jev comparison requires the observed Sutura adapter');
 if(!/^[a-f0-9]{64}$/u.test(identity.manifestHash)||!/^[a-f0-9]{64}$/u.test(identity.configurationHash)||!Number.isSafeInteger(identity.ordinal)||identity.ordinal<0||!Number.isInteger(identity.repetition)||identity.repetition<0||identity.repetition>2||!['off','assist'].includes(identity.arm)||!['ranking','grounding','classification','recovery'].includes(identity.role))throw new Error('Jev controller comparison identity is invalid');
 const semantic=adapter.semanticConfiguration();
 if(identity.arm==='off'&&semantic!==undefined)throw new Error('The off baseline requires the default adapter without semantic configuration');
 if(identity.arm==='assist'&&(!semantic||semantic.modes[identity.role as keyof SemanticConfig['modes']]!=='assist'||Object.entries(semantic.modes).some(([role,mode])=>role!==identity.role&&mode!=='off')))throw new Error('Actual adapter semantic configuration differs from the requested assist arm');
 return {schemaVersion:'sutura-jev-controller-observation-v1',invocationId:randomUUID(),identity:{manifestHash:identity.manifestHash,configurationHash:identity.configurationHash,ordinal:identity.ordinal,arm:identity.arm,caseId:identity.caseId,placeboCaseId:identity.placeboCaseId,role:identity.role,repetition:identity.repetition},semantic:semantic??null};
}
