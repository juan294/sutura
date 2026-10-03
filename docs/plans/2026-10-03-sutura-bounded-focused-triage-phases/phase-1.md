# Phase 1 — Cumulative sandbox budget and the `sandbox-budget` stop

Parent: [Bounded, focused triage](../2026-10-03-sutura-bounded-focused-triage.md).
Depends on plan acceptance. Owner: Sutura core.

## Change

```
@ triage(executor, image, command, N, observe, policy) -> TriageVerdict
ctx: Executor; RunResult.metrics.elapsedTimeSec
pre: policy legacy, or {scope, sandboxBudgetSec in 1..3600}
do:
  1. run probe 1 alone (SUTURA_TRIAGE_ATTEMPT=0) and measure probeSec
  2. compute allowed = spent + probeSec x (N - attempts) <= budget
  3. run the next batch (two probes, numbered as today) only when allowed
  4. emit not-run(sandbox-budget) with the observed exit codes when not allowed
br: legacy policy -> today's loop exactly (batches of two, no measurement, no notes)
fail: budget set but elapsedTimeSec missing -> today's loop + "budget not enforced" note
```

- `TriageVerdict.stopReason` gains `'sandbox-budget'`; the verdict keeps the
  observed `reproduced/of/attemptsUsed` (≥ 1) with status `not-run`, so the
  existing `not-run` invariant (`of = 0`) is relaxed only for this stop reason.
- `TriagePolicy = { scope: 'focused' | 'full'; sandboxBudgetSec?: number }`;
  `RepairFailureContext.triagePolicy` (`heal.ts:128-160`) is passed from
  `orchestrate.ts:843` and `heal.ts:1712`; absent = legacy. In this phase the
  Action and CLI build `{ scope: 'full', sandboxBudgetSec }`.
- `heal.ts:1010`: a `sandbox-budget` verdict ends `gave-up` with the ledger note
  `Triage stopped: one probe took S sandbox-seconds; N more would bring triage to P, over the budget of B (raise triage-sandbox-seconds or narrow the CI test command)`.
  Other non-`real` verdicts keep `flaky-no-patch`.
- Config `SUTURA_TRIAGE_SANDBOX_SEC` (integer 1–3600, default 240); Action input
  `triage-sandbox-seconds`.
- Replay: `ReplayOrchestrationConfig.triagePolicy?` written by the recorder
  (sanitizer at `replay/bundle.ts:419`), validated (two scopes, integer 1–3600),
  and passed as `configuration.triagePolicy ?? legacy` by `replay-orchestrate.ts`.
- Surfaces: `report/format.ts:91-114` and `mergeGuidance`;
  `report/markdown.ts:170-179` (no Procedure/Pathology for a budget stop);
  `action/src/evidence.ts:35`; Case Lab `render.ts:232` and `result.ts:333`;
  Placebo `validTriage`; fleet scripts record `triage.stopReason`.
- `placebo/src/testing/controller-recovery.test-helper.ts:114` passes the legacy
  policy explicitly.
- Docs: user guide and README input table, including the worst case (budget plus
  one probe).

`[batch-eligible]` The docs update is file-disjoint and can be drafted in
parallel by a second owner; one integration owner merges.

## Tests (red first)

- `engine/triage.test.ts`: a 231.26 s first probe (chapa's captured stage
  shape) with budget 240 runs exactly one probe and returns `sandbox-budget`;
  2 s probes reach the same verdict as today; cumulative accounting across
  batches; legacy policy reproduces today's exact executor calls; missing
  metrics with a budget → legacy loop plus note; missing metrics without a
  budget → no note.
- `heal` integration via recorded executor: outcome `gave-up`, stop reason,
  ledger note, one `SUTURA_TRIAGE_ATTEMPT` command.
- Golden: for every Placebo flaky sequence (actual triage commands from the
  v0.3.8 artifacts), the new full-scope policy yields today's verdict and
  `reproduced/of`.
- Replay: all existing replay suites with no fixture edits; absent-policy test;
  `triagePolicy` round-trip through the recorder sanitizer; validation rejects
  an unknown scope and out-of-range budgets.
- Rendering: one test per surface listed above; Placebo `validTriage` and
  `score.ts`; fleet script fixture records the stop reason.
- Config and Action input bounds.

## Acceptance

Automated: the tests above, full `pnpm run test`, `pnpm run ci:local` on the
integrated commit, `verify:bundle` with the rebuilt Action bundle.

Manual: read one rendered `sandbox-budget` case file, Markdown report and check
summary; confirm the message and guidance name the input and both remedies.
