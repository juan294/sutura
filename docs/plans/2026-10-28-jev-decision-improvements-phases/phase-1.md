# Phase 1: Audit and decision-call foundation

Parent: [implementation plan](../2026-10-28-jev-decision-improvements.md). Baseline and invariants inherit the parent. Status: planned, not implemented.

## Scope and source anchors

Preserve current policy while making its evidence accurate and new calls reproducible. Existing contract: `packages/core/src/domain.ts:96-104`; TypeSafe client at `packages/core/src/llm/typesafe.ts:65-80`; veto composition at `packages/core/src/audit/veto-voices.ts:25-37`; exact replay request matching at `packages/core/src/replay/replay-fetch.ts:146-155`.

## Changes

Add optional check metadata with explicit audit status and provenance (requested/resolved model, question-policy version/hash). Keep control booleans unchanged. All five renderers use metadata for labels: APPROVED, REFUSED, UNCERTAIN, SKIPPED, NOT RECORDED; APPROVED means this voice's judgment, not total repair acceptance. Mechanical checks retain PASS/FAIL. Do not parse free-text legacy evidence for status. Update Case Lab validation and public-safe serialization.

Create a small `decisions/` module for the new-role config, policy constants, bounded call wrapper and typed evidence. Keep audit compatibility entry points. Version the existing audit questions as legacy-v1 without changing request bytes; define experimental atomic-audit-v2 as evidence-only: separate single-property questions for deletion, skipped execution, weaker assertion, suppressed propagation and unrelated change. It cannot change veto policy in this plan. New results record both legacy decision and experimental evidence when explicitly requested by the evaluator.

Implement main-plan deadlines, probability validation, caps and replay config. Add a single-attempt transport mode to the existing client for new-role calls; the wrapper alone reserves and schedules any allowed explicit-response retry. Preserve old callers' retry defaults. Test actual fetch count: maximum two on explicit 429/5xx; exactly one on timeout or unknown completion; zero after deadline/cap. Reserve conservatively using UTF-8 request bytes as the upper bound for input tokens at the pinned price; check state plus questions against the 24 KiB cap. Add optional `CaseFile.semanticDecisions` with schemaVersion `sutura-semantic-decisions-v1` and bounded records; validate role IDs, finite numbers, hash formats and existing candidate/source references before rendering. Add optional replay semantic config and budget snapshot fields with absence meaning disabled/zero. Shared validation/serialization must retain metadata, and Case Lab result hashes must cover it. Keep old shape/hash behavior when absent. Public evidence contains hashes and bounded reason codes rather than raw input state. Add local heal flags `--jev-ranking`, `--jev-grounding`, `--jev-classification`, `--jev-recovery` accepting off/shadow/assist and `--jev-budget-usd` within 0..0.02. Non-off requires positive explicit cap and a configured key; invalid configuration is a usage error before provider work. Persist exact modes/model/policy IDs in new replay configuration. Old bundle absence selects old audit and no new roles. Replay must never access live providers. Keep hosted Action inputs and workflow generation unchanged.

```text
@ judge(role, state, questions, limits) -> DecisionEvidence
ctx: TypeSafe client, ledger, clock, recorder
pre: explicit role mode and validated candidate IDs
do:
  1. validate state size, policy, deadline and remaining cap
  2. compute input hash and reserve attempt cost
  3. parse bounded provider result and validate exact answer keys
  4. emit typed provenance, outcome and fallback reason
br: insufficient evidence -> uncertain; invalid provider result -> unavailable
fail: disabled -> no request; timeout -> cancel and retain reservation
```

## Behavioral oracles

Extend `llm/typesafe.test.ts`, `audit/typesafe-audit.test.ts`, `verification/runtime.test.ts`, `audit-only.test.ts`, config/repair-budget/replay tests. Reject NaN, extra/missing Choice options, distributions outside [0,1] or sum differing from 1 by >1e-6, unknown selected option and mismatched answer keys. Assert late completion cannot overwrite timeout or spend twice. Reserve retry separately; follow the parent truth table including confident false <=0.2 and contradictory-answer fallback. Boundary tests cover exactly 0.2/0.8, both sides of each, and conflicting Choice/Noul values. Correct valid follow-up succeeds after prior timeout in a new authorized invocation.

Status matrix covers all five renderers identified in consumer sweep, including reduced-assurance audit. Mutation oracle: changing skipped label to PASS must fail; changing skipped control boolean must also fail an authority test. Missing metadata remains accepted but shown NOT RECORDED. Legacy recordings keep original bytes and replay output authority; new recordings preserve requested policy, model and mode. Failure messages identify fields and recovery instructions.

## Work units

Sequential owner for client/config/budget/replay/type changes. After these contracts land, core report renderers/tests and Case Lab renderer/validator/tests are [batch-eligible] in separate worktrees with disjoint files. Integration owner alone changes shared exports and bundle. No parallel full-suite runs.

## Phase acceptance and handoff

Automated: all phase oracles below pass, consumer sweep updated, and the parent plan's sequential local gates and coverage complete on the integrated candidate. Record failed and repaired checks, exact identity, files, decisions, unresolved external evidence and next-phase entry. Manual: owner reviews the evidence and accepts the phase; no manual operation is required for offline validation. Live measurements require a separately authorized cap and disclosed input data. Implemented/offline-tested is not live-qualified. Stop here unless continuation was explicitly authorized.
