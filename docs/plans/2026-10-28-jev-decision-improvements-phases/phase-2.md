# Phase 2: Evaluation support and explicit qualification

Parent: [implementation plan](../2026-10-28-jev-decision-improvements.md). Baseline and invariants inherit the parent. Status: implemented and offline verified; live qualification and standalone full-run admission remain UNMEASURED. See the [handoff](../2026-10-28-jev-decision-improvements-notes.md).

## Scope and source anchors

Build a finite evaluator for these decisions, not an autonomous research service. Reuse canonical manifest/hash patterns (`packages/evaluation/src/manifest.ts:16-80`) and existing live evaluation infrastructure where compatible. `scripts/manifest-spend.mjs:15-29` is tied to live run manifests/GitHub run IDs: do not pretend it directly supports local Jev calls. Add a small local reservation journal using the existing atomic-write/process-lock pattern, without modifying the current hosted accounting format.

## Changes

Add `packages/evaluation/src/jev-decisions.ts` and tests, a finite manifest-driven `scripts/jev-decisions-eval.mjs`, and fixture tests. Default dry-run validates and prints case IDs, hashes, requested model, input categories, max attempts, reserved dollars and output paths; zero network. Live execution requires explicit `--live`, manifest path, positive `--max-usd`, and `--authorize-data` matching the manifest hash. These are execution controls, not a substitute for owner approval during agent use.

Manifest fixes exact controller SHA, corpus/input hashes, question versions, modes, model, thresholds, repetitions and train/evaluation split. Defaults: three repetitions per selected case/arm; concurrency one; maximum spend supplied by the owner, no implicit dollar allocation. Keep original sealed Placebo split untouched. Use existing public fixtures for development and new public/synthetic scenarios with independent labels held back from tuning for qualification. Record provider responses and individual errors, including missing results; no success-only denominator.

Local journal identity is manifest hash plus arm/case/repetition/role/question-policy/input-hash/attempt; this is a single-decision evaluator, not a whole-controller accounting journal. Reserve before send, settle known usage, retain unknown attempts pending and do not resend. Restart is read-only reconciliation for pending entries. A visible reconcile command accepts a documented observed charge or explicitly quarantines the full reservation; it never resets prior spend. Mock interrupted writes/network at the boundary and assert actual disk recovery.

```text
@ evaluate(manifest, authorization, journal) -> comparison
ctx: finite cases, provider, existing replay/controller harness
pre: clean exact candidate and validated input hashes
do:
  1. validate identity, split, cap and explicit live authorization
  2. lookup completed or pending attempt before any send
  3. write reservation then emit bounded request
  4. write settled usage or pending unknown cost
  5. compute all-case quality, cost, latency and abstention metrics
br: dry-run -> no provider; pending -> stop with reconciliation action
```

## Separate end-to-end comparison path

The decision evaluator reports label accuracy, cost and latency only; it cannot establish avoided sandbox work or repair yield. End-to-end qualification uses the existing local Placebo `runBenchmark` and `SuturaAdapter` (`packages/placebo/src/harness.ts:33-125`, `packages/placebo/src/adapters.ts:262-340`) with explicit per-arm CLI options. Extend that adapter's options to pass the local role flags without modifying default calls or hosted workflows. Use fresh fixture roots per arm/repetition and unchanged hidden verification. Off baseline and assist candidate use identical exact controller SHA, provider model versions, policy, corpus and repair limits; alternate arm order across repetitions. Record every controller run and aggregate by manifest/arm/case/repetition, including gave-up/infra-stop outcomes.

Do not build a second full-run dispatch/accounting system in this phase. Prepare finite local commands and consume the existing retained run outputs; execute one bounded full run at a time only under separately approved per-run inference and sandbox limits and the existing live-run recovery procedure. The owner-approved experiment manifest must enumerate both categories and a cumulative allocation before execution. Missing cost or incomplete native cancellation makes the comparison PARTIAL and stops further paid runs pending reconciliation. A pre-run controller validates remaining cumulative allocation against the full next-run reservation from existing budget evidence; if that evidence cannot bound the next run, it refuses with the existing budget/recovery action. No local Jev-only `--max-usd` value is presented as a cap on generation or sandbox spend. Phase 2 tests exercise this refusal and full-run result import with existing fixtures; remote dispatch remains excluded.

## Qualification contract

Offline correctness is required for all features. Live quality uses frozen matched cases and three repetitions; report per-case failures and uncertainty intervals, never claim population-wide safety from a small set. Initial promotion criterion is deliberately conservative: zero newly accepted deceptive patches, zero previously successful baseline cases lost in any paired repetition, no additional legitimate audit refusals, and no ignored insufficient/unknown evidence. Require at least 30 independent labeled cases per role; each case has one or more positive, negative and uncertain/adversarial variants represented across the set. Insufficient cases yields UNMEASURED, not pass.

Ranking must additionally reduce aggregate sandbox seconds or cost per verified repair by >=10%, with neither metric worse by >5% and p95 controller time no worse by >5%. Grounding must preserve relevant-evidence recall and verified repair yield while improving labeled top-3 support precision by >=10 percentage points or lowering total successful-repair cost >=10%. Classification/recovery must preserve exact-command/source authorization and labeled class/intent accuracy, preserve repair yield, and lower median role latency or inference spend >=10% without worsening p95 controller time >5%. Audit v2 qualification is evidence-only here; changing veto thresholds/model requires a later accepted decision. Navigator requires correct evidence in top three on >=90% of labeled queries, zero unsupported action/evidence IDs, and no-result on all negative queries. These thresholds are chosen acceptance criteria, not measured results.

Do not auto-enable on a passing report. Produce PASS/FAIL/UNMEASURED per role and a recommendation. Publication/default changes remain separate. A live API contract probe is required before claiming provider compatibility; fixture-only results are labeled offline.

## Behavioral oracles and work units

Tests cover cap exhaustion, identity mismatch, no authorization/no network, unknown send/no retry, journal resume, negative/uncertain labels, option-order permutations, changed corpus invalidation and fail-to-pass recovery after a new qualified run. Metric tests use fixed invented numeric inputs solely to prove denominator/calculation correctness. They cannot qualify model quality.

Evaluator pure comparison module/tests and journal CLI/tests are [batch-eligible] only after manifest contract is fixed by integration owner. Parent wires exports/scripts/docs sequentially. No live runs during implementation without separate approval.

## Phase acceptance and handoff

Automated: all phase oracles below pass, consumer sweep updated, and the parent plan's sequential local gates and coverage complete on the integrated candidate. Record failed and repaired checks, exact identity, files, decisions, unresolved external evidence and next-phase entry. Manual: owner reviews the evidence and accepts the phase; no manual operation is required for offline validation. Live measurements require a separately authorized cap and disclosed input data. Implemented/offline-tested is not live-qualified. Stop here unless continuation was explicitly authorized.
