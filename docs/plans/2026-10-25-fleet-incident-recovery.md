# Sutura reliability, verified recovery and guided adoption

Date: 2026-10-25. Status: consolidated plan finalized and independently reviewed; ready for owner acceptance. Review receipts are recorded in the private planning annex. Implementation and hosted activation are not implied.

Baseline: `develop`, `22ba8a92c3f53b3f7cd23e631863542102d0dc91`, `/Users/juan/code/sutura`. Local source was clean at planning entry; remote `develop` matched and `main` remained `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a`. Revalidate before execution.

## Objective and accepted scope

Reduce recurring CI incidents and owner intervention through actual consumer fixes, faithful automatic repair, and evidence of recovery. The owner selected **prioritize fixes and verified recovery** on October 25. External developers must also be able to assess one repository, understand support and reach a useful result without adopting the maintainer’s personal workflow. Classification and deduplication support this objective; a quieter monitor alone does not satisfy it. No system can promise zero future failures: completion means the named defects have tested dispositions, deployed fixes have native evidence, and recurrence is measured.

This is the requested RPI plan. It authorizes no implementation, publication, credential mutation, provider operation, paid experiment, notification delivery or production deployment. Each phase has a separate acceptance boundary unless continuation is explicitly authorized. Prepare concrete local changes before requesting the external authority actually needed.

Public documents contain generic mechanisms and synthetic examples only. The private operational annex is `docs/agents/2026-10-25-fleet-recovery-plan/plan-evidence.md`; its source captures and fleet mappings remain ignored. Do not copy private repositories, costs, URLs, logs or credentials into public plans, fixtures, commits or PRs.

The October 25 ordering review and [external adoption assessment](../research/2026-10-25-external-adoption-assessment.md) are incorporated. Owner decisions: weekly digest **by email to the owner**; keep diagnostic coverage for an oversized unsupported repository while excluding automatic repair until supported. The private annex records repository identities. These are capability/design decisions; the current task ends with a reviewed plan.

## Current implementation and evidence limits

The [October 23 public assessment](../research/2026-10-23-sutura-fleet-reliability-assessment.md:7) defines the delivery chain. The [earlier repair plan](2026-10-23-fleet-reliability-repair.md:9) is partially implemented; this plan supersedes its remaining work, not its historical evidence.

| Existing contract | Source at baseline | Planning disposition |
| --- | --- | --- |
| Fixture and safe npm configuration handling | `packages/core/src/security/snapshot-inputs.ts:12`, `:36`; `packages/core/src/executor/contree.ts:1224` | Preserve and test release/consumer adoption; do not reimplement obsolete refusals. |
| Python editable root and Node ranges | `packages/core/src/runtime/python.ts:101`; `packages/core/src/runtime/node.ts:10` | Preserve narrowed support and rejection cases. |
| No blanket lifecycle rebuild; narrow prerequisite stop | `packages/core/src/runtime/preparation.captured.test.ts:14`; `packages/core/src/heal.ts:549` | Preserve; add general failure identity without weakening isolation. |
| Mechanical command with potentially unrelated model excerpt/class | `packages/core/src/diagnose/classify.ts:276` | Correct selected-step evidence in phase 4. |
| Full probes count exit codes; focused probes alone compare failure | `packages/core/src/engine/triage.ts:47`, `:205` | Require identity evidence before claiming original failure reproduction. |
| Exact incident ledger and immutable observations | `scripts/fleet-recovery-ledger.mjs:43`, `:108`, `:142` | Extend through companion evidence, retain raw history. |
| Typed outcomes and fresh delivery reporting already exist | `scripts/fleet-dogfood-metrics.mjs:519`, `:542` | Reuse. Add stronger proof qualification and pre-Action evidence. |
| Later green currently checks workflow/branch rather than equivalent obligations | `scripts/fleet-recovery-ledger.mjs:18`, `:25` | Separate next-green observation from verified recovery. |
| Run normalization drops actor/event and job obligations | `scripts/fleet-dogfood-metrics.mjs:681` | Retain authenticated metadata and evidence provenance in phase 3. |
| Generated monitor enters privileged repair directly | `packages/cli/src/setup.ts:61`; `packages/action/src/main.ts:65` | Introduce secretless admission before expensive setup in phase 6. |

Planning included read-only hosted inventory and primary GitHub documentation; it did not rerun a year of raw data, measure provider capacity, prove organic repair yield or perform a production audit. Historical failure buckets describe triggers, not proven causes. Monthly counts need volume and partial-month denominators. Next-green duration does not attribute labor. Claims that grouping fixes every historical CodeQL run, that all scheduled runs are probes, or that filters remove most monitor failures remain unproven. The private annex reconciles contradictory historical states.

## Design choices

1. **Keep the existing repair engine and ledger.** Add small classification, evidence qualification and presentation components. A replacement orchestration platform or digest-only product would delay the requested fixes.
2. **Separate trigger, cause, disposition and outcome.** Trigger is authenticated event/actor metadata. Cause codes are `source-defect`, `generated-bundle-stale`, `action-version-mismatch`, `installation`, `credential-boundary`, `live-probe`, `provider-resource`, `network`, `sutura-internal`, `unknown`, each with confirmed/suspected/unknown confidence. Dispositions are `repair-supported`, `escalation`, `observe-only`, `intentionally-excluded`. Existing repair outcomes remain unchanged.
3. **No blanket Dependabot/schedule exclusion.** The same supported source assertion has the same repairability across those triggers; existing trust, policy, fork and credential gates still apply. Unknown evidence escalates instead of authorizing speculative execution. Known unsupported cases remain visible with a reason and next action.
4. **Add a versioned companion record, not a second incident database.** Key classification and verification records by repository ID, source run ID and attempt, retaining source SHA, workflow identity and evidence digests. Preserve v2 observations immutably. Current qualified delivery counts join the companion proof; old v2 `resolved-externally`/`sutura-green` labels alone cannot satisfy the stronger contract. Missing new proof is `unmeasured`, not retroactive failure. A later contradictory authoritative receipt invalidates qualification; an incomplete scan alone does not erase valid historical proof.
5. **Deduplicate presentation, not incidents or spending claims.** A recurrence group uses repository, workflow, normalized failure-identity digest, failure signature version, owner domain and verification-contract digest. Unknown identities are not grouped beyond their exact incident key. Each run/attempt remains separate. No cross-repository error-string merging, claim deletion or automatic repeated repair attempt. A new failure after proved recovery opens a new occurrence.
6. **Bound reproduction support.** Use selected-step identities and existing test fingerprints. Unsupported native tools/services/scanners are explicit gaps; never enable untrusted network, lifecycle scripts or credentials to force reproduction. This cycle does not build arbitrary QEMU/service/native-addon execution support.
7. **Deliver a weekly owner email and a durable private queue.** The existing collector renders the report; a small unattended mail adapter adds persisted delivery receipts and bounded retries. Provider acceptance, actual delivery and owner comprehension are separate. The phase 6 contract specifies Resend, schedule, privacy, idempotency limits and recovery. Native GitHub subscriptions are unchanged; no claim that local grouping suppresses them.
8. **Ship known compatibility fixes before new infrastructure.** Thin baseline, local fixes and controlled pilot come first; new journals, identity adapters and onboarding cannot block this subset. Exact candidate checks and captured regressions permit distribution; stage-pass evidence proves stop removal; matched organic reproduction gates the later stable reliability release. These are different claims.
9. **Use guided, repository-scoped adoption.** Provider-free assessment and optional selected-run diagnosis come before account setup. One capability proposal covers only needed access/providers/costs, then resumable configuration, bounded first use and minimal upgrades. No broad home scan, universal plug-and-play claim, or mandatory maintainer-specific RPI/branch/cadence convention. The same support and evidence contracts serve external repositories and this fleet.
10. **Handle terminal causes explicitly.** Known unsupported/setup/resource cases can end advisory execution successfully with a visible non-repair reason. Unexpected internal faults, evidence corruption and security/identity errors remain failed monitors. Admitted `require-fixed` retains its strict failure policy. The complete per-reason matrix is in phase 6; no blanket green `sutura-internal` rule.
11. **Measure useful adoption and real recovery separately.** Downloads, readiness, refusal, captured replay, native-green proposals and integrated repairs are distinct. Preserve all attempted/blocked/assisted onboarding sessions. A more accurate reproduction gate may reduce apparent yield before it improves actual repair quality; phase 4 is a correctness investment, not a promised immediate failure-count reduction.

## Phase sequence

| Phase | Deliverable | Exit evidence |
| --- | --- | --- |
| [1 — Known fixes and minimal baseline](2026-10-25-fleet-incident-recovery-phases/phase-1.md) | Existing fixture/runtime corrections qualified, action grouping, scoped App packet, diagnostic-only disposition | Local regression/gates and concrete rollback/activation packets; uncertain investigations cannot hold the subset. |
| [2 — Compatibility pilot and early activation](2026-10-25-fleet-incident-recovery-phases/phase-2.md) | Approved immutable pilot pins and configuration fixes | Exact native/readback evidence; stop-stage passage when exercised; no event remains unexercised without blocking compatibility distribution. |
| [3 — Evidence contracts and remaining fixes](2026-10-25-fleet-incident-recovery-phases/phase-3.md) | Pilot-scoped proof, shared support records, remaining source investigations | False-green fixtures rejected; descriptors for pilots first; every other incident has a disposition. |
| [4 — Faithful diagnosis and reproduction](2026-10-25-fleet-incident-recovery-phases/phase-4.md) | Grounded selected-step identity throughout repair | Match/mismatch/unavailable tests and support-diff matrix; no silent loss of existing supported classes. |
| [5 — Repository assessment and guided adoption](2026-10-25-fleet-incident-recovery-phases/phase-5.md) | Assess, preview/configure/resume, evidence-aware doctor, upgrade/pause/remove | Supported/unsupported journeys, no ambient credentials, custom wiring preserved, recoverable setup. |
| [6 — Admission, outcomes and weekly email](2026-10-25-fleet-incident-recovery-phases/phase-6.md) | Read-only inspect, explicit error policy, recurring queue and email outbox | No unsupported spend; strict policy preserved; deduplicated delivery/recovery tests and reviewable activation packet. |
| [7 — Stable release and staged installation](2026-10-25-fleet-incident-recovery-phases/phase-7.md) | Qualified full candidate, authorized stable publication and waves | Genuine matched pilot reproduction, full exact-head native gates, immutable repins and activation readback. |
| [8 — Field recovery and external adoption](2026-10-25-fleet-incident-recovery-phases/phase-8.md) | Daily rates, delivered digest, 14-day recurrence evidence and newcomer study | Organic integrated recovery and independent usability tracked separately; insufficient evidence stays PARTIAL/unmeasured. |

Phase acceptance is sequential. Phase 2 records its fixed-window disposition rather than waiting indefinitely for an organic incident; later local work can proceed while live effectiveness remains unmeasured. Within phases, only designated disjoint units are `[batch-eligible]`, at most three implementers and one integration owner, with sequential checks and no working-branch publication. No large reporting rewrite precedes the first compatibility delivery. The later stable waves intentionally use 72-hour windows; around twenty consumers may require roughly three weeks after release, followed by the 14-day observation window. Private inventory supplies the actual calendar.

## Adoption behavior and boundaries

The [assessment](../research/2026-10-25-external-adoption-assessment.md:19) maps ADOPT-01..10 to late compatibility checks, mixed side effects, ambiguous init success, doctor limitations, missing provider-free assessment, native PR approval, unsafe upgrades, weak help, synthetic-only install proof and missing independent-user evidence. Phase 5 addresses the product contracts; phase 8 measures their value. Initial supported shapes are self-contained locked Node/Python verification jobs, with explicit workspace/preparation limits; service-backed jobs elsewhere in a repository do not automatically exclude its supported jobs. Unknown support requests more evidence; unsupported environments retain useful diagnosis and avoid paid automatic repair.

The user journey is assess one repository → inspect an optional selected failure → review capability/access/cost proposal → configure/resume → run one authorized bounded real case → activate and maintain. Evidence stages are static fit, access/configuration, default-branch activation, faithful reproduction, audited patch, exact native checks and integrated recovery. Nothing earlier substitutes for a later stage. A managed service is out of scope; unavailable provider access is a disclosed blocker with a diagnostic path.

The setup API will intentionally replace blind noninteractive init side effects with plan/apply semantics and explicit exit status. Versioned migration instructions, schema compatibility and workflow preservation are acceptance requirements. Assessment is useful without uploading source or requiring inference/sandbox accounts. Public documentation describes the released version, not merely development capability. The follow-up adoption review adds shared assess/doctor/inspect parity by target Action version, explicit trigger reachability and no-opportunity states, and honest cost estimates versus limits. README positions supported job shapes and ConTree access before credential setup. ConTree stays in this cycle; no executor replacement is assumed. Existing external installations form a separately named private operational cohort, distinct from the owner fleet and prospective unaided-user study. Static assessment can find known blockers but cannot certify preparation or exact attempt cost.

## Verification and acceptance

For behavioral phases: captured or synthetic RED → minimal implementation → independent review → repair → simplify → sequential verification. Exercise owned code; mock only external APIs/clocks/providers. Candidate evidence includes base/head/tree identity, command, toolchain, exit status, required/skipped cases and logs. Later success never erases earlier failed receipts.

Run pinned frozen installation, targeted regressions, `pnpm run ci:local`, `pnpm --filter @sutura/core test:coverage`, `pnpm --filter @sutura/action test:coverage`, and `pnpm run test:ci-routing` sequentially for each changed Sutura behavioral phase. `ci:local` includes typecheck, lint, bundle verification, package and invariant gates (`package.json:41`). Rebuild and verify the committed Action bundle after core/Action changes; use unique retained coverage/log locations. Apply consumer-specific full local checks and actionlint for edited workflows. Documentation-only finalization uses links, privacy, source-anchor, phase-contract and diff checks; no product test pass is claimed for planning.

Automated final acceptance: all listed regressions pass; assessment has no unintended execution/access; interrupted setup/upgrade is recoverable; every enrolled workflow has an explicit disposition; terminal paths carry machine-readable reason and recovery instruction; full required check inventories qualify recovery; existing isolation/audit/claim tests remain green; public exports cannot leak private fields.

Manual/externally authorized acceptance: review the rendered queue/email for actionability, then verify authorized delivery separately; measure unfamiliar-user completion/comprehension under the phase 8 rubric; approve prepared administration/publication scopes; verify actual installation and exact-source native execution. Approval is not evidence that an execution succeeded. No eligible event means `unmeasured`, never an invented green.

## Stuck states and recovery

| State | Who sees what | Exit or disclosure | Required recovery test |
| --- | --- | --- | --- |
| Missing/inaccessible repository or incomplete pagination | Owner queue: `UNAVAILABLE`, scope, failed read, last successful observation | Next read-only collection retries within normal bounds; persistent access gap names required access | Permission restoration admits records; partial scans never claim full inventory. |
| Stale collector or runtime/build absent | Owner report and next available email: stale age and launch/build failure | Rebuild pinned source or restore runtime; next scheduled collection resumes; preserve history | Failed launch leaves last-good timestamp; subsequent launch updates it. |
| Missing App/configuration/permissions | Workflow summary and queue: setup stage, missing names only | Prepared installation repair via authorized CLI; no secret values in output | Missing→configured event reaches admission without editing claims. |
| Intentionally excluded/disabled monitor or source drift | Owner inventory: reason, policy revision, installed/desired refs | Explicit reviewed reactivation/pin patch; do not auto-enable | Exclusion remains visible; approved config produces expected admission. |
| Unknown/unsupported or mismatched reproduction | Case file and queue: native and sandbox evidence, reason, required adapter/input | New valid source event/capture re-evaluates support; external action remains separately authorized | Corrected input produces matched proof; ambiguous input stays disclosed, not stuck silently. |
| Exhausted budget/provider/storage failure | Case file: stage, bounds and resource owner | Exact diagnostics then bounded approved remediation; no automatic capacity increase/retry | No extra spend; subsequent authorized distinct event can proceed. |
| Existing attempt claim | Workflow: already attempted and linked prior evidence | Inspect prior result; next distinct eligible source run is new work; same-run repeat requires existing explicit retry policy | Duplicate consumes zero new claim/provider work; distinct event is not blocked. |
| Corrupt/unknown-version companion journal | Collector: integrity failure, affected record and last-good snapshot | Preserve bytes; validated read-only rebuild into a new output generation | Corruption cannot create green; rebuild resumes without deleting history. |
| Candidate CI/proof missing, skipped or wrong SHA | Queue: proposal awaiting named native obligations | Observe legitimate matching completion; do not dispatch/rerun automatically | Matching proof qualifies; wrong identity/required skip never does. |
| Owner-fixed branch moves during repair | Queue: source superseded and current head | Stop obsolete publication; record later green separately and require equivalent-check proof | Concurrent head change cannot publish stale repair or claim attribution. |
| Publication, integration or external delivery pending | Local handoff: prepared candidate/action and authority needed | Owner approves concrete action; agent executes and records readback | No external action from generic readiness; unavailable approval stays visible. |
| Unchanged recurrence or recurrence after closure | Queue: one group with all members or reopened occurrence | Fix source; close only with proof; include unresolved group in next weekly digest | Repeat observation produces no duplicate transition; recurrence reopens. |
| No provider access during onboarding | CLI: diagnostic capability remains available; repair access missing | Named access requirement and resume command after access exists | Assessment works without accounts; restored access advances only the evidenced stage. |
| Interrupted setup or customized workflow conflicts | CLI: incomplete receipt or precise three-way diff | Re-read state, review minimal corrected plan, resume without overwriting changes | Fault after each side effect; restart and drift preserve unrelated configuration. |
| Unknown mail send, bounce, missing sender credentials | Private queue: delivery-unknown/blocked and receipt age | Reconcile provider evidence; scoped correction; no blind resend after idempotency expiry | Lost response, expiry, bounce and restored access tests prove recovery or actionable disclosure. |
| No organic failure or external participants | Evidence report: unexercised/unmeasured | Next eligible normal event or separately authorized study; no fabricated success | Empty-window and zero-participant reports preserve denominators and pending gates. |

## Consumer sweep

Planning commands:

```sh
rg -n 'collectRecoveryLedger|writeRecoveryLedger|classifyFleetIncident|mergeObservations|publicRecoverySummary|collectFleetMetrics|writeFleetMetrics|repairPrsOpened|recovery-summary.json|incidents-v2|sutura-fleet-incident-v2' --glob '!pnpm-lock.yaml' --glob '!dist/**' .
rg -n 'actionWorkflow|installSutura|requiredOutcomeFailure|reportOutcome|sutura-terminal-failure|terminalFailure' packages scripts .github --glob '!**/dist/**'
rg -n 'boundedTriage|triage\(' packages scripts --glob '!**/dist/**'
rg -n 'installSutura|runDoctor|parseArgs|resolveActionRef|adoption-study|review-study|install-test-lib' packages scripts docs --glob '!**/dist/**'
```

| Callers/writers found | Covered disposition |
| --- | --- |
| `scripts/fleet-dogfood-metrics.mjs:343`, `:548`, `:747`; `scripts/fleet-recovery-ledger.mjs:43`, `:125`, `:142`, `:404`; both test files | P3/P6/P8: metadata, companion joins, old-history compatibility, deterministic writes, qualified totals. |
| `docs/adoption/fleet-dogfood-metrics.md:45`, example config; actual installed collector launcher | P2/P3/P7: versioned reader contract and pinned runtime/build availability; private launcher details stay in annex. |
| `packages/core/src/heal.ts:1073`; `packages/core/src/engine/repair.ts:599`; `packages/core/src/index.ts:235` | P4: both bounded/legacy execution paths and exported APIs require identity-aware handling; do not leave direct repair as bypass. |
| `packages/core/src/engine/triage.test.ts:105`; `packages/placebo/src/focused-triage.test.ts:70`; orchestration and replay fixtures | P4: true-match, mismatch, unavailable, budget, focused fallback, local/Action parity. |
| `packages/cli/src/setup.ts:44`, `cli.ts:133`, `index.ts:6`; doctor/setup tests and README verifier | P5/P6: generated contract, doctor readiness and compatible upgrade; P2/P7 minimal consumer migration. |
| Action main/input/acceptance/failure-safe/terminal evidence and their tests; root `action.yml` and `packages/action/action.yml` | P6: add inspect mode while preserving heal default and verify mode, structured setup outcomes, strict outcome behavior; generated bundle included. |
| Existing consumer workflow copies, routing markers and required gates | P1/P2/P3/P7: exact private inventory drives patches; no wildcard regeneration or overwrite of App wiring. |
| CLI args/dispatcher, setup/doctor/release, install-test library, user/security docs and adoption scripts | P5/P8: assess and plan/apply command semantics, receipt readers/writers, honest readiness, upgrade/remove and all-attempt measurement; repeat sweep for new consumers. |
| Proposed queue/outbox serializer, mail adapter, collector launcher and delivery fixtures | P6/P8: atomic versioned state, schedule, provider readback, restart recovery, private export boundaries. |
| Historical research, release receipts and v2 journals | Retained unchanged as dated history. New current reports distinguish their older semantics. |

Repeat these searches when implementation changes shared returns, schemas or signatures. Add every newly found reader/writer/test before phase acceptance. Generated `dist` is rebuilt, not independently edited.

## Durable handoff and entry conditions

Accepted decisions: preserve autonomous repair; known fixes and compatibility pilot first; reuse the ledger; pilot-scoped native descriptors; distinguish trigger/cause and installation/effectiveness; explicitly handle unsupported/resource/internal failures; retain the strict self-monitor; deliver weekly owner email; keep unsupported oversized projects diagnostic-only; add repository-scoped progressive adoption and independent usability measurement. No material architecture choice remains open. Provider capacity/access, raw baseline reconciliation, future events and newcomer behavior remain empirical inputs with defined failure branches, not invented facts.

Next action after owner acceptance is phase 1 in an isolated local worktree based on revalidated integration. Planning is on integration; implementation is not. No release version is selected here: the release workflow takes an explicitly requested version and exact approved scope at its entry. Historical publication/spend authority does not carry into this cycle. No mail, invitations, account changes or hosted rollout occurred during planning.

Each phase handoff records objective/scope, base/current SHA and worktree, findings and dispositions, checks tied to tested inputs, deviations, external limits and next acceptance gate. Preserve it outside disposable worktrees before cleanup. The private annex records original review findings and revision receipts; earlier reviews cover their original version only. Finalization checks cover links, privacy, source anchors, dependency order, recovery tests, consumer sweeps and decision completeness across the parent and eight phase files. These are documentation checks, not product or hosted success evidence.
