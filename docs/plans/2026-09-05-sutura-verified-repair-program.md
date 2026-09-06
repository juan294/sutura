# Sutura verified repair program

Date: 2026-09-05. Owner: Juan. Status: implementation in progress; phases 1 and 2 complete locally; phases 3, 4, 5 and 7 partially implemented with honest per-phase progress records; phases 6, 8 and 9 not started; phases 10–14 require separately authorized spending, publication or real participants.

Planning source: local `develop` at `369c972777eea3c80b698db61165f07ba46e6b13`. Integration: `develop`; releases: `main`; implementation: isolated worktrees. This document records the user's approval of the **full recommended product scope**, not authorization for spending, outreach, publication or deployment. Stop after every implementation phase unless Juan explicitly authorizes continuation.

Implementation authorization: on September 5 Juan requested all phases continuously, followed by a local merge to `develop` and worktree cleanup. This overrides the per-phase stop instructions. Paid runs, outreach, public releases and future judging observations retain their separately stated dependencies and authorization requirements.

## Product outcome

**Sutura checks whether an AI-generated CI fix repairs the failure without breaking supported behavior, and gives the developer the evidence to review it.** It can create the repair or verify a patch supplied by another agent. It reproduces failures, distinguishes flakes, explores bounded repairs, checks independent behavioral probes, and reports what ran, what failed, and what remains uncertain. Human review remains the final merge decision.

Winning depends on a convincing result: two patches make the same visible test green; Sutura rejects the one that breaks pagination and accepts a contract-preserving repair. Then a developer uses the same verifier with an external patch. All sponsor integrations serve that workflow. Passing sampled checks is evidence, never a proof of universal correctness.

## Inputs and supersession

- [Product and hackathon audit](../research/2026-09-05-sutura-product-hackathon-audit.md): the factual baseline and recommended scope approved by Juan.
- [August roadmap](2026-08-31-sutura-hackathon-winning-roadmap.md): historical milestones, release gates and operational obligations retained unless explicitly replaced here.
- [September 4 evidence plan](2026-09-04-sutura-ws4-evidence-submission.md) and [adoption/Data Lab workstream](2026-09-04-ws-3-data-lab-external-adoption.md): reuse existing validators, manifests and operational procedures; do not restart completed work.
- [Completed evaluator documentation plan](2026-09-05-sutura-agent-evaluation.md): retain the canonical evaluator guide and architecture cards. Update those documents when behavior/evidence changes; create no competing evaluator portal.
- `.claude/commands/plan.md:1`, `CLAUDE.md:26`, `.claude/rules/rpi-details.md:1`, and `.claude/rules/ci-parity.md:1` govern workflow and local gates.

This plan replaces the September candidate feature freeze and stale next actions with the dependencies below. Prior releases, benchmark runs, permissions and failures remain historical records; old paid-run authorization does not authorize new jobs. Existing release-evidence checks remain requirements, extended with new checks rather than weakened to make the plan pass. October 21 remains the intended final feature freeze, October 29 the intended submission date. Missing an internal target requires explicit replanning; no automatic scope cuts or false completion.

## Verified baseline and why it changes the plan

| Evidence at planning | Consequence |
| --- | --- |
| Public recorded pagination accepts `Math.floor(items / size)`, which passes 20/10 but returns 2 for 21/10 and 0 for 1/10 | Phase 1 fixes the corpus and public-evidence interpretation; phase 4 must reject the exact captured patch. Preserve the historical artifact and add a versioned regression. |
| Benchmark on `f5c3056acc96597f1ae11f411a3b9cfe03ba990f`: 51 cases, 55 evaluations, repair 10/18, hidden preservation 1/4 with three not run; quality gate failed | It does not validate current source. Zero measured false approvals in that run did not establish semantic correctness. New evidence must retain missing outcomes and expanded oracles. |
| Candidate matrix on `ce3502d86a32883eac8c7a2adcc9df2c07e12e85`: 6/8; missing-await and policy-refusal failures | Recover diagnosis conservatively and measure the exact replacement candidate. |
| Controlled repair proposal edits one excerpt; anchored diff machinery supports multiple paths | Build bounded two-file transactions on the existing machinery. |
| Supplied diff execution exists; `auditOnly` is reduced-assurance log analysis | Extract one shared verifier; add an explicit execution-backed external-patch command. |
| Data Lab has a prepared 110-row dataset; its task reveals outcome through case kind/grounding flags | Keep v1 historical; implement blinded quality evaluation v2 and actually run the experiment before claiming improvement. |
| ATIF export/schema validation exists; model router uses requested profile/role rather than adaptive signals | Execute a real NeMo evaluation and implement measured signal-based routing. Neither is complete today. |
| Full local application checks passed in the preceding audit: 1,744 tests passed, nine credential-gated skips | Useful baseline engineering evidence, not proof of the new planned behavior. Planning changes require document checks only. |

Exact historical identities and source links are in the audit. New acceptance artifacts must store their own identity; none inherit validity because a later commit includes an earlier patch.

## Scope and selected architecture

| Capability | Selected design and trade-off | Completion phases |
| --- | --- | --- |
| Better legitimate repairs | Up to three grounded diagnosis hypotheses; narrow controller grants for async/strictness fixes | 2, 10 |
| Coherent multi-file work | At most two changed files total, including generated lockfiles; controller-owned related targets, atomic apply | 3, 10 |
| Independent regression challenges | Bounded declarative probes, controller-side assertions, frozen before seeing candidate; less expressive than arbitrary generated tests, enforceable with current executor | 1, 4, 10 |
| External-agent verifier | CLI and read-only Action mode share production verification; supplied patch file and exact source/trusted-policy identity | 5, 10–12 |
| Data Lab + NeMo evidence | Blinded outcome-grounded dataset, paired batch experiment, standalone recorded-trajectory evaluation; no runtime framework rewrite | 6, 10 |
| Adaptive Nemotron routing | Versioned deterministic selection/escalation using real signals and budget reservations; promotion depends on measured preservation and cost | 7, 10 |
| Judge/developer experience | Verdict first, inspectable two-patch comparison, clear live/replay/recorded states, accurate costs, repeatable replay | 8, 11–13 |
| Product validation | 100-case Arena with disjoint splits; three unfamiliar installs, five human review sessions; two real external-agent patch sources | 6, 9–12 |
| Submission and operation | Exact-release evidence index, public installation/demo/video, sponsor feedback, access through judging | 11–14 |

No editor integration is required: this plan interprets the sponsor reference as **Nebius**, matching the linked event. The verifier's CLI can be called from any editor. New GPU hosting, NIM/Dynamo serving, fine-tuning, persistent repository memory and unrelated assistant features are outside this approved recommendation set. They would require a separate product decision; they are not substitutes for the capabilities above.

### Shared contracts established first

Introduce proposed `packages/core/src/verification/types.ts` and a versioned `VerificationEvidence` v1. Per-gate observations use `passed | failed | insufficient | not-run | infra-stop`, structured reason codes, and references to executed artifacts. Overall product decisions distinguish repaired, verified supplied patch, refused, flaky/no-patch, insufficient and infrastructure stopped; these decisions never overwrite per-gate observations. Legacy case files and log-only audit retain versioned adapters and their original meaning.

Every new result binds source commit and snapshot hash, **trusted policy base SHA and policy hash separately**, complete diff hash, corpus/fixture revision where applicable, image digest, commands, model purpose/tier/requested and returned model IDs, routing/challenge versions, timestamps and evidence mode. Secrets, raw hidden oracles and private participant data are excluded from public exports. Add an integrity hash over actual stored bytes, including measured time; a normalization hash used for comparison/replay is a distinct field.

Costs separate token usage and priced inference estimates, provider-reported raw sandbox amount/unit, confirmed billed currency only when documented, and wall time. Unknown units are unknown, not USD or zero. Pricing has an as-of date and source. Never sum unknown-unit sandbox amounts into a dollar total. Reserve terminal evidence and full audit before spending the remainder on repair/challenges; no default budget increase is implicit.

A challenge is a contract-backed typed invocation plus a controller-owned expected value/relation. Trusted policy binds each target to a supported declarative contract or exact input/output expectations; the model cannot create this authority. Initial templates are nonnegative integer ceiling division with a positive divisor, declared cardinality preservation, a declared codec round-trip, exact typed examples and exact JSON-property constraints. Controller evaluators derive expected values/relations deterministically from that trusted declaration. Source/prose citations aid discovery and explain context; a matching citation hash cannot validate a model-invented expected answer. Unsupported prose-only contracts yield insufficient evidence. Corpus controls include public trusted contracts distinct from evaluator-only hidden probes. Maximum three retained probes, two isolated repetitions per baseline/candidate. JavaScript/TypeScript exported callables, Python sync/await callables and bounded JSON-property observations are initial adapters. The controller-held frozen probe/expected-value tables, assertion state, result writer and hidden evaluator values stay outside candidate sandboxes. Public specifications and declared example contracts are not secret and may make expected behavior inferable; assurance never depends on keeping intended behavior secret. Snapshot packaging excludes controller tables, hidden evaluator material and raw Git object storage, with mutation tests for each. Minimal public contract context may inform models; it cannot change oracle authority. Model output contains no test programs, shell, dependency injection or runner overrides. Validity qualification distinguishes preservation checks (baseline passes) from bug-regression checks (baseline assertion fails against a supported contract). Unsupported expectations are insufficient evidence. Phase 1 proves the local protocol; phase 10 owns the separately authorized provider preflight before live acceptance. No protected-mount or attestation API is assumed.

Mode defaults are explicit: new `sutura verify` and the flagship demo use `required`; existing `heal` retains `optional` for backward compatibility unless trusted repository policy selects `required`. Optional runs without qualified probes are labeled baseline checks only and cannot earn contract-verified acceptance claims or satisfy challenge-specific release gates. Onboarding explains the small trusted contract declarations required for stronger verification; models cannot silently write or approve those declarations.

Required challenge mode needs at least one qualified probe and all retained checks, existing audit and policy gates completed successfully. An invalid/missing probe cannot be silently discarded after observing a candidate to produce approval. Optional baseline-only compatibility remains visibly lower assurance. Run all generated/supplied/counterfactual candidates through one evaluator. A visible-green candidate that fails full verification must not terminate search successfully or cancel the remaining viable frontier; continue within the shared budget until a fully qualified candidate or explicit terminal stop. Model-role separation reduces direct contamination; it does not establish independent model-family errors or defeat test-aware implementations.

External verification command is specified in phase 5: `sutura verify` requires `--source-sha`, `--policy-base-sha`, `--candidate-diff` **file**, trusted failing command, clean source checkout and explicit JSON output. The core gets immutable patch bytes, not a mutable filename. It has no repair-generation or Git publication port. Existing log-only audit remains available and accurately labeled.

## Phase order and delivery windows

Windows are targets for planning, not evidence of completion or guaranteed effort. A phase starts only after its dependencies pass. Each linked file contains pseudocode, owned files, executable controls, automated/manual acceptance and a stop gate.

| Phase | Deliverable | Depends on | Target window | Status |
| --- | --- | --- | --- | --- |
| [1](2026-09-05-sutura-verified-repair-program-phases/phase-1.md) | Truthful baseline, pagination regression, contracts and probe adapter proof | This plan | Sep 5–8 | Complete locally |
| [2](2026-09-05-sutura-verified-repair-program-phases/phase-2.md) | Bounded diagnosis recovery | 1 | Sep 8–12 | Complete locally |
| [3](2026-09-05-sutura-verified-repair-program-phases/phase-3.md) | Atomic two-file and grounded migration repairs | 2 | Sep 12–17 | Core implemented; dependency fixture and grounding outstanding |
| [4](2026-09-05-sutura-verified-repair-program-phases/phase-4.md) | Shared verifier and independent regression probes | 3 | Sep 17–23 | Evaluator and challenge freeze implemented; not yet the production admission path |
| [5](2026-09-05-sutura-verified-repair-program-phases/phase-5.md) | External-patch CLI/Action | 4 | Sep 23–26 | Core verify contract implemented; CLI and Action routes outstanding |
| [6](2026-09-05-sutura-verified-repair-program-phases/phase-6.md) | Blinded evaluation, NeMo execution and Arena harness | 5 | Sep 26–30 | Planned; [batch-eligible] with 9 |
| [7](2026-09-05-sutura-verified-repair-program-phases/phase-7.md) | Adaptive Nemotron routing | 6 | Sep 30–Oct 3 | Decision table implemented; not yet wired into the router |
| [8](2026-09-05-sutura-verified-repair-program-phases/phase-8.md) | Verdict-first Case Lab and deterministic replay | 7 | Oct 3–7 | Planned |
| [9](2026-09-05-sutura-verified-repair-program-phases/phase-9.md) | Maintainer study and public-install preparation | 5 | Sep 26–30 | Planned; [batch-eligible] with 6 |
| [10](2026-09-05-sutura-verified-repair-program-phases/phase-10.md) | Integrated benchmark, ablations and sponsor experiment evidence | 8, 9 | Oct 7–12 | Planned |
| [11](2026-09-05-sutura-verified-repair-program-phases/phase-11.md) | Validated public pilot release/demo | 10 | Oct 12–14 | Planned |
| [12](2026-09-05-sutura-verified-repair-program-phases/phase-12.md) | Real maintainer trials, findings and verified fixes | 11 | Oct 14–20 | Planned |
| [13](2026-09-05-sutura-verified-repair-program-phases/phase-13.md) | Final freeze/release, video, evidence index and submission | 12 | Freeze Oct 21; submit Oct 29 | Planned |
| [14](2026-09-05-sutura-verified-repair-program-phases/phase-14.md) | Judge access and evidence retention | 13 | Through Dec 15 | Planned |

Only phases 6 and 9 form a batch: evaluation package/Placebo/experiment files versus adoption-specific scripts/docs. They consume phase 5 and share no edited file or output dependency. Do not change root package scripts, common evidence types, Action dist, shared README, workflow files or common release validators inside that batch; integrate required common wiring in phase 10. Phase 9 may reference stable phase 5 interfaces and uses isolated study fixtures. Phase 9 also prepares a concrete authorization request to reserve study sessions early; waiting until October 14 to start recruitment risks missing the freeze. Actual public-artifact trials still depend on phase 11. Every other phase is sequential because core, UI, contracts or measured identities overlap. Read-only research/review may run in parallel; test commands run sequentially.

## Evaluation and release decisions

Freeze a 100-case, licensed, reproducible Arena inventory with lineage/family hashes before measured evaluation. Use 60 development cases, 20 validation cases and 20 held-out cases, stratified by language, repair/upstream/flake/deception purpose and repair family. Cases from one root problem/mutated family cannot cross splits. Count unique cases separately from candidates, repetitions and ablation evaluations. Report per-split denominators and uncertainty; do not present 100 as 100 unseen cases. Held-out expectations and candidate-quality labels never enter repair, challenge or Data Lab model prompts. Contamination discovered later invalidates the affected test split and requires a fresh held-out family set before a generalized claim.

Data Lab prompt selection is for the offline quality evaluator; complete both prompt development/validation batches before selecting it. Freeze all runtime settings and the selected evaluator before held-out measurement. Held-out results can veto a known-unsafe promotion, but cannot tune a new winning profile without a replacement test split.

Required comparisons: same candidate with/without challenges; bounded recovery versus original diagnosis; one-file versus two-file support on named migration controls; Tavily on/off on version-contract cases (explicitly a policy-gated capability demonstration when the off arm must abstain); existing Sutura/single-branch/fixed-parallel search arms with matched models and maximum budgets; adaptive versus fixed routing. Existing derived first-green arm remains explicitly derived, not an independently executed agent. Record actual spent resources as well as allowed budgets; do not attribute outcomes to routing when verification policy also changed. External-agent supplied-patch trials are a separate verifier evaluation, not a claim to have beaten those agents at autonomous coding.

Mandatory product gates are distinct from empirical targets:

- All known correct pagination/async/two-file controls pass; exact published wrong pagination and matched deception controls are rejected. Equivalent correct implementations remain admissible.
- No known false approval in the frozen acceptance set; any discovered false approval blocks promotion until fixed and rerun with matched valid controls. Report residual sampled assurance and confidence intervals even at zero.
- All required challenge checks executed for every claimed high-assurance acceptance; no hidden preservation `not-run` counted as a pass. Measured hidden correctness remains evaluator-only evidence.
- Existing release benchmark thresholds, eight-case candidate/public matrices, provider/image canaries, dogfood and installation/evidence contracts still pass on compatible final subjects. At minimum retain the previous repair gate of 11/18 for the fixed legacy repair slice; report new-corpus results separately.
- Target >=80% successful valid repairs on the frozen repair slice, >=95% refusal of deceptive patches with all known-danger controls refused, and >=90% completed verification coverage for supported probe surfaces. These are product targets, not measured claims or permission to weaken existing gates. If missed, report the miss and replan remediation before claiming the target achieved.
- Adaptive-routing promotion requires no new false approval, no lost previously accepted correct controls, and paired cost/latency evidence at matched correctness. Target >=20% lower priced inference cost per correctly verified repair; an unsuccessful experiment ships as an explicitly selectable evaluated profile while the safer fixed baseline remains default. Routing capability is in scope even if the cost hypothesis fails.
- Complete one real sanitized Data Lab experiment and one executable NeMo recorded-trajectory evaluation, each with source/dataset/tool/model/version identity, all errors and costs. Negative or tied results remain valid experiment evidence; no schema-validation-only substitute.
- Three independent unfamiliar-repository installs using public release artifacts, and five human review sessions. Report failures, assistance and withdrawals. Also run counterbalanced paired review tasks comparing ordinary CI plus diff with Sutura evidence, measuring correct accept/refuse/abstain decisions, elapsed time and assistance. Reviewer target: at least four of five identify the verdict, rejected-shortcut reason and next safe action within 60 seconds unaided. If not met, fix UX and rerun a declared fresh or explicitly repeated cohort.

## Sponsor integration and judging traceability

Official sources, reviewed in the audit: [overview](https://nebiusglobalaihackathon.devpost.com/), [rules](https://nebiusglobalaihackathon.devpost.com/rules), [resources](https://nebiusglobalaihackathon.devpost.com/resources). Recheck these before final submission. Four criteria carry equal weight; technological implementation is first tie-breaker. There is no published points-per-tool schedule.

| Integration | Necessary product role | Evidence to show judges |
| --- | --- | --- |
| Nebius Token Factory + NVIDIA Nemotron | Runtime diagnosis, bounded repair, independent challenge purpose and adjudication; adaptive selection | Actual returned model IDs, runtime requests, per-purpose usage, paired routing results |
| ConTree | Reproduce and isolate baseline, repair, fresh audit and probe repetitions using shared prepared state | Exact image and branch lineage, executed observation artifacts, matched search comparison |
| Nebius Data Lab | Sanitized execution evidence dataset and a blinded experiment that helps select prompts/models | Real dataset/batch IDs, hashed inputs/outputs, dev/held-out results, justified adoption or rejection |
| NVIDIA NeMo Agent Toolkit | Execute version-pinned recorded-trajectory evaluation using Sutura's ATIF export | Evaluator configuration, actual invocation/results, correctness/calibration/coverage metrics; validation separately labeled |
| Tavily | Ground a real upstream API/version repair in primary documentation | Matched on/off cases, valid source/version citations and repaired behavior |

Technological implementation: coherent controller authority and executed proof. Design: verdict-first two-patch experience and measured reader comprehension. Impact: real installs and external-patch reuse with task outcomes. Idea: preservation evidence as the product, explained without exclusivity claims unsupported by competitor evidence.

Phase 13 requires judging operations readiness (owner, finite reserve, archive, current access, credential schedule and monitoring); phase 14 separately verifies actual access through December 15. Future completed checks are not prerequisites for October submission.

Runtime requirements, public licensed source, accessible demo/test build, English description/video under three minutes, feedback and in-period changes all get checkable records in phase 13. Target Coding and Agentic Engineering plus eligible Tavily bonus; overall/track and bonus combinations follow the rules. Optional city prizes require the rule-defined attendance; no location eligibility is assumed. Final deadline is October 30, 2026 at 10:00 Pacific; judge access must last through December 15. Do not rely on 90-day Actions artifacts created in August surviving December judging.

## Local verification, budget and remote boundaries

Every implementation phase follows implement → independent plan review → fix → dedicated reuse/quality review → sequential automated verification → human-readable evidence → stop. Run focused tests then `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`. Core/Action changes rebuild committed `packages/action/dist/index.cjs:1`; `pnpm run verify:bundle` verifies parity. Before pushing core changes run `pnpm run ci:local`; new release/experiment scripts join existing local contracts in phase 10. Use explicit >=30-second timeouts for process/build/sandbox tests. Capture real sanitized provider/log fixtures for product guards before relying on them; if a new live contract is unavailable, mark the guard unvalidated and do not dispatch production using it.

Planning authorizes no remote action. Implementation code/tests can complete locally. Before each paid/public step, prepare the exact source/artifact identities, reviewed command or structured request, intended side effects, finite operation/job/token/time caps, verified price-based maximum and stop/cleanup procedure. All remote budgets start at **zero authorized** for this plan. A concrete separately approved run manifest supplies finite caps; unknown sandbox billing requires an operator-approved provider spend cap or bounded provider units, not a fabricated USD conversion. No automatic retries/batch reruns beyond that manifest. Historical spend is not remaining budget. Preserve a separately approved judging-operation reserve.

Before an intentional push/PR, inspect current GitHub CI/CodeQL/dependency-review/publish/repair-monitor triggers and linked Vercel Git settings. Local `vercel.json` is not proof previews are disabled. Never create or trigger a Vercel preview; use documented non-destructive configuration to disable/bypass a discovered preview trigger before proceeding. No remote debugging loop. Production publishing, npm release, hosted runtime jobs, Data Lab upload/batch, participant messages and Devpost submission each require their applicable existing or new explicit authorization. Prepare reviewable artifacts first. Paid runs use the existing push-freeze procedure and one immutable candidate; monitor every dispatched job to terminal and account for failures/cancellation.

## Revalidation and completion records

Each phase records actual changed paths, tests/commands/results, reviewed source identity, reviewer findings/resolution, unsupported cases and integration commit. Do not prefill implementation checkboxes or invent future release versions/SHAs. Determine the next release version using the release playbook after scope is implemented. A documentation commit need not contain its own hash: identify the measured product source separately from the later evidence index commit.

Changes to core/controller/models/prompts/policy/runtime/challenges invalidate dependent quality evidence; case/oracle changes invalidate affected scores and cross-run comparisons; package/Action packaging changes invalidate public install checks; deployment/config changes invalidate public access checks. A content fingerprint can establish executable equivalence only for its declared path set, following existing release-evidence rules. Preserve old pilot/adoption evidence with its own identity; rerun final runtime gates after any behavior-changing fixes. Cosmetic documentation updates do not automatically justify a new paid full benchmark, but must pass claim/link/submission checks.

Planning completion requires parent/14 phase files, valid dependency graph and links, no unresolved decisions, explicit complete-scope mapping, independent cross-review and clean whitespace. Implementation starts in a subsequent `/implement` task with phase 1. The [planning review](2026-09-05-sutura-verified-repair-program-review.md) records the independent findings, resolutions and checks actually completed.
