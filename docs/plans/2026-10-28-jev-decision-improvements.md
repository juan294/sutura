# Jev decision improvements: six-phase implementation plan

Date: 2026-10-28. Planning baseline: `develop`, `969bd68b08c973c3a16f00bb2b67dc19c6300a6d`, `/Users/juan/code/sutura`. Source remains unchanged from the accepted research. The three October 28 Jev research artifacts are untracked intended work and must be preserved. User confirmed all six phases during planning. This document specifies implementation; it does not start it or authorize live experiments/publication.

## Objective and evidence

Improve repair efficiency and developer comprehension by using bounded semantic judgments, while preserving executable verification, exact-source evidence and human authority. Accepted inputs: [research](../research/2026-10-28-jev-capabilities-research.md), [assessment](../research/2026-10-28-jev-opportunities-assessment.md), [external source catalog](../research/2026-10-28-jev-source-catalog.md), all read during planning. External contract snapshot is October 28; implementation must inspect current API schema before changing request types.

The current optional audit bundles five questions but uses only the verdict distribution for its veto (`packages/core/src/audit/typesafe-audit.ts:43-141`). Search ranks eligible branches with normalized output-line counts and patch size (`packages/core/src/engine/search-score.ts:16-36`); classification follows baseline reproduction (`packages/core/src/heal.ts:1098-1116`). These are concrete insertion points, not proof of expected gains. Historical sandbox cost was about 86% of total (`docs/demo/sutura-v0.4.1-release-benchmark-evidence.md:44`).

## Resolved design choices

1. Retain the custom HTTP client and Choice/Noul primitives. Do not add SDK, Score, Box, images, long context, a generic agent framework or a new service. Choice/Noul suffice for this plan's closed sets; use categorical progress rather than pretending to compute numerical correctness.
2. Preserve current audit veto semantics and legacy request bytes. Add typed presentation/provenance and a separately versioned experimental question set. New experimental roles request pinned `jev-1.14.0`; legacy audit remains its current request/model policy until a separately authorized comparison qualifies migration. Record requested and resolved model and policy hash. A mismatched resolved model makes a new-role answer unavailable. Model version and question wording are inputs to qualification, not labels that can be changed silently.
3. New core roles have explicit `off | shadow | assist` modes per role (`ranking`, `grounding`, `classification`, `recovery`). Defaults are off. Shadow collects bounded decision inputs locally and records the baseline choice without making inline provider calls; Phase 2 evaluates those inputs after completion into a separate sidecar. It preserves baseline decisions and avoids spending the repair deadline on speculative calls. Assist changes only the bounded behavior stated in its phase. No automatic promotion, hosted rollout, persisted approval receipt or default activation. Assist is exposed for local, explicitly selected experiments; recommending routine use requires Phase 2 evidence. Existing audit remains independently configured.
4. Introduce one small shared decision-call wrapper with typed outcome `answered | uncertain | unavailable | disabled`, role, policy version/hash, input hash, requested/resolved model, usage/cost, latency, reason and fallback. No raw secrets or full state in public records. Shadow inputs are redacted, bounded, opt-in local evaluation files with mode 0600, excluded from public case/replay artifacts; their hashes bind sidecar suggestions. No outbound request occurs merely because capture is enabled. No persistent semantic cache. Use existing TypeSafe recording boundary and exact replay; optional new configuration absent in legacy bundles selects legacy behavior with all new roles off (`packages/core/src/replay/bundle.ts:68-142`).
5. Bound each new decision call to min(5 seconds, remaining controller deadline), at most one retry inside that deadline only after an explicit HTTP 429/5xx response; transport timeout or unknown completion is never resent automatically. New-role wrapper owns attempts using a single-attempt transport mode; legacy client defaults remain unchanged. Across a repair, new semantic roles share a separately accounted USD 0.02 maximum and eight provider attempts, default spend authorization zero when all roles are off. Reserve worst-case input cost before each attempt; failed/unknown consumption retains its reservation. Never consume audit/challenge reserves or extend total repair time. Limit serialized state plus questions to 24 KiB UTF-8, at most 32 supplied candidates, and 255 options per question. Reject oversized required evidence rather than slicing a diff mid-change. The navigator uses at most one decision request, USD 0.002 maximum, and the same deadline. These are conservative implementation limits, not measured optimal settings.
6. New role uncertainty rule: Noul >=0.8 means true, <=0.2 means false, and (0.2,0.8) means uncertain; top Choice probability must be >=0.8 with margin >=0.2; otherwise baseline fallback. Applicability/sufficiency must be true. Any uncertain required field or contradictory Choice/Noul combination falls back as a whole; ties use deterministic existing ordering. Ranking `original_resolved_new_failure` requires original-present=false and unrelated=false; `same_failure` requires original-present=true and unrelated=false; all other combinations fall back. Grounding excludes only relevance=false with support=insufficient; relevance=false with supports/contradicts is a conflict and preserves the original set. Classification/recovery require applicability=true and valid exact candidate membership, otherwise their existing fallback. Navigator requires applicability=true and selected evidence membership, otherwise no-match or unavailable as appropriate. These fixed initial rules are for experiments, not claims of calibration. No substitution into `Diagnosis.confidence` or existing model-tier thresholds. Preserve the old audit's 0.7/0.5 policy until its separate measured migration.
7. Keep control fields `AuditVerdict.approved` and `checks[].passed`; add optional metadata, never derive authority from display strings. Old TypeSafe rows without metadata show NOT RECORDED rather than infer a completed review. Preserve historical JSON/HTTP fixture bytes; new fixtures exercise new metadata. Update all consumers in the [sweep](2026-10-28-jev-decision-improvements-phases/consumer-sweep.md).
8. CLI is the initial new-feature delivery surface. Add explicit local heal options for role modes and the shared cap; supply new config through core DI and record it in replay. GitHub Action inputs, hosted Case Lab dispatch and setup-generated workflow options do not expose new roles in this plan; they retain off defaults. Shared reports still show new evidence when present. This keeps implementation reviewable without a fleet rollout.
9. Keep `assess` provider-free, flake decisions execution-based, source/URL validation deterministic, Nemotron generation and mandatory verification unchanged. No CI cadence changes. Defer incident memory/grouping, learned routing, visual checks and concurrent audit scheduling: they are later alternatives, not missing phase work.

## Alternatives considered

| Option | Disposition |
| --- | --- |
| Replace runtime diagnosis/repair with Jev | Rejected: closed-set judgments cannot generate repairs; changes would exceed the evidence. |
| Turn all optional judgments on immediately | Rejected: adds latency, cost and failure modes before measuring benefit. |
| Deterministic-only improvements | Retained as baseline and fallback; status presentation needs no inference. |
| Adopt vendor SDK or broad scoring framework | Deferred: custom client already integrates accounting/replay; no required capability justifies migration. |
| Six bounded phases with local opt-in and paired evaluation | Selected; user confirmed all six phases. |

## Phase sequence and gates

| Phase | Deliverable | Dependencies |
| --- | --- | --- |
| [1](2026-10-28-jev-decision-improvements-phases/phase-1.md) | Audit status/provenance, versioned bounded calls, legacy compatibility | Baseline + accepted plan |
| [2](2026-10-28-jev-decision-improvements-phases/phase-2.md) | Reusable bounded evaluation runner and comparison report | Phase 1 |
| [3](2026-10-28-jev-decision-improvements-phases/phase-3.md) | Optional semantic repair-frontier ranking | Phase 2 |
| [4](2026-10-28-jev-decision-improvements-phases/phase-4.md) | Optional grounding relevance and support labels | Phase 3 accepted; uses Phase 1 contracts |
| [5](2026-10-28-jev-decision-improvements-phases/phase-5.md) | Typed classification evidence and recovery selection | Phase 4 accepted |
| [6](2026-10-28-jev-decision-improvements-phases/phase-6.md) | Local developer evidence navigator and final documentation | Phase 5 accepted |

Stop after each phase unless the owner explicitly authorizes continuation. Within a phase: TDD → independent review → repair → simplify → verification → local integration into develop. Work in isolated local worktrees/temporary branches; one integration owner. Batch units must have disjoint files and no dependency on each other's output; phase files define eligible units. No working branch publication/PR creation.

## Automated verification for every implementation phase

Write behavioral failing tests first, naming a mutation that makes each fail. Mock provider/clock boundaries only; execute owned controller and validators. Run targeted tests during implementation. After integration run sequentially: `pnpm run ci:local`, `pnpm --filter @sutura/core test:coverage`, `pnpm --filter @sutura/action test:coverage`. Aggregate exit status; do not erase failures. `ci:local` includes typecheck/lint/build/test/package/guard checks; do not rerun overlapping gates without changed inputs or a failure. Rebuild the committed Action bundle through the repository build and include any required bundle changes with source. Record exact tested SHA/tree and coverage; no arbitrary coverage threshold reduction. No provider credentials should be used by offline checks; explicitly disabled live-test flags must stay disabled.

Local acceptance means functional behavior, fallback, replay and packaging tests pass. It does not mean provider quality, speed or usability passed. Public claims use the separate empirical criteria in Phase 2. Read-only planning checks are document/reference checks, not these product gates.

## Stuck states and recovery

| State | Who sees what | Exit / visible next action | Proof obligation |
| --- | --- | --- | --- |
| Role off or key missing | CLI/report: DISABLED or UNAVAILABLE and baseline retained | Explicit role selection/configuration on next run; never read unrelated credentials | Off path makes zero provider calls; key restored next invocation works |
| Provider timeout, 429/5xx, malformed answer, unexpected model | Typed reason, attempted cost and named fallback | Bounded retry only; next invocation can recover; no cached error | Fake-clock deadline/cancellation and fail-then-success tests |
| Cap/deadline exhausted or unknown spend | Role unavailable, cap/remaining budget shown | Continue baseline if its existing budget permits; otherwise retain current terminal outcome and displayed budget action | Reservation cannot be reused; subsequent eligible run with a fresh authorized budget works |
| Missing/oversized evidence, invalid candidate, low confidence | UNCERTAIN/UNAVAILABLE, evidence needed and fallback | Smaller relevant input or existing diagnostic path; no silent certainty | No mutation of baseline result; complete later input produces usable result |
| Optional audit uncertain/skipped/refused | Accurate label in all five renderers; primary verdict remains separate | Uncertain/skipped continue existing other gates; refusal records offending evidence for patch revision | Each status matrix plus refusal followed by corrected candidate |
| Legacy/malformed replay | Old bundles replay unchanged; malformed new config fails with field and reason | Use original compatible bundle or regenerate a new recording; no live fallback | Legacy fixture byte hashes stable; malformed input error includes recovery action |
| Evaluation lacks authorization or has pending unknown spend | Dry-run/pending report shows exact missing input/account path | Supply an explicit manifest/cap/authorization, or reconcile the existing attempt; never blind resend | Zero network without live authorization; interrupted attempt blocks retry with visible instruction |
| Evaluation quality gate fails | FAIL/UNMEASURED with failed metric, no promotion | Keep role off/shadow; revise on development split, then request a new measurement | Failed comparison never reports ready or changes config |
| Navigator no match, invalid file, unsupported schema | Exit/result distinguishes no evidence, invalid input, provider unavailable | Select valid case file, inspect listed sections, or use lexical results | Invalid input makes zero network; no-match never invents an action |

Each phase adds the state-specific cases below. Safety tests alone are insufficient; assert the public recovery text and an actual recovery path or explicit disclosure.

## Consumer sweep

The companion [consumer sweep](2026-10-28-jev-decision-improvements-phases/consumer-sweep.md) records exact commands and per-file dispositions, including fixtures and scripts. Refresh those searches when implementing a changed shared contract; newly found callers must receive a phase or an explicit exclusion. Preserve historical fixtures; synthetic helpers must produce both old and new forms. No schema-reader may silently discard new typed status or role configuration.

## Handoff and acceptance boundary

Planning source baseline is unchanged. Graphify was queried, then source and accepted research were inspected. Independent read-only assignments cover audit/config/replay consumers and search/diagnosis/CLI seams; a separate reviewer checks the completed plan. Review results and document checks are recorded in the [review note](2026-10-28-jev-decision-improvements-phases/review.md). The independent reviewer rechecked all four material findings after repair and returned PASS; this is planning evidence only. No live inference, product tests, code changes, new credentials or hosted actions were performed during planning.

No material design question is deferred: model, limits, modes, fallback, delivery surface, exclusions and phase gates are specified. Live experiment authorization is a later execution prerequisite, not assumed approval or an unresolved design choice. On resume verify HEAD/status and preserve research/plan artifacts; use the current source to refresh changed references. Next authorized workflow is Phase 1 implementation only after owner acceptance/instruction. No implementation has begun.
