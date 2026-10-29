# Real-project repair: from native failure to useful delivery

Date: 2026-10-27. Status: complete and independently reviewed; long-verification design confirmed by the owner; ready for plan acceptance. Baseline: `develop` at `82f0554dbad8ad3a9febfc77867ea1ce64e15430`, equal to `origin/develop` at planning entry. Existing uncommitted input: [usefulness assessment](../research/2026-10-27-real-project-usefulness-assessment.md). Planning does not authorize implementation, execution, publication, consumer changes or spending.

## Objective

Make a real supported incident produce a correct repair PR with complete native verification, then check another independent incident. A controlled benchmark pass, a correctly classified stop, and a useful repair are separate results. This plan closes the concrete admission, execution, evidence and delivery gaps found in the assessment. It does not promise a fleet-wide repair rate or success before a calendar deadline.

The immediate scope is four sequential phases. It supersedes remaining effectiveness work in the [October 25 plan](2026-10-25-fleet-incident-recovery.md), while reusing its implemented identity, policy, observation, publication and native-qualification contracts. It does not reopen onboarding, weekly email, external recruitment, Data Lab or executor replacement. The owner removed the old 72-hour pilot prerequisite; this plan adds no waiting period or minimum experiment count.

## Evidence and refinements

The assessment records 101 attempts in the collected October 20–27 window: zero recorded fixed outcomes, with 72 records reporting no provider invocation. Collection is PARTIAL and spans historical Action versions; this is not a v0.4.1 effectiveness estimate. Private run identities and source captures remain outside public documents.

Planning resolved additional facts:

| ID | Verified finding | Design consequence |
| --- | --- | --- |
| REAL-01 | Both Action orchestration and local healing prepare execution before rejecting the observed CI control command: `packages/core/src/orchestrate.ts:773`, `packages/core/src/heal.ts:1814`. | Cover both entry paths and changed-command fallback. Reject positively identified control checks before image import, after inexpensive runtime inspection. |
| REAL-02a | The recorded provider response contains `timed_out=true`, signal 9, an explicit 60-second timeout and roughly 60 seconds of wall execution; normalized executor evidence loses these details. `packages/core/src/executor/contree.ts:339` copies only exit/streams/metrics. | Preserve process termination and wall duration; set explicit deadlines. Provider operation success is not process success. |
| REAL-02b | The original selected job log is available, but identity receives bounded diagnostics; the real wrapper has two distinct native failures and is not a direct supported runner. `packages/core/src/github/adapter.ts:70`, `packages/core/src/engine/failure-identity.ts:58`. | Parse bounded structured identity from complete authenticated step evidence before rendering excerpts. Authorize wrapper mappings through protected policy. |
| REAL-03 | The identity report uses a special sentence, bypassing legacy SPRT text at `packages/core/src/report/format.ts:111`; the HTML parser at `scripts/fleet-dogfood-metrics.mjs:111` cannot retain its stop reason. | Add explicit HTML stop metadata plus a narrowly scoped historical fallback, not merely another regex alternative. |
| REAL-04 | Existing captured tests cover real boundaries, but do not prove delivery for these current incidents. | Freeze original evidence, use it for behavioral regressions, and reserve a distinct incident for generalization. |
| REAL-05 | Recorded exact-source-fetch and provider-disk failures currently become generic terminal observations. | Preserve typed source-owned reasons, costs and visible recovery instructions; do not invent account-level root causes or retry automatically. |
| REAL-06 | The real full verification took about 25 minutes; repair elapsed time is hard-capped at 600 seconds and current callers cannot raise it (`packages/core/src/engine/repair-budget.ts:15`, `packages/core/src/engine/repair-budget.ts:44`). | Keep normal defaults. Provide a separately authorized long-verification allowance; a focused probe must not replace the full audit. |
| REAL-07 | The original CLI pull request is now merged; its native-policy file was not observed at the default-branch path during planning. | Use it as a historical regression, not a new delivered-repair claim. Enroll native proof for a selected current pilot before claiming qualified delivery. |

A private annex at `docs/agents/2026-10-27-real-project-repair-plan/` holds the exact mapping, hashes, provider response fields, resolution readback and reviewer receipts. Public plans contain mechanisms and sanitized examples only. Preserve existing incomplete replay evidence; never relabel its pending model boundary as complete.

## Design decisions and trade-offs

1. **Repair the current system.** Use the existing executor, failure identity, repository policy, recorder, report, collector and native-qualification pipeline. No second queue, evaluator service, learned private memory or general wrapper interpreter.
2. **Make cheap admission precise.** A narrow helper recognizes the positively evidenced Sutura control-script category. It does not reject a job because its name contains Git, its repository is Python, or command resolution is undefined. Unknown wrappers require evidence or a protected profile; they are not declared supported by default. Keep existing CaseFile runtime/outcome unions and strict `require-fixed` behavior.
3. **Separate process state from assertion failure.** Add optional `RunResult.processState` and `RunMetrics.wallTimeSec`; preserve existing elapsed/cost fields. Historical absence is unknown. A timeout, signal termination or negative exit cannot establish matched application failure identity.
4. **Use one bounded protected reproduction profile.** Add optional `reproductionProfiles` to policy version 1. Initially support direct Node test-runner mappings only; existing unprofiled direct runners keep their current support. A profile binds exact native command, reviewed runner argv/cwd, source-input digests, required runtime, probe deadline and unchanged full verification command/deadline. The protected policy authorizes equivalence; hashes only bind the reviewed mapping to source. Candidate content cannot grant this authority.
5. **Keep complete failure sets.** For the primary regression, both native failures must be present and matched. Display excerpts may be shortened; structured identity may not silently discard a second failure. Summary count, normal completion and complete failure blocks must agree.
6. **Give full verification its own explicit allowance.** Owner decision, 2026-10-27: allow a separately approved budget for long verification while keeping current defaults. This selects the design only; it grants no live execution or spending authority. Normal repair/search remains capped at the existing 600 seconds. A protected profile can request at most 3,600 additional seconds for one isolated final-verification phase, with zero additional search/model turns or inference-cost allowance. The first selected candidate atomically consumes a one-shot capability; search stops and drains before any full audit, and final verification plus already-reserved adjudication use their own bounded deadline. A reviewed execution packet must separately authorize that duration, operation count, cost reservation, provider destinations and workflow timeout. No profile, model response, environment variable or CLI flag alone grants the extra allowance. Full required commands and adjudication must fit the combined case envelope; otherwise stop before paid search with a specific budget explanation. See phase 3 for accounting and cancellation rules.
7. **Preserve original acceptance obligations.** Focused probes optimize reproduction/search. The selected candidate still receives the original full fresh verification, required policy commands, frozen challenges and independent audit. Later native PR checks are an additional delivery gate. A passing provider operation or GitHub wrapper cannot bypass either gate.
8. **Local readiness and measured delivery have separate exits.** Complete local implementation and a reviewable pilot packet without waiting for organic events or publication approval. Phase 4's delivered-repair exit requires actual authorized execution and complete native proof. No-opportunity, unavailable provider support or missing authority stays PARTIAL/unmeasured; it does not become success.

Alternatives rejected: rejecting all unresolved commands would exclude valid wrappers; increasing every default timeout/cap would increase spend across the fleet; replacing full verification with focused tests would weaken assurance; rerunning the unchanged Placebo corpus would not repair these boundaries. Long jobs may instead remain diagnostic-only if the owner chooses not to approve a long execution packet.

## Phase sequence

| Phase | Deliverable | Acceptance oracle |
| --- | --- | --- |
| [1 — Real evidence and truthful stops](2026-10-27-real-project-repair-phases/phase-1.md) | Frozen incident boundaries, termination/wall evidence, report/parser round trip and immutable reprocessing. | Recorded timeout remains timeout across decoder → ledger → replay → report; historical identity stops retain their reason; no repair totals increase. |
| [2 — Admission and actionable recovery](2026-10-27-real-project-repair-phases/phase-2.md) | Both entry paths stop known control checks before paid setup; source/resource failures retain specific recovery instructions. | Control fixture uses zero executor/provider calls, including changed-command fallback; unsupported/unknown cases are distinguished; strict failures remain strict. |
| [3 — Faithful bounded reproduction and full audit](2026-10-27-real-project-repair-phases/phase-3.md) | Protected Node wrapper profile, complete native failure set, explicit deadlines and isolated long-verification allowance. | Original two-failure evidence matches only the correct focused reproduction; wrong/missing/extra failures, timeout and stale authority stop; the full command is still executed for the final candidate. |
| [4 — Native delivery and independent incident](2026-10-27-real-project-repair-phases/phase-4.md) | One current pilot's native proof enrollment, exact candidate/activation packet, real repair PR and distinct incident observation. | Original-case regression plus actual repair PR with every protected native obligation passing; integration measured separately; no duplicated historical fix counted as new delivery. |

Phases are accepted sequentially. Implementation starts only after a later explicit implementation request. Within a phase, use the listed disjoint work units only; one integration owner, local worktrees, no working-branch publication. Shared types, renderer and orchestration edits remain sequential. No new product work is performed during planning.

## Verification without loops

- During implementation, use focused RED → GREEN checks for changed behavior, independent review, repair and simplify. Each phase lists all of its automated gates; run them sequentially, retain every exit and bind evidence to tested inputs.
- At each behavioral phase exit, run `pnpm run ci:local` once, plus Core/Action coverage for changed packages and `pnpm run test:ci-routing` when routing/control inputs change. Focused commands listed in phase files are the RED/GREEN development selection, not a substitute for these required phase gates. Root ci:local already includes typecheck, lint, build and bundle checks; do not run those again merely to duplicate the same passing evidence. At final integration, reuse an unchanged phase-exit tree/check receipt and run only newly invalidated obligations; reconcile and reverify if the integration tip changes.
- Reuse passing evidence for unchanged tested inputs. After a narrow repair, rerun invalidated checks; do not repeat paid runs or broad unchanged suites as reassurance. Existing historical fixtures stay immutable; add current regressions instead.
- No live execution, new CI dispatch, release or consumer push is part of local test verification. A completed authorized integration push is monitored for its exact expected checks. A failed remote result is diagnosed from existing evidence, without an automatic rerun/fix-repush loop.
- Existing package versions and release bindings remain unchanged during local repair unless a later release workflow supplies a version. If the release's Case Lab gate applies, prepare its real required binding or record the blocked publication; never disable the gate or manufacture live results.

## Stuck states and recovery

Every row requires both a stop-safety test and a recovery-or-disclosure test; phase files name the exact oracles.

| State | Visible result / next action | How it ends; owner |
| --- | --- | --- |
| Known CI control command | Native admission stop with original repository/commit/run and Sutura coordination instruction; zero sandbox spend. | Coordinator repairs the control/install/source boundary; a distinct eligible event is reassessed. No cadence toggle. P2. |
| Unknown command or absent/stale profile | Needs reviewed command mapping, with exact missing/changed input and documentation path. | Agent prepares the exact protected-policy diff; owner reviews it. Correct source/profile is revalidated before any new authorized run. P3. |
| Incomplete/truncated/multiple diagnostics | Parser reason, expected/observed failure counts and retained evidence location; no matched claim. | Recollect the original authenticated step, or provide supported complete diagnostic output. No erased truncation flag or single-failure substitution. P3. |
| Process timeout, killed signal or unknown termination | Actual deadline/termination, output and known/unknown costs; no application-reproduction claim. | Review a bounded focused command or explicit allowance, then a separately authorized attempt. No automatic retry. P1/P3. |
| Full audit cannot fit budget/provider/workflow limit | Full-verification-budget-incompatible; requested and allowed limits plus the unchanged full command are shown. | Owner approves a concrete compatible packet, or the job remains diagnostic-only. No fixed result/PR from a skipped audit. P3/P4. |
| Runtime mismatch or unavailable image | Observed native runtime, approved profile and sandbox runtime are shown. | Prepare/approve a matching runtime or reviewed equivalence before execution; absence stays unsupported. P3. |
| Exact source unavailable | Exact failing SHA and access/ref evidence needed; branch HEAD is prohibited as a substitute. | Restore scoped access/ref availability, verify the exact SHA, then authorize a new attempt. P2. |
| Provider disk exhaustion | Origin-owned resource code, preserved operation evidence and a capacity-inspection action. | Provider/account owner resolves capacity under separate authority. No automatic cleanup or billed retry. P2. |
| Evidence corrupt, append conflicts or terminal persistence fails | Exact local path/identity and incomplete status; no complete collection or delivery claim. | Preserve originals; rebuild a new derived generation with the existing reducer, or resolve the reported persistence error. P1/P4. |
| Pilot already resolved, no eligible organic incident, missing native enrollment or pending/failed native checks | Historical regression or native-pending/not-qualified/unmeasured, with exact missing obligation. | Choose the next predeclared eligible opportunity or complete approved enrollment/checks; no forced failure or later-green substitution. P4. |

## Consumer sweep

Planning searches exclude generated bundles and captured JSON payloads:

```sh
rg -n --glob '*.ts' --glob '*.mjs' --glob '!**/dist/**' --glob '!**/__fixtures__/**' 'healCase\(|nativeFailureForCommand|nativeExecutionCommand|compareFailureIdentity|parseCaseFileHtml|triageStopReason|caseTerminalDetail|parseTerminalFailureJson' packages scripts
rg -l --glob '*.ts' --glob '!**/dist/**' --glob '!**/__fixtures__/**' 'RunResult|RunMetrics|StageEvidence|timeoutSec|verificationCommand' packages
rg -n --glob '*.ts' --glob '*.mjs' --glob '!**/__fixtures__/**' --glob '!**/dist/**' 'buildPublicationReceipt|buildNativeReceipt|collectNativeVerification|qualifyIncident|replayRepository' packages scripts
```

| Reader/writer group | Phase / disposition |
| --- | --- |
| Executor `types`, `contree`, `memory`, `live-diagnostics`; domain `StageEvidence`, `StageLedger` in `heal`; recorder/replay executor and validator; capture helpers | P1: optional termination/wall fields round-trip; absence remains unknown; operation success stays separate. |
| `report/format`, `report/casefile`, `report/markdown`, Action terminal detail; Case Lab `result`/render | P1/P2: explicit stop metadata and visible recovery, additive process fields, unchanged CaseFile outcome/runtime unions. |
| Fleet HTML/terminal parser, event persistence/richer merge, public sanitizer, recovery reducer, field report, incident queue | P1/P2/P4: retain stop/code privately, aggregate whitelist only, no new recovery count or causal grouping from prose. |
| `orchestrate`, `healCase`, changed-command fallback; `failure-identity`, native provenance and focus/triage; CLI heal | P2/P3: admission parity, exact profile trust and complete failure sets. Never leave a second entry point or direct-repair bypass. |
| Policy schema/load, workflow assessment, Action inspect, CLI assess/doctor/setup/upgrade and configuration fixtures | P3: optional protected profile validation, target-version capability disclosure and preservation of custom policy. Existing requiredCommands retain their purpose. |
| Budgeted executor, repair tools/agent/search, fresh verification runtime, policy required-command audit, supplied-patch verify execution | P3: explicit bounded deadline propagation and isolated final-verification allowance. Supplied patches cannot bypass the same process/deadline gates. |
| Challenges, counterfactual evaluator, verification execution recorder/external runner, resource/search scoring | P1/P3: pass through new optional evidence; consume wall/termination only where semantics require it; preserve safety decisions. |
| `packages/action/src/replay-repository.ts` and capture allowlists | P3: capture only bounded profile-declared source inputs; preserve secret redaction, denied reads and existing byte limits. |
| Publication receipt `packages/action/src/publication.ts`; native receipt/collector and `qualifyIncident`; pilot protected workflows/policy | P4: reuse actual enrollment and receipt mechanisms; exact proposal/integration native obligations; missing proof remains unmeasured. |
| Action/CLI dist and root Action metadata | Rebuild through existing commands; no hand editing. Publication remains separate. |
| Audit-only supplied-log path | Excluded from execution-deadline propagation because it executes no sandbox command; validate any displayed new evidence without granting execution. |
| Historical Placebo results/manifests, old captured bundles, existing weekly email/study infrastructure | Immutable or unchanged; not a new evaluation/notification project. Existing relevant safety tests still run. |

Repeat the sweep on implementation changes; list newly found readers/writers and their phase before acceptance. Each phase names file ownership and executable oracles rather than treating this table as sufficient proof.

## Delivery acceptance and handoff

Local repair is ready only when all planned regressions and affected/final gates pass, independent review has no unresolved actionable finding, bundles match source, and the pilot packet is concrete and reviewable. Native delivery is proved only after the enrolled proposal's exact checks pass. A human merge plus exact integration checks is a stronger, separately observed result; the agent never merges automatically.

No material technical design choice is delegated to an unspecified future investigation. The owner confirmed the optional separately approved long-verification design. Acceptance of the complete implementation plan remains pending, and no live allowance is selected or approved here. Provider support, current incident availability, runtime equivalence and execution prices are empirical entry checks with explicit fail/disclosure branches. A profile is not live-spend authority. Before any external action, prepare its exact candidate, scope, explicit time/operation/cost limits, unresolved billing treatment, expected native checks, rollback and stop conditions. New publication/paid authority is requested only after local work makes that packet concrete.

Current workflow authorization is planning only. After plan acceptance, implementation starts in an isolated worktree from a revalidated integration tip; preserve this assessment, plan, private inputs and evidence outside disposable state. Each phase handoff records candidate identity, changes, oracles, check exits, deviations, authority and next gate. Final local delivery targets `develop` and prunes only owned worktrees/branches. No hosted activation or release claim follows from local integration.


## Planning verification and review

Two independent source investigations covered reproduction/budgets and admission/reporting. Independent full-plan and focused budget reviews found process-consumer, one-shot selection, caller-authority, adjudication-clock/polling and ownership gaps. These were repaired and both reviewers approved their findings' disposition. Private review receipts and incident hashes remain in the planning annex. Final documentation checks cover phase links, source references, privacy, behavioral/recovery oracles, consumer coverage and absence of clarification placeholders. No product tests or live experiments were needed to validate this plan.
