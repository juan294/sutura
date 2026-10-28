# Phase 3: Semantic repair-frontier ranking

Parent: [implementation plan](../2026-10-28-jev-decision-improvements.md). Baseline and invariants inherit the parent. Status: planned, not implemented.

## Scope and source anchors

Add optional ordering only to eligible failing frontier nodes; preserve passing candidate admission and terminal rejection (`packages/core/src/engine/search.ts:267-276`, `packages/core/src/engine/search-score.ts:16-36`).

## Changes

Add optional async `rankFrontier(nodes)` hook to `AdaptiveSearchOptions`, wired by heal through `decisions/rank-frontier.ts`. Invoke once per depth after terminal filtering, before existing beam slicing, never for empty/singleton frontier or when a candidate already passed. Code accepts only a permutation of the supplied IDs; duplicate/missing/extra IDs cause full baseline fallback. Public evidence records baseline order, suggested order, applied mode and bounded reason codes.

For each node supply redacted original failure, complete bounded diff, observed exit/process state and relevant output. Ask Nouls for sufficient evidence, original failure still present and unrelated change; Choice identifies `same_failure | original_resolved_new_failure | unclear`. Code retains policy/passing/unpatched priorities, then uses confident original-resolved and relevant nodes ahead of confident same-failure nodes, with existing comparator for ties. If any participating node lacks sufficient evidence, fall back for the whole ranking; do not favor nodes merely because their output was missing. Never add/remove a candidate or increase beam/branch/time limits.

```text
@ rankFrontier(eligible, mode) -> ordered nodes
ctx: bounded shared decision wrapper
pre: native terminal filtering already completed
do:
  1. compute baseline ordering and supplied candidate map
  2. parse per-node judgments and validate completeness
  3. compute stable semantic ordering within native priority groups
  4. emit both orders and applied mode
br: shadow -> baseline; assist and all answers usable -> semantic order
fail: uncertainty, invalid permutation or unavailable -> baseline
```

## Behavioral oracles

Extend real `engine/search.test.ts` plus new rank-frontier tests and heal/replay integration. Fixture: verbose output from a genuinely progressing branch versus short unchanged failure; mock only TypeSafe transport and execute real search. Assert assist changes next expanded parent, shadow does not, final executable admission remains required, and policy/refused/cancelled nodes never return. Cover ties, missing output, contradictory signals, malformed IDs, deadline, exhausted semantic cap and next-run recovery. No-score path preserves existing snapshots/outcomes. Compare candidate sets before/after and assert exact equality.

## Work units

Ranking pure judgments/tests and search hook are sequential because their contract affects both; parent owns heal/replay wiring. No useful independent implementation batch in this phase. Phase 2 comparison support is reused; success claims require its live ranking gate.

## Phase acceptance and handoff

Automated: all phase oracles below pass, consumer sweep updated, and the parent plan's sequential local gates and coverage complete on the integrated candidate. Record failed and repaired checks, exact identity, files, decisions, unresolved external evidence and next-phase entry. Manual: owner reviews the evidence and accepts the phase; no manual operation is required for offline validation. Live measurements require a separately authorized cap and disclosed input data. Implemented/offline-tested is not live-qualified. Stop here unless continuation was explicitly authorized.

Shadow scheduling clarification: the pseudocode judgment steps run inline only in assist. Shadow records the baseline and bounded redacted input locally, then returns immediately; its provider comparison runs in Phase 2 outside the repair deadline. Baseline-vs-assist performance comparisons always use a no-call/off baseline, never shadow results as an exact counterfactual.
