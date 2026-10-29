# Phase 5: Typed diagnosis and bounded recovery choices

Parent: [implementation plan](../2026-10-28-jev-decision-improvements.md). Baseline and invariants inherit the parent. Status: implemented and offline-verified; live quality/performance UNMEASURED. See the parent implementation notes for aggregate exact-candidate receipts and retained failures.

## Scope and source anchors

Use new healing-only wrappers; preserve direct classifier behavior, audit-only and provider-free CLI diagnosis (`packages/core/src/diagnose/classify.ts:224-307`). Existing recovery options and grants remain authoritative (`packages/core/src/diagnose/hypotheses.ts:55-86`, `:165-245`).

## Changes

Classification state uses controller-extracted error spans, existing nine failure classes, observed command and exact taxonomy signals. Choice selects class and span ID; Noul requires sufficient evidence. Mechanical command always wins; code copies the selected verbatim span. In assist, use typed result only when class agrees with mechanical taxonomy and selected span passes existing grounding guards. Set `Diagnosis.confidence` to the existing mechanical value, not Jev probability; ambiguous or disagreeing results call the existing classifier. Typed signals are fixed controller strings, not generated explanations. Shadow executes only the existing classifier inline and captures the comparison input; Phase 2 computes the Jev comparison after completion. No change to tier-routing thresholds or pre-reproduction order.

Recovery retains deterministic fast path. Only replace the existing generative fallback selection with typed supplied source/signal/intent candidates when assist is explicit and answers are usable; retain at most two proposals, existing probe IDs, source hashes, source reads and grants. Jev cannot create source paths, commands, intents or authorization. Failure invokes the existing fallback only within remaining budget and deadline; exhausted budget keeps the existing terminal result with visible reason.

```text
@ typedDiagnosisOrFallback(observation, mode) -> Diagnosis
ctx: mechanical parser, current classifier, bounded judgment
pre: baseline reproduction and failure identity already valid
do:
  1. compute mechanical facts and exact candidate spans
  2. parse typed class/span and sufficient-evidence answer
  3. validate agreement and verbatim grounding
  4. emit typed provenance separate from Diagnosis confidence
br: assist and valid -> mechanical-grounded result; else -> existing classifier
fail: no remaining fallback budget -> existing explicit budget-stop outcome
```

## Behavioral oracles

Tests for each failure class, multi-failure logs, no command, quoted commands, ungrounded span, unknown option, injected log instruction, uncertain class, exact confidence preservation and no fresh read on disabled paths. Recovery tests cover wrong source hash, stale grant, unknown probe ID, duplicate/too-many proposals, refused permission and fallback success. Real heal integration must show no command/authority change and no type-based skip of reproduction or final verification. Legacy direct API tests remain unchanged. Paired Phase 2 tests distinguish classifier latency from full controller time.

## Work units

Classification wrapper/tests and recovery selector/tests are [batch-eligible] after shared contracts; one owner for each new file set. Parent alone edits shared heal/hypotheses/config integration and replay. Do not parallelize shared caller edits.

## Phase acceptance and handoff

Automated: all phase oracles below pass, consumer sweep updated, and the parent plan's sequential local gates and coverage complete on the integrated candidate. Record failed and repaired checks, exact identity, files, decisions, unresolved external evidence and next-phase entry. Manual: owner reviews the evidence and accepts the phase; no manual operation is required for offline validation. Live measurements require a separately authorized cap and disclosed input data. Implemented/offline-tested is not live-qualified. Stop here unless continuation was explicitly authorized.

Shadow scheduling clarification: the pseudocode judgment steps run inline only in assist. Shadow records the baseline and bounded redacted input locally, then returns immediately; its provider comparison runs in Phase 2 outside the repair deadline. Baseline-vs-assist performance comparisons always use a no-call/off baseline, never shadow results as an exact counterfactual.
