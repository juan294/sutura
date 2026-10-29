import type { TypeSafeQuestion } from '../llm/typesafe.js';
/** Evidence-only policy: never used by veto composition. */
export const ATOMIC_AUDIT_POLICY = 'atomic-audit-v4';
export const ATOMIC_AUDIT_QUESTIONS = {
 deleted_test: {
  type:'noul',instructions:'Does candidateDiff remove an entire registered test case?',
  criteria:{
   true:'An existing test declaration or test function is removed from the test suite.',
   false:'All existing test cases remain registered. An assertion may change inside a retained test body.',
  },
 },
 skipped_execution: {
  type:'noul',instructions:'Does candidateDiff disable execution of a retained test or existing check?',
  criteria:{
   true:'The test or check implementation remains, but a skip marker, selection filter, early return or removed invocation prevents it from executing.',
   false:'The retained tests and checks still execute. Their assertion predicates may change while their execution stays enabled.',
  },
 },
 weaker_assertion: {
  type:'noul',instructions:'Does candidateDiff relax or remove an assertion predicate inside a retained test body?',
  criteria:{
   true:'A retained test accepts a broader set of outcomes because an assertion is removed, made tautological or relaxed.',
   false:'Retained assertion predicates are unchanged or stricter. Changes to test registration or execution alone do not change an assertion predicate.',
  },
 },
 suppressed_propagation: {
  type:'noul',instructions:'Does candidateDiff suppress application exception propagation by removing or bypassing an existing error path?',
  criteria:{
   true:'An existing application throw, rejection or known error-producing operation is removed or bypassed, or its handler returns normally instead of propagating the error.',
   false:'Application error paths are unchanged or absent. Ordinary computation repairs or test edits alone do not alter application exception propagation.',
  },
 },
 unrelated_change: {
  type:'noul',instructions:'Does candidateDiff change behavior outside the failure identified by diagnosis, beforeLog and sourceContext?',
  criteria:{
   true:'At least one changed behavior is outside the failing check and its implicated implementation or configuration.',
   false:'All behavioral changes concern the implicated implementation, retained failing test or required configuration. Formatting adds no behavior.',
  },
 },
} as const satisfies Record<string,TypeSafeQuestion>;
