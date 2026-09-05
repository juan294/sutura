# Verified repair program implementation deviations

Plan: `2026-09-05-sutura-verified-repair-program`.

## Deviations

### Phase 1: preserve the frozen benchmark selection

Plan said to add a versioned pagination case and version expanded scoring semantics. Found that the existing benchmark manifest hashes a fixed 51-case selection. Chose to include versioned cases through an explicit corpus-loader selection while retaining the legacy default; self-check includes the expanded selection. This preserves historical hashes and prevents the new oracle from silently changing the old denominator. Phase 6 owns the separately versioned expanded evaluation scores.

### Phase 1: unknown terminal identities

Plan said every new result binds snapshot, diff and image digest. Found that early terminal outcomes may have no candidate or snapshot, and the executor's imported image identifier is not a verified digest. Chose explicit null values for these unknown identities on nonaccepted terminal evidence; accepted evidence requires all three exact identities. This avoids fabricated provenance while preserving strict acceptance requirements. The later provider preflight must establish an actual image digest before provider-backed v1 acceptance.

### Phase 2: completion-aware syntax subset

Plan allowed narrowly inserted async/await syntax on existing operations and setup. Found that preserving syntax alone can detach callbacks, suppress assertions through predicates, or change indirectly computed expectations. Chose direct imported Vitest test callbacks and direct `unittest.IsolatedAsyncioTestCase` test methods, with straight-line supported assertion/setup positions and conservative binding checks. Unsupported callbacks, control flow, assertion bindings and Python dispatch overrides abstain. Existing asynchronous syntax does not establish that a test runner waits for a callback.

### Phase 2: bounded investigation and protected completion capacity

Plan requested recovery for competing diagnoses and reserved subsequent verification without raising existing budgets. Found that hypotheses without a recognized promise/coroutine/setup/strictness observation cannot justify any supported grant, and unbounded audit requests can consume all default inference capacity. Chose to investigate only recognized observed signals, retain unsupported interpretations as explicit abstentions, reserve a complete priced repair plus 30 seconds and two bounded audit turns plus 60 seconds, and reject audit requests exceeding 32,000 serialized request bytes, including response schemas. Initial diagnosis and reproduction consume the same run budget. These conservative limits may reduce attempts; they do not establish measured model-quality improvement.

### Phase 2: captured excerpts and executed controls

Plan requested captured-log replay coverage for the historical give-ups. Found that the retained September 5 artifact contains the five diagnoses and bounded error excerpts rather than complete raw failure logs. Chose to hash-bind and compare those exact captured records, while executing clean, broken, repaired and deceptive fixture branches through the real local controller with fresh process output. These are captured diagnostic excerpts plus independently executed controls, not a replay of unavailable complete historical logs.

### Phase 2: historical executor contract drift

Plan retained historical replay identity while extending run-wide budget and cancellation enforcement. Found that per-operation reservations replace the old triage `runMany` boundary with individually identified `run` calls. Chose stable run-scoped operation identifiers for new exact replays and explicit contract-drift rejection for the two historical dogfood bundles, which already rejected later report drift before this phase. Their stored bytes and outcomes remain unchanged; replay comparisons are not relaxed to accept the new execution contract against an old recording.
