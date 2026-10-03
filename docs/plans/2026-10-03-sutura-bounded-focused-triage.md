# Bounded, focused triage

Date: 2026-10-03. Owner: Juan. Planning base: `develop` at `43bf446`
(v0.3.8 released; workspace source-path fix `26e8aa7` included). Status: plan
revised after independent review (two blockers and four material findings
resolved below); decisions D1–D7 accepted by Juan on 2026-10-03, with D1 and D3
corrected by evidence before acceptance.

## Problem and evidence

Triage decides whether a reproduced failure is real or flaky by rerunning the
**whole** triage command until a sequential test decides
(`packages/core/src/engine/triage.ts:47`, `engine/flake-confidence.ts`), in
batches of two. A real failure needs four failing probes. Nothing bounds the
sandbox time this spends: the repair budget's `elapsedTimeSec` is wall clock,
checked only before an operation is reserved
(`packages/core/src/engine/repair-budget.ts:133-152`), and probes carry no
timeout.

On 2026-10-03 the local fleet replay campaign spent USD 9.43 and 9.48 on two
chapa failures. USD 9.27 of each was four triage probes of a sharded vitest run
(229–237 sandbox seconds each); both cases then gave up. Inference cost about
USD 0.009 per case (local, untracked: `.git/sutura-fleet-replay/out/chapa-*.json`).

Two facts constrain the design (verified 2026-10-03 from those case files and
`.sutura/placebo-v0.3.8-live-artifacts/*.json`):

- **The reproduction run is not a cost proxy.** Sutura reproduces one command
  and triages another: the CLI and benchmark reproduce the case command
  (`pnpm test`; `packages/placebo/src/corpus.ts:233-236`, `heal.ts:1642,1693`)
  and triage `diagnosis.failingCmd` (`diagnose/classify.ts:272`). chapa's
  reproduction stage took 0.0012 s; its triage probes took about 231 s.
- **The benchmark triages direct vitest commands.** In the v0.3.8 benchmark,
  39 of 55 results triaged `vitest run`, resolved from the fixture's
  `scripts.test`; 8 triaged `python3 -B -m unittest discover …`; 7 triaged a
  compound `… && vitest run`. Placebo flaky fixtures key their behaviour on
  `SUTURA_TRIAGE_ATTEMPT` (for example `packages/placebo/corpus/flaky-timer-race/break.diff`),
  and `packages/placebo/src/score.ts:52-60` requires the triage `reproduced/of`
  to match the fixture's sequence.

## Decisions (accepted 2026-10-03)

- **D1 Budget.** Triage gets a cumulative sandbox-time budget, default **240
  sandbox seconds**. Triage probe 1 runs alone and is measured; before each
  further batch, `spent + probeSec × remaining ≤ budget` must hold. The worst
  case is the budget plus one probe, because no probe's cost is known before it
  runs; that bound is disclosed in the docs.
- **D2 No mislabel.** A budget stop is never `flaky`. The verdict keeps every
  probe that ran (`reproduced/of` as observed) with `stopReason:
  'sandbox-budget'` and status `not-run`; the case ends `gave-up` with a
  visible reason naming the predicted seconds, the budget and the input.
- **D3 Focused reruns** for direct runner invocations: vitest, jest,
  `node --test`, pytest. They apply to the benchmark's `vitest run` cases, so
  the benchmark is the regression oracle (D7). Package scripts, shell scripts,
  compound commands (`&&`, `;`, `|`) and `unittest` are not rewritten.
- **D4 Narrowing cannot manufacture a verdict.** A focused probe counts only if
  it exits non-zero, reports a failure of the same test id with the runner's own
  failure marker, **and** its normalized failure message matches the original
  (`errorFingerprint` of the failure block). Focus applies only when the
  original failure is test-level (a named failing test), never to collection or
  import errors. The first focused probe that passes or fails differently
  discards all focused evidence, and triage restarts on the full command, so
  `flaky` and `intermittent` only ever come from full-command probes.
- **D5 Attempt numbering.** Focused probes and the full-command restart each
  number `SUTURA_TRIAGE_ATTEMPT` from 0, exactly as today, so a restarted full
  sequence is identical to today's sequence and the Placebo flaky verdicts are
  preserved.
- **D6 Replay compatibility.** The triage policy is an optional recorded
  setting, following `repairVerificationScope`
  (`replay/replay-orchestrate.ts:172-173`, `replay/validate.ts:481-485`):
  absent means today's behaviour (full command, batches of two, no budget, no
  notes), so every existing bundle and captured fixture replays unchanged.
- **D7 Benchmark as oracle.** The release benchmark must keep flaky accuracy
  10/10, every flaky `reproduced/of` equal to the fixture sequence, zero false
  approvals and deceptive rejection 11/11. Its configuration file
  (`docs/demo/run-manifests/*-benchmark-config.json`) records the triage policy
  and therefore its `configHash`.

Out of scope (each changes statistics or behaviour and needs its own
measurement): counting the reproduction as a triage probe, focusing package
scripts or compound commands, probe timeouts, and raising the budget above
3600 seconds.

## Design

```
@ boundedTriage(executor, image, command, failedLog, policy) -> TriageVerdict
ctx: Executor (ConTree), RunResult.metrics.elapsedTimeSec
pre: policy is legacy (no budget, full) or {scope, sandboxBudgetSec}
do:
  1. compute focus = focusedTriage(command, failedLog) when scope = focused
  2. run probe 1 alone (focused when available; numbered from 0) and measure it
  3. validate same test + same failure fingerprint for a focused probe
  4. compute allowed = spent + probeSec x remaining <= budget before each batch
  5. emit not-run(sandbox-budget) with observed probes when not allowed
br: focused probe passes or differs -> drop focused probes, restart full from 0 (step 2)
fail: elapsedTimeSec missing with a budget set -> legacy triage + disclosure note
risk: worst-case spend = budget + one probe (disclosed)
```

chapa's failures used the `blob` and `github-actions` vitest reporters, and
their logs show no `FAIL <file> > <name>` lines (review evidence). Phase 2 also
reads vitest's GitHub annotations; if chapa's logs carry none, chapa ends at the
budget stop (visible and cheap) rather than being repaired, and the phase 3
report says so.

## Phases

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| [1](2026-10-03-sutura-bounded-focused-triage-phases/phase-1.md) | Cumulative sandbox budget, `sandbox-budget` stop, every consumer, recorded policy and replay compatibility | plan acceptance |
| [2](2026-10-03-sutura-bounded-focused-triage-phases/phase-2.md) | Focused probes for vitest, jest, `node --test`, pytest; same-test and fingerprint checks; restart; attempt numbering | 1 |
| [3](2026-10-03-sutura-bounded-focused-triage-phases/phase-3.md) | Release gates, benchmark, release, fleet re-pin (chapa first), observation | 2; separate release, benchmark and re-pin authorization |

Phases run in order and stop at each acceptance gate unless Juan authorizes
continuation.

## Acceptance contract

1. A failure whose measured probe 1 predicts more than the budget runs exactly
   one triage probe and ends `gave-up` with `stopReason: 'sandbox-budget'`, the
   predicted seconds, the budget and the input name, visible in the case file,
   the Markdown and HTML reports, the Action check summary and comment, and the
   `ConTree runtime:` log line. Tested with a fixture built from the captured
   chapa stage shape (probe 1 of 231.26 s), not a synthetic number alone.
2. With the legacy policy, the executor stream, verdict and outcome equal
   today's for every case (golden test) and every existing replay suite passes
   with no fixture edits.
3. Focused triage reaches `real` only from focused probes passing D4's three
   checks; a property test shows `flaky` and `intermittent` never come from
   focused probes.
4. The Placebo flaky sequences produce today's verdicts and `reproduced/of`
   under the new policy (regression test over the actual triage commands from
   the v0.3.8 artifacts), and the release benchmark meets D7.

## Stuck states and recovery

| State | Who sees what | How it ends | Test |
| --- | --- | --- | --- |
| Budget stop (`sandbox-budget`) | Maintainer: case file, reports, check summary and comment say "triage would need ~P sandbox-seconds for N more probes after one of S s; budget B; raise `triage-sandbox-seconds` or narrow the CI test command"; the gave-up guidance names the same two remedies | The next run after the input is raised or the command narrowed; nothing is cached | Phase 1: verdict, outcome, one probe, note text; one rendering test per surface |
| Budget unenforceable (metrics lack `elapsedTimeSec`, budget set) | Case file note "triage budget not enforced: the executor reported no sandbox time" | Legacy triage runs, so work is never blocked | Phase 1: executor stub without metrics |
| Focus rejected (pass, different test, different message) | Case file note "focused rerun did not reproduce <test>; triaged the full command" | Automatic restart in the same run | Phase 2: each rejection kind |
| Focus not applicable | Case file note "triage reran the full command (no focused form for <shape>)" | Today's behaviour | Phase 2: rejection table |
| Old bundle without policy | Nothing; replay uses the legacy policy and writes no new notes | Not stuck | Phase 1: replay suites + absent-policy test |

## Consumer sweep

Searched with `git grep -n -E "triage(Verdict)?\??\.status|stopReason|\.triage\b|triageN|triage\("
-- 'packages/*/src/**' 'scripts/*.mjs'` (92 lines) and
`git grep -n repairVerificationScope` for the recorded-setting precedent.

| Consumer | Change | Phase |
| --- | --- | --- |
| `core/src/domain.ts:40-51` `TriageVerdict.stopReason` | add `'sandbox-budget'` | 1 |
| `core/src/engine/triage.ts` | probe 1 alone, cumulative gate; focus in 2 | 1, 2 |
| `core/src/heal.ts:128-160` `RepairFailureContext`, `:901` `repairFailure`, `:994-1011` | add `triagePolicy`; `not-run`/`sandbox-budget` → `gave-up` (today any non-`real` → `flaky-no-patch`) | 1 |
| `core/src/orchestrate.ts:241,843,855` and `heal.ts:1712` | pass `triagePolicy` into `repairFailure` from both entry points | 1 |
| `core/src/report/format.ts:91-114` `triageSentence`, `mergeGuidance` | render `not-run`/`sandbox-budget`; budget-specific guidance | 1 |
| `core/src/report/markdown.ts:170-179` | omit Procedure and Pathology for a budget stop | 1 |
| `core/src/config.ts` | `SUTURA_TRIAGE_SANDBOX_SEC` (1–3600, default 240) | 1 |
| `core/src/replay/bundle.ts` config type and sanitizer `:419`; `replay/validate.ts`; `replay/replay-orchestrate.ts` | optional `triagePolicy`, round-trip test, absent → legacy | 1 |
| `action/action.yml`, `src/input.ts`, `src/main.ts:92-103` | input `triage-sandbox-seconds`; policy built per phase | 1, 2 |
| `action/src/evidence.ts:35` `ConTree runtime:` | `stop=sandbox-budget predicted=<P>s budget=<B>s`; `focused=<kept>/<rejected>` in 2 | 1, 2 |
| `cli/src/heal.ts:63,423,509` | same policy from config | 1, 2 |
| `case-lab/src/render.ts:232`, `src/result.ts:333` | render and accept the new stop reason | 1 |
| `placebo/src/adapters.ts:106-118` `validTriage` | accept `sandbox-budget` with observed probes | 1 |
| `placebo/src/score.ts:52-65` | flaky ratio unchanged (D5); triage efficiency counts focused probes as operations | 1, 2 |
| `placebo/src/testing/controller-recovery.test-helper.ts:114` | direct `triage` caller: pass the legacy policy | 1 |
| `scripts/fleet-dogfood-metrics.mjs:275`, `scripts/fleet-recovery-ledger.mjs:181` | record `triage.stopReason` per attempt so `sandbox-budget` stops are countable | 1 |
| `core/src/verify-execution.ts:224`, `verification/external.ts:118` | none: external verification does not call `triage` | excluded, evidence: single runtime call site `heal.ts:994` |
| `scripts/capture-run.mjs:171`, `scripts/dogfood.mjs:552` | none: fixed `triageN`; parses only preparation stops | excluded |
| `docs/user-guide.md`, `README.md` | document the input, the default, the worst-case bound and the stop | 1 |

## Verification

Red → green → refactor for every behavioural change, independent review,
repair, simplify, then sequential `pnpm run typecheck`, `pnpm run lint`,
`pnpm run test`, `pnpm run build`, `pnpm run verify:bundle` and
`pnpm run ci:local` on the exact integrated commit. Rebuild and commit
`packages/action/dist/index.cjs` with any core or action source change.

## Durable handoff

- Base: `develop` `43bf446`, clean, no worktrees; fleet on v0.3.7; Case Lab on
  v0.3.8.
- Review: one independent plan review (2026-10-03) found B1 (gate measured the
  wrong run), B2 (benchmark triages `vitest run`) and material M3–M6 (call-site
  plumbing, cumulative budget, chapa reporters, uncheckable phase 3 item); all
  resolved in this revision.
- Next: phase 1 in a worktree from current `develop`. Entry: this plan accepted;
  recheck `git status`, `git worktree list` and the `triage(` call sites
  (`heal.ts:994` at runtime; `placebo/src/testing/controller-recovery.test-helper.ts:114`
  in tests).
- Evidence limits: the USD 9.4 figure comes from local CLI runs; the Action path
  runs the same triage code (INFERRED, not measured in a fleet run). chapa is
  private: its logs and commands are not committed; tests use its stage shape
  and probe times only.

## Phase 1 handoff (2026-10-03)

Status: implemented and locally verified; awaiting Juan's acceptance. Branch
`feat/bounded-triage-phase1` from `develop` `f8a1a0b`; implementation commit
`643dc75`. `pnpm run ci:local` passed on `643dc75` (core 1978, action 166,
case-lab 227, cli 168, placebo 241, evaluation 132, guards 683/683).

- **Review findings, all resolved.** An independent review confirmed verdict
  equivalence for every exit pattern with N = 1, 2, 3, 5, 7 and that bundles
  without a policy replay unchanged. It found: the gate ran per batch, so probes
  of 1, 1, 500, 500 s could spend 1002 s against 240 (fixed: one probe at a
  time, gated before each; evaluation still only at legacy batch ends); the
  Action check summary omitted the stop (fixed); the note's numbers did not add
  up and named only the Action input (fixed: one decimal, both settings); a
  user-guide wording error (fixed).
- **Note length.** Stage notes are capped at 240 characters (`heal.ts`
  `StageLedger`); the first note was 248 and lost its remedy. It is now 210 with
  a test at extreme values.
- **Deviations.** `prepareRepair` (`engine/repair.ts:599`) also calls `triage`
  but has no runtime caller (public export and tests), so it keeps the legacy
  policy. `scripts/fleet-recovery-ledger.mjs` is unchanged: the collector's
  per-attempt events now carry `triageStopReason`, which is enough to count
  stops. Case Lab `render.ts`/`result.ts` need no change (they print and
  length-check the stop reason) and got no new test. The `ConTree runtime:`
  line keeps `stop=sandbox-budget`; the seconds are on a separate
  `Triage budget:` line. Some tests (evidence line, replay validation) were
  written after their code and passed on first run.
- **Next.** Phase 2 (focused probes) from `develop` after acceptance.

## Phase 2 handoff (2026-10-03)

Status: implemented and locally verified; awaiting Juan's acceptance. Branch
`feat/bounded-triage-phase2` from `develop` `2a51387`; implementation commit
`6103209`. `pnpm run ci:local` passed on `6103209` (core 2053, action 168,
case-lab 227, cli 169, placebo 245, evaluation 132, guards 683/683).

- **Runners.** `engine/focus/` parses vitest, jest, `node --test` (TAP and the
  default spec reporter) and pytest. Every parser is tested against real output
  captured this session: vitest 4.1.11 (default, grouped and github-actions
  reporters), jest 30.5.2, Node 24.21.0 and pytest 9.1.1, with paths rewritten
  to `/workspace` or the runner workspace; gitleaks clean.
- **Real Placebo evidence.** For all 10 JavaScript flaky fixtures, `vitest run
  case.test.js` at `SUTURA_TRIAGE_ATTEMPT` 0-4 produced the same exit sequence
  as `vitest run` and as each fixture's `triageExitCodes`, and every failing
  focused run passed the same-failure check against the fixture's first failing
  full run. Across the benchmark, focus applies only to the single-command
  `vitest run` cases; compound commands, `pnpm --filter` and Python `unittest`
  keep the full command (`placebo/src/focused-triage.test.ts`).
- **Fleet logs.** gh-glance job `110720064182` (multi-line script) and
  cirujano job `110875289871` get no focus. The plan expected cirujano's
  command to be `pnpm -r`; the observed failing command is the package script
  `pnpm run test:coverage`, rejected as not a direct runner invocation.
- **Review findings, all resolved.** A budget stop right after a focused
  restart threw (no counted attempt to evaluate); it now returns a `not-run`
  `sandbox-budget` verdict of 0/0, which Placebo `validTriage` accepts (it
  rejected 0/0 in phase 1). Fixed with real-output fixtures: jest `● Console`
  blocks taken for a test; vitest grouped failures fingerprinting the next
  header; file-only github-actions annotations (load errors) ignored. Also
  fixed: a node script before `--test` was dropped; environment values needing
  quotes; adjacent quoting and `#` comments; log paths starting with `-`; node
  test ids now include the test location; focus reads the policy-filtered log.
- **Deviations.** Focus is computed in `heal.ts` from the raw
  `diagnosis.failingCmd` and wrapped by `sandboxExecutableCommand`, like the
  full command, and passed to `boundedTriage` as a `FocusedProbe`; the plan's
  pseudocode computed it inside `boundedTriage`. The focused command for jest
  uses `--runTestsByPath <file>`. The budget note counts every probe
  (`budget.probes`), focused ones included. Residual: an unquoted glob in a
  kept option's separate value (`--ignore x/*`) is quoted in the focused
  command, so the focused probe may be rejected and triage restarts; the
  verdict is unaffected.
- **Next.** Phase 3 (release v0.3.9, benchmark, Case Lab, fleet re-pin)
  needs separate authorization.
