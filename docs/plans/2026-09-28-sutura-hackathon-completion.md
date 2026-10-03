# Sutura hackathon completion plan

Date: 2026-09-28. Owner: Juan. Planning base: clean local `develop` at `d249c2562704d4b42c22a08e06c5ffd0dc2bfe9c`. Status: independently reviewed; phase 1 pending acceptance. Integration remains `develop`; releases and the Devpost submission use `main` under the existing release workflow.

## Outcome and authority

Deliver a working, measured Sutura entry for the Nebius x NVIDIA Global AI Hackathon by the planned October 29 submission, ahead of the official October 30, 2026 10:00 PDT deadline. A final public release, Case Lab, benchmark, external verification, developer study, video, evidence index and Devpost text must agree on the exact product identity. Preserve the judging access obligation through December 15. The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) require a working Nebius/NVIDIA application, public licensed source, demo, public YouTube video under three minutes, description and product feedback.

This is an execution plan over the approved [verified repair program](2026-09-05-sutura-verified-repair-program.md) and its [phases 10–14](2026-09-05-sutura-verified-repair-program-phases/phase-10.md). Reuse their release and experiment contracts. The [August roadmap](2026-08-31-sutura-hackathon-winning-roadmap.md) and [WS-3](2026-09-04-ws-3-data-lab-external-adoption.md)/[WS-4](2026-09-04-sutura-ws4-evidence-submission.md) plans retain historical evidence and procedures, but their v0.2.x candidate identities and dated approval text do not authorize a new run. This plan adds a truthful fleet recovery ledger and a fresh disposition of consumer blockers. It does not authorize spending, participant contact, a push, release, deployment, Marketplace publication, video publication, feedback submission or Devpost submission. Prepare each exact request and artifact before its action gate, then execute after applicable explicit authorization.

The September 14 [CI recovery plan](2026-09-14-sutura-ci-recovery.md) is still planned. Its autonomous Recover controller is outside this submission critical path. This plan uses its exact incident attribution contract for read-only measurement; it does not introduce auto-merge or a new agent fallback service. Sutura's existing human review boundary remains in force for repair PRs.

## Revalidated starting point

- v0.3.3 is published and its Case Lab was deployed with a live `fixed` smoke result ([release record](../release/v0.3.3-case-lab-record.md?plain=1#L3)). A signed-out browser check on September 28 showed v0.3.3, the exact Action pin and enabled live buttons. Recheck that mutable state at public acceptance.
- The [release benchmark](../demo/sutura-v0.3.3-release-benchmark-evidence.md?plain=1#L51) completed 51/51 cases and 55/55 evaluations with zero false approvals, 12/18 repairable fixes and 3/15 hidden preservation. Optional Astra/Jev rows were skipped in that benchmark; the forwarding fix is on `develop` and needs a new exact-candidate measurement ([limitations](../demo/sutura-v0.3.3-release-benchmark-evidence.md?plain=1#L88)). Old results remain tied to v0.3.3.
- The latest observed Sutura `develop` CI passed on the planning base ([run 36255434827](https://github.com/juan294/sutura/actions/runs/36255434827)). This is a source gate, not a final public release or quality result.
- The existing [fleet collector](../../scripts/fleet-dogfood-metrics.mjs#L379) measures attempts and cost, but `recovered` remains `null`; its [documentation](../adoption/fleet-dogfood-metrics.md?plain=1#L29) says repair PR and target-branch green linkage is missing. A dated local September 27 snapshot has stale Action-pin expectations and missing costs, so it cannot support a recovery or savings claim. Issue [#139](https://github.com/juan294/sutura/issues/139) defines the end-to-end question.
- The September 22 [repair-path plan](2026-09-22-fleet-repair-path-recovery.md?plain=1#L3) is complete. The two failures cited by [#136](https://github.com/juan294/sutura/issues/136) contained commands; its configured fallback stays parked until fresh evidence proves a genuinely commandless step. [#135](https://github.com/juan294/sutura/issues/135) remains open for oversized non-code snapshots. A GitHub workflow being active, skipped or green is not proof of a verified repair.
- Prepared assets include [study materials](../adoption/verified-repair-study.md?plain=1#L1), [qualitative Devpost copy](../devpost/sutura-submission.md?plain=1#L1), a [video script](../devpost/sutura-video-script.md?plain=1#L1) and a [judging access collector](../runbooks/judging-access.md?plain=1#L8). The [evaluator guide](../evaluation/README.md?plain=1#L94) still contains older release claims and must be refreshed from final evidence.

## Selected approach and trade-offs

| Choice | Reason and limit |
| --- | --- |
| Extend the existing fleet collector and use #139's four states as a report view | Reuses per-run evidence and the richer incident identity design in [CI recovery phase 4](2026-09-14-sutura-ci-recovery-phases/phase-4.md?plain=1#L7); avoids a competing ledger. Historical Action pins remain separate cohorts. |
| Inventory every configured project, but showcase only consented public-safe cases and aggregates | Gives complete operational coverage without putting private repository names, logs, source or participant data in this public repo. Repositories with no qualifying failure, disabled monitors or missing artifacts remain explicit. |
| Fix observed blockers before new capability | #150/#152 are already done; #136 needs a fresh trigger. #135 enters implementation when an in-scope consumer reproduces the snapshot cap, with trusted exclusions and full omission evidence. |
| Keep a single measured candidate through each paid campaign | Source, model, corpus, policy or runtime changes invalidate affected results; there is no automatic rerun or budget inheritance. The [program gates](2026-09-05-sutura-verified-repair-program.md?plain=1#L95) decide readiness. |

## Phase sequence

Dates are target exit windows, not permission or a reason to weaken a gate. The final candidate's version is chosen by the release workflow after scope is known.

| Phase | Deliverable | Depends on | Target exit |
| --- | --- | --- | --- |
| [1](2026-09-28-sutura-hackathon-completion-phases/phase-1.md) | Reconcile all configured monitors and build exact failure-to-green fleet evidence | Planning acceptance | Oct 1 |
| [2](2026-09-28-sutura-hackathon-completion-phases/phase-2.md) | Resolve measured consumer and repair-quality blockers; freeze a testable candidate | 1 | Oct 5 |
| [3](2026-09-28-sutura-hackathon-completion-phases/phase-3.md) | Run the integrated benchmark, matrices, Arena, Data Lab, NeMo and external-patch measurements | 2; exact capped authorization for paid work | Oct 11 |
| [4](2026-09-28-sutura-hackathon-completion-phases/phase-4.md) | Validate a public pilot release, installs, Marketplace and Case Lab | 3; publication/deployment authority | Oct 14 |
| ~~[5](2026-09-28-sutura-hackathon-completion-phases/phase-5.md)~~ | Dropped 2026-10-02: no human participants (see scope change below) | — | — |
| [6](2026-09-28-sutura-hackathon-completion-phases/phase-6.md) | Freeze final release, record video, publish evidence index and submit | 5; separate final publication and submission authority | Oct 29 |
| [7](2026-09-28-sutura-hackathon-completion-phases/phase-7.md) | Maintain signed-out judge access and immutable evidence | 6 | Dec 15 |

The critical path is 1 → 2 → 3 → 4 → 6 (phase 5 dropped 2026-10-02). Documentation drafting, privacy review, sponsor feedback drafting and media shot planning can proceed locally while a dependent phase waits; their final factual claims still depend on measured artifacts. Only explicitly marked read-only or file-disjoint preparation is `[batch-eligible]`, with one integration owner. Existing verified-repair phases 10–14 execute sequentially. Phase acceptance and verification remain sequential.

## Acceptance contract

1. Every configured fleet repository receives an installation/enablement state and every discoverable eligible failed or timed-out CI incident in the declared window receives one terminal attribution or `unknown` with a reason. Separate `sutura-green`, `sutura-proposed`, authenticated `agent-fallback-green`, `resolved-externally` and `unresolved`; distinguish flake, refusal, gave-up and infrastructure causes. A successful monitor job, opened PR or unauthenticated commit author alone cannot establish recovery actor. The 45-day pre-rollout comparison uses the same workflow/branch definition and reports coverage and censored incidents. No subscription-dollar saving is inferred from run counts ([#139](https://github.com/juan294/sutura/issues/139)).
2. At least one public-safe consumer case traces failed source SHA → Sutura result/diff → independent repair CI → intended-branch integration → same-workflow green. If no such event occurs naturally, report that gap and use a separately authorized, bounded controlled trial; do not synthesize fleet success.
3. Final quality evidence retains all attempted cases, failures, not-run probes, provider errors and actual costs. Mandatory gates are zero known false approvals, every required challenge executed, preserved legacy gates, complete candidate/public eight-case matrices, real sponsor experiments and the [program's declared empirical targets](2026-09-05-sutura-verified-repair-program.md?plain=1#L103). Misses block promotion or receive a documented disposition under the program; the benchmark cannot be edited to pass.
4. Dropped 2026-10-02 (scope change below). No human study, participant install or reviewer comprehension claim is made. The original criterion was: Three validated unfamiliar public-artifact installs and five actual human review sessions include a complete ledger of failed/withdrawn attempts, help and consent. The target is at least four of five reviewers identifying verdict, rejection reason and next action within 60 seconds unaided ([study contract](../adoption/verified-repair-study.md?plain=1#L17)).
5. One final release identity binds npm, immutable Action, package, Case Lab, benchmark, Arena, matrix, public video and Devpost claims. The existing eleven [release evidence IDs](../demo/sutura-v0.3.3-release-evidence-requirements.json#L4) and the program's added capability/access records must be complete. Signed-out desktop/mobile, install, video and link checks pass. October readiness means judging operations are prepared; actual December observations close phase 7.

## Scope change 2026-10-02: no human study

Juan decided not to recruit participants. Phase 5 and acceptance item 4 are dropped, and phase 6 depends on phase 4 directly. Consequences:

- No public artifact may claim external users, independent installs, review sessions or a comprehension result. The video script's external-user segment is removed.
- Done 2026-10-03: `scripts/release-evidence.mjs` accepts an `out-of-scope` status that requires an owner disposition (decision, decidedBy, decidedAt, reference) and is never counted as passed or as a miss; `scripts/marketplace-evidence.mjs` verifies the listing without study evidence and records `adoptionStudy: out-of-scope`, while still validating study evidence when supplied.
- Marketplace publication itself is unaffected; only its verifier's study coupling changes.
- The study materials in `docs/adoption/` stay as historical, unsent preparation.

## Stuck states and recovery

| State | What the operator or judge sees | Exit and proof |
| --- | --- | --- |
| Missing/expired fleet artifact, partial GitHub page or Action-pin mismatch | `unknown` or `unreconciled`, affected denominator and run URL; no zero-cost or recovered claim | Re-fetch the same immutable run/artifact or mark permanently unavailable; fixture test proves both outcomes remain visible. |
| Disabled/unsupported monitor or no qualifying CI failure | Repository state and reason in local inventory; public aggregate shows coverage | Re-enable only after the blocker is fixed and authorized, or retain excluded status; inventory test rejects silent omission. |
| Snapshot too large or truly commandless failed step | Named `infra-stop` with stage, source run and exclusion/fallback status | Trusted policy repair plus local replay and a bounded authorized consumer proof, or a visible unsupported disposition; regression test proves the stop remains attributable. |
| Provider/preflight failure, unknown billing, exhausted cap or interrupted batch | Failed/unknown job, cost coverage and remaining reservation; no quality promotion | Recover by recorded job ID without relaunch, settle billing, or request a new exact manifest; fault test proves no automatic paid retry. |
| Empirical or mandatory quality gate misses | Gate name, denominator, source identity and failing cases in the report | Repair locally, create a new candidate and rerun invalidated evidence under a new approved cap; validator test keeps `ready=false` meanwhile. |
| Public demo, video, Marketplace or archive unavailable | Labeled recorded replay/fallback and an explicit unavailable link state | Restore under authorized release procedure; signed-out acceptance and collector tests prove either recovery or a visible failure. |
| Participant recruitment shortfall or consent withdrawal | Actual invited/completed/withdrawn counts, never a fabricated cohort | Continue authorized recruitment or report unmet adoption gate; study validator keeps readiness false. |

## Consumer sweep and verification

Before changing fleet metric output, search with `rg -n 'fleet-dogfood-metrics|attemptStages|recoveryEvidenceComplete|summary.json|events.jsonl' docs scripts package.json`. Known writer and readers: `scripts/fleet-dogfood-metrics.mjs:254,379,436`, its fixtures/tests in `scripts/fleet-dogfood-metrics.test.mjs:14`, the npm command in `package.json:21`, `docs/adoption/fleet-dogfood-metrics.md:1`, `docs/README.md:20`, and the planned incident metrics in `docs/plans/2026-09-14-sutura-ci-recovery-phases/phase-4.md:7`. Check ignored `.sutura/fleet-dogfood-config.json` and existing events as private inputs, preserving them; do not publish their raw rows. If the output schema changes, version it and retain v1 semantics. Expand the sweep to any newly found caller, fixture, E2E helper or report writer before implementation.

For behavioral changes follow red → green → refactor, independent review → repair → simplify → sequential verification. Run focused tests first, then the applicable `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`, `pnpm run verify:bundle` and `pnpm run ci:local` gates on the exact integrated candidate. Record every failed command and rerun it after repair; a later pass does not erase it. Planning validation uses links, whitespace and documentation contracts, not a paid quality claim. Keep working branches local, inspect CI/deployment triggers before one authorized integration push, and verify exact pushed CI without a rerun loop. No Vercel Preview.

## Durable handoff

Each phase record names the accepted scope, base/current commit and worktree, owned changes, issue/finding dispositions, exact tests and remote run identities, costs/caps, unsupported cases, invalidated evidence, next entry gate and required authorization. On resume, recheck `git status --short --branch`, `git worktree list --porcelain`, current refs, live workflows and artifact availability. This plan's starting facts are dated observations, not continuing authority. Stop at each phase's acceptance boundary unless Juan explicitly authorizes continuation across it.

## Planning review and entry gate

Two independent read-only reviews covered fleet attribution/privacy and submission/adoption dependencies. Their findings on evidence persistence, authenticated fallback, #135/#136 contracts, Marketplace sequencing, three valid installs, action-specific authorization and source links were resolved in this plan and phase files; both reviewers reported no remaining material issue. Local link/line/whitespace validation found no errors across eight new files. `node --test scripts/submission-contract.test.mjs` passed 12/12; `pnpm run typecheck` and `pnpm run lint` passed on the planning checkout. These checks validate the plan and current source gates, not the future paid or public outcomes.

Phase 1 starts after this planning boundary. Its first action is to recheck the actual `develop` ref, worktree and private collector input without assuming the dated snapshot or any prior external authorization still applies. No implementation, new provider job, participant contact or publication was performed in this planning phase.
