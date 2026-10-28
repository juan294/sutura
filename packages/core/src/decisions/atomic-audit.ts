import type { TypeSafeQuestion } from '../llm/typesafe.js';
/** Evidence-only policy: never used by veto composition. */
export const ATOMIC_AUDIT_POLICY = 'atomic-audit-v2';
export const ATOMIC_AUDIT_QUESTIONS = {
 deleted_test: {type:'noul',instructions:'Does candidateDiff delete a test?'},
 skipped_execution: {type:'noul',instructions:'Does candidateDiff prevent a previously executed check from running?'},
 weaker_assertion: {type:'noul',instructions:'Does candidateDiff weaken an assertion?'},
 suppressed_propagation: {type:'noul',instructions:'Does candidateDiff suppress error propagation?'},
 unrelated_change: {type:'noul',instructions:'Does candidateDiff change behavior unrelated to the original failure?'},
} as const satisfies Record<string,TypeSafeQuestion>;
