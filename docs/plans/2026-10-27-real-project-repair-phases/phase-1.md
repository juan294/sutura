# Phase 1 — Real evidence and truthful stops

Parent: [real-project repair](../2026-10-27-real-project-repair.md). Dependencies: reviewed plan, unchanged or reconciled baseline, private incident annex available. No paid execution.

## Outcome

The recorded 60-second killed process survives decoding, replay, stage evidence and reporting. Both original identity-stop artifacts retain the stop reason during collection. Reprocessing improves observations without changing fixed/native-delivery totals or rewriting history.

## Scope and implementation

1. Freeze boundary fixtures from the two inspected incidents and exact provider response. Record original hashes, capture mode, complete/incomplete status, source/runtime identities and which fields were sanitized. Keep private source/logs private; commit only reviewed structural equivalents with the two-failure/timeout semantics intact. Do not call the existing incomplete recording a complete replay.
2. Add optional `RunResult.processState: { timedOut?: boolean; signal?: number }` and `RunMetrics.wallTimeSec?: number`. Validate values and preserve historical absence as unknown. Decode provider termination and monotonic/duration evidence at the existing ConTree boundary, with explicit source semantics. Keep existing elapsed/cost fields compatible; never derive USD from wall time.
3. Propagate optional fields through StageLedger, domain, executor memory/recorder/replay, verification recording, HTML/Markdown and relevant Case Lab validation. A provider operation may finish successfully while its process times out; keep both facts. Retain outputs and measured costs even on timeout. In this phase, update identity, triage and candidate-success consumers to reject abnormal process completion, including contradictory timedOut=true with exit 0 and killed processes containing familiar assertion text. Keep missing historical process state unknown; do not invent a successful termination flag.
4. Add explicit bounded machine-readable triage-stop metadata to the existing HTML triage element. Collector precedence: validated metadata, exact established identity-stop sentence inside the triage element for historical artifacts, legacy SPRT form, otherwise null. Never infer a stop from an error specimen or arbitrary page prose. Optional bounded private detail retains the specific explanation; public exports remain aggregate-only.
5. Use existing immutable observation append/richer-selection behavior to reparse preserved artifacts into a new derived generation. Select corrected observations by exact repository/run/attempt. Preserve raw journals, incomplete costs and prior versions. Do not perform a full fleet rescan merely to demonstrate this parser repair.

```text
@ observeExecution(providerResult, existingCase) -> observation
pre: bounded authenticated capture; historical fields may be absent
do:
  1. validate process termination and recorded wall duration
  2. write optional process evidence without inventing missing values
  3. emit explicit stop metadata and bounded visible explanation
  4. parse scoped metadata or the recognized historical triage form
  5. write a richer immutable observation keyed to the same attempt
fail: malformed evidence -> preserve raw input and disclose incomplete observation
```

## Files and work units

Sequential ownership: executor/domain/replay contract first, then report/collector integration. Shared ledger/report/domain files prevent safe simultaneous implementation. No batch unit is justified here.

Affected files: `packages/core/src/executor/{types,contree,memory,live-diagnostics}.ts`, `packages/core/src/domain.ts`, StageLedger in `heal.ts`, `replay/{validate,record-executor,replay-executor}.ts`, `report/{format,casefile,markdown}.ts`, Action acceptance/terminal evidence, failure-identity/triage and verification/candidate-success consumers, Case Lab result validation, `scripts/fleet-dogfood-metrics.mjs` and existing parser/reducer/public-export tests. Expand only for readers found in the parent consumer sweep; do not rewrite old fixture payloads.

## Behavioral oracles

Add regressions before implementation, using existing production entry functions:

- **P1-TIMEOUT:** recorded provider operation success + timed_out + signal 9 + negative exit produces retained timeout/wall evidence and costs; it cannot become a matched application failure or pass. A contradictory timeout with exit 0, or killed process with complete familiar assertion text, is rejected by both identity and fresh candidate verification.
- **P1-OLD:** old RunResult and replay fixtures without optional fields remain valid and unknown, not timedOut=false/wall=0. Existing incomplete replay stays incomplete.
- **P1-STOP:** both original identity-stop HTML structures parse failure-identity; writer → parser round trip retains reason and bounded explanation. Legacy budget/SPRT and missing-reason cases retain their old interpretation.
- **P1-INJECTION:** the identity phrase inside an error specimen, malformed/oversized metadata and unknown stop values cannot set a trusted reason.
- **P1-HISTORY:** reparsing yields richer selected evidence for the same attempt, retains originals, and leaves fixed, qualified-proposal and integrated counts unchanged. Missing provider/search evidence stays unknown.
- **P1-DISCLOSURE:** a corrupt capture or failed observation write names the exact failed boundary and recovery/rebuild action; no successful or complete report is emitted.

## Automated verification

Run sequentially; add new regression filenames explicitly to the commands during implementation:

```sh
pnpm --filter @sutura/core exec vitest run src/executor/contree.test.ts src/replay/validate.test.ts src/replay/record-executor.test.ts src/replay/replay-executor.test.ts src/domain.test.ts src/report/report.test.ts src/engine/failure-identity.test.ts src/engine/triage.test.ts src/verification/runtime.test.ts
pnpm --filter @sutura/action exec vitest run src/acceptance.test.ts src/terminal-failure.test.ts
pnpm --filter @sutura/case-lab test
pnpm --filter @sutura/core build
node --test scripts/fleet-dogfood-metrics.test.mjs scripts/fleet-recovery-ledger.test.mjs scripts/fleet-field-report.test.mjs scripts/captured-fixtures.test.mjs
pnpm run ci:local
pnpm --filter @sutura/core test:coverage
pnpm --filter @sutura/action test:coverage
```

Run all other phase-required checks selected by the changed inputs/controlling rules. Inspect private artifacts offline for P1-STOP; expose only aggregate findings in public output. No new provider run is needed.

## Manual acceptance and handoff

No manual hardware/install action is required. Independent review must verify field semantics, historical compatibility and the two real artifact interpretations. The report must distinguish provider operation completion from process termination and make timeout recovery visible. Preserve fixture hashes, failed/passing check receipts, exact candidate, consumer dispositions and corrected local observations for phase2.
