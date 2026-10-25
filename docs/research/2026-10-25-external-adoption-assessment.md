# External adoption and first useful result assessment

Date: 2026-10-25. Baseline: `develop` at `22ba8a92c3f53b3f7cd23e631863542102d0dc91`. Scope: evaluate whether unfamiliar developers can obtain useful results, what onboarding is needed, and how this should affect the proposed reliability work. Assessment only; no product/configuration changes, installs, external recruitment, provider executions or remote mutations.

## Recommendation

Sutura should offer **guided, repository-scoped adoption with automatic compatibility assessment and progressive activation**. It should not promise universal plug-and-play repair. First demonstrate what it can do for the selected project, then request the access and provider setup needed for that specific capability. Keep the underlying automatic repair objective; a readiness report alone does not establish repair value.

Package distribution is implemented, but activation, compatibility, upgrades and independent user benefit remain separate problems. External day-one value is **unmeasured** in the evidence inspected. The later addendum adds verified historical operational evidence from existing external installations; it does not establish unaided user success. The initial target should be explicitly supported GitHub Actions repositories with self-contained tests and reproducible locked dependencies, rather than every repository that happens to use Node or Python.

## Criteria and method

Criteria: useful result before unnecessary setup; correct support verdict; faithful reproduction; understandable evidence/next action; minimal purpose-specific access; bounded cost; resumable setup; preservation of existing workflows; safe upgrades; no reliance on the maintainer's personal conventions.

Evidence: current CLI/source/help, local stable-tag comparison, user/security guides, install smoke implementation, evaluation/adoption material, runtime contracts and primary GitHub documentation. `npm view sutura version dist-tags --json` returned latest `0.3.9`. Local bundled `--help` worked. `git diff --name-only v0.3.9 HEAD -- packages/cli` was empty: CLI onboarding has not changed between stable and this development head. Core compatibility has changed, so identical CLI version output does not mean a published runtime includes unreleased fixes.

This was source inspection and bounded read-only verification, not an outsider usability trial or a rerun of the public-package install suite. No participant result was found in the inspected adoption directory; that does not establish that nobody has ever tried the product. Prior fleet anecdotes are not used as external adoption evidence.

## Current experience and concrete findings

| Finding | Observed behavior | Consequence |
| --- | --- | --- |
| ADOPT-01: compatibility arrives late | Public setup requires Git, Node, authenticated `gh`, repository administration, inference key and ConTree token/project before the main flow (`docs/user-guide.md:7`; `README.md:264`). ConTree access is described by the project as access-controlled beta. | A prospective user can invest in accounts and configuration before learning whether the project is reproducible. Provider account-access time has not been measured. |
| ADOPT-02: installer mixes tasks | `installSutura` writes the workflow, then uploads available selected environment values to GitHub, including optional audit-provider keys (`packages/cli/src/setup.ts:180`, `:189`, `:203`). Secret values correctly use stdin (`:145`). | No configuration preview/provider-selection step; partial failure can leave partial state. Ambient optional credentials can enable more processing than the newcomer intended. |
| ADOPT-03: success is ambiguous | Missing required values become instructions, while init returns zero (`packages/cli/src/setup.ts:198`, `:220`; `packages/cli/src/cli.ts:130`). | File generation, configuration and readiness are not distinct machine-readable outcomes. |
| ADOPT-04: doctor checks wiring | Doctor checks local workflow/pin, literal input expressions and secret-name presence (`packages/cli/src/doctor.ts:39`, `:129`, `:168`). It does not test runtime fit, actual credential validity, hosted default-branch activation or faithful reproduction. | A PASS is not evidence that the first useful repair can run. It also requires the literal automatic-token expression (`:105`), which can reject legitimate App-token wiring. |
| ADOPT-05: own-project value needs setup | Help offers init/doctor/heal/verify/audit/replay/evaluation, not a provider-free project assessment (`packages/cli/src/args.ts:6`). Heal and verify require providers; audit requires inference and is reduced assurance; replay requires a complete supplied recording. | The no-account Case Lab and replay demonstrate behavior, but do not establish fit or benefit for the visitor's repository. |
| ADOPT-06: native repair CI has a second setup boundary | Generated workflow uses `github.token` (`packages/cli/src/setup.ts:86`); guide explains approval/App-token choices (`docs/user-guide.md:131`). | A newcomer can get a proposed repair yet still need to understand why its native CI is waiting for approval. Treat that as onboarding, not a late troubleshooting surprise. |
| ADOPT-07: upgrading is manual integration | No upgrade command; pins are per repository. `init --force` replaces the whole workflow and is unsuitable for customized installations (`docs/user-guide.md:169`). | Publishing npm does not upgrade consumers. Default-branch activation, preserving App wiring and detecting drift need a supported lifecycle. |
| ADOPT-08: help assumes prior knowledge | Syntax-only help; bare invocation/subcommand help handling does not provide a guided entry (`packages/cli/src/args.ts:233`, `:420`). | Users must learn the conceptual model from long documents before selecting the useful command. |
| ADOPT-09: install tests are not usability evidence | Public install test builds a synthetic consumer and a GitHub CLI shim, then checks generated wiring/version (`scripts/install-test-lib.mjs:185`, `:222`). | Valuable packaging and contract tests do not measure real permissions, provider access, compatibility or independent completion. |
| ADOPT-10: user-study evidence is absent from inspected records | Prepared study is explicitly unsent (`docs/adoption/verified-repair-study.md:3`); evaluation guide says no participant study planned and makes no user-comprehension claim (`docs/evaluation/README.md:51`). | Day-one benefit and unaided use cannot be asserted. Existing study instruments can be reused after a new explicit study decision. |

Current [GitHub documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow), retrieved October 25, says automated-token PR open/update events create approval-required runs; App/PAT alternatives can enable automatic PR workflows. Therefore neither “CI always starts automatically” nor the old blanket “the token can never trigger PR CI” is an adequate product explanation.

## Repository fit is a capability question

| Shape | Source-backed support boundary | Onboarding implication |
| --- | --- | --- |
| Simple Node project | Node sandbox majors 22/24; frozen install with lifecycle scripts disabled (`packages/core/src/runtime/node.ts:43`, `:61`) | Best initial profile, but language alone cannot establish test/environment parity. |
| Node workspace | Declared workspace manifests with bounded pattern grammar (`packages/core/src/executor/contree.ts:707`) | Detect actual workspace shape; do not advertise arbitrary monorepos. |
| Python | Fixed Python image; frozen uv or exact hashed binary requirements; narrow root-editable support (`packages/core/src/runtime/python.ts:24`, `:101`, `:152`) | Explain supported lockfile/interpreter shape before asking for sandbox access. |
| Python workspace/source/VCS/private dependencies | Unsupported forms rejected (`packages/core/src/runtime/python.ts:87`, `:120`, `:165`) | State what is unsupported and why; do not suggest weakening the guard. |
| Native addons, lifecycle-generated inputs | Generic rebuild deliberately removed (`packages/core/src/runtime/preparation.captured.test.ts:14`) | Need a reviewed preparation recipe or an explicit unsupported result. |
| Browser/system packages, Docker/services or other specialized tooling | No general environment-provisioning contract established in this assessment | Check each capability; “Node detected” cannot mean “application reproducible.” |
| Large/polyglot source | Bounded runtime evidence, depth and entry limits (`packages/core/src/runtime/detect.ts:81`, `:153`) | Ask only for the unresolved runtime/project boundary; show limits rather than guess. |
| Complex fixes | Current controller limits repair targets (`packages/core/src/engine/repair-targets.ts:15`) | A compatible environment does not imply every failure is autonomously repairable. |

Some current explanatory text still describes earlier runtime/security behavior. For example `docs/security/data-boundaries.md:48` describes a blanket rebuild stage removed in current implementation, while older Python descriptions omit the narrowed root exception. Onboarding disclosures must be versioned against shipped code, not silently replaced with unreleased behavior.

## Recommended adoption experience

The following is proposed product behavior, not existing CLI functionality or an implementation plan.

1. **Understand one selected repository locally.** Read bounded manifests, lockfiles and workflow definitions without executing repository scripts, reading secrets or uploading source. Show likely support, blockers, uncertainty and the useful next action. Detect actual branches and package tools; do not impose this maintainer's branch names, RPI process, cadence or local layout.
2. **Inspect a relevant failure with scoped read access.** Use an explicitly selected CI run or supplied log. Explain exactly which repository/run data will be read. Classify the failure and tell the user whether a source fix, workflow/configuration fix or external action is appropriate. Keep static assessment distinct from reproduced evidence.
3. **Present a short capability proposal.** For example, “I can attempt source-test repairs in these workflows; these service-backed jobs remain diagnostic-only.” Show detected facts; ask only about material unknowns such as service requirements, intended repair scope or permission to use selected providers. Do not ask the user to manually describe everything already in the repository.
4. **Configure only the selected capability.** Preview workflow diff, provider destinations, credential names, publication privileges and spend limits before applying them. Do not auto-enable optional providers merely because keys exist in the shell. Reuse existing repository-scoped authentication where appropriate; request new permissions only at the operation that needs them.
5. **Prove the path with one bounded result.** Prefer a real existing failure selected by the user. Explicit live authorization covers execution/provider cost; it does not imply merge authority. Report static fit, access, prepared environment, faithful reproduction, audited patch, native CI and integration as distinct stages. A recorded demo is labeled recorded; a seeded challenge is labeled seeded. A project without a current failure can establish readiness, not an invented repair.
6. **Enable ongoing operation and maintain it.** Activate on the actual required branch with verified subscription/readiness, then explain outcomes and pause/resume/removal. Provide resumable setup and minimal reviewed upgrades that preserve customized wiring. Report what remains unsupported and changes in support after upgrades.

This is onboarding, but most of it should be machine work. It should feel like choosing a useful capability and reviewing a concrete proposal, rather than completing a long questionnaire or debugging a generated YAML file.

## Access and trust boundaries

Start with the chosen repository, not the entire filesystem/workspace. Optional multi-repository assessment should enumerate and confirm roots; it is an extension, not a prerequisite. Avoid following symlinks into siblings, scanning home-directory credentials or collecting unrelated files. Existing snapshot/runtime path boundaries are useful foundations (`packages/core/src/executor/contree.ts:1074`; `packages/core/src/runtime/detect.ts:137`).

Separate local inspection, GitHub read access, source/log processing by external providers, configuration writes and repair-PR publication. A single meaningful review can authorize a concrete scope; repeated generic confirmation screens are not the goal. Show what leaves the machine, its destination and the available retention controls before live processing. Source copied to a remote sandbox remains external processing even when source-bearing execution has networking disabled.

A managed service might later remove BYOK/account provisioning friction, but would add billing, hosting, retention and operations responsibilities. It is a distinct product/business decision. This assessment recommends improving the current model and measuring where users fail before committing to that change. A wizard cannot make unavailable sandbox access available.

## Alternatives and trade-offs

| Approach | Benefit | Limitation | Assessment |
| --- | --- | --- | --- |
| Keep installer; improve documentation | Small change; preserves current behavior | Users still discover compatibility after account/setup effort | Necessary cleanup, insufficient alone. |
| Advertise universal plug-and-play | Simple promise | Contradicts environment/runtime/permission boundaries; likely repeats failures | Reject without broader demonstrated support. |
| Broad workspace agent with broad access | More context and possible personalization | Higher trust burden; still cannot guarantee faithful CI environment | Reject as default onboarding. |
| Repository assessment + progressive activation | Early fit/diagnostic value; narrow access; reuses planned classification | Needs new product flow, honest support matrix and measurement | Recommended. |
| Fully managed repair service | Potentially less provider/account friction | Significant commercial and operational scope beyond reliability repair | Separate future decision after measured evidence. |

## Measure actual use, not installation counts

Reuse prepared instruments but distinguish readiness value, correct diagnosis, verified repair and integrated recovery. The current adoption finalizer selects exactly three accepted records with outcome coverage (`scripts/adoption-study.mjs:311`); it is not an unbiased adoption-rate denominator. Preserve all blocked, failed, assisted and withdrawn attempts in the attempt ledger (`scripts/review-study.mjs:53`). Downloads, public demo views and shim-backed smoke tests remain separate metrics.

Recommended initial study: maintainers of unfamiliar-to-builder repositories, using the actual immutable public package/Action and frozen instructions. Include a straightforward supported Node case, a supported Python case and an intentionally unsupported environment. Measure two clocks: total time from interest including account provisioning, and active setup time. Record every intervention, manual configuration, credential/access blocker, provider cost, misunderstood outcome and upgrade/resume failure. Participants retain control of repository/source disclosures.

Proposed usability criteria, not measured claims: supported participants reach a useful correctly understood result within a 30-minute active session without undocumented author intervention; unsupported participants receive a correct explanation and next action before paid execution; four of five reviewers identify verdict, evidence limit and next action unaided within 60 seconds. Readiness/refusal success is not counted as repair success. At least one genuine supported source failure must produce independent native-green repair evidence before claiming that path demonstrated; seeded results cannot substitute.

Counterevidence that would change the recommendation: repeated independent users succeed unaided with the current flow, making a smaller UX change sufficient; or most users are blocked by provider access rather than configuration, increasing the case for a different execution delivery model. If support assessment falsely promises reproducibility or users still need the author to interpret output, the guided-onboarding design has failed its core purpose.

## Relationship to the reliability plan

The existing six-phase reliability plan remains valuable and unmodified by this assessment. Its inventory, failure-identity, classification and native-proof work should become reusable capabilities for an external repository, not assumptions about a specific fleet. The proposed plan revision should add adoption as a first-class acceptance track before implementation contracts are frozen:

- define the supported initial customer/project profiles and unsupported outcomes;
- reuse compatibility/classification/proof code in a provider-free repository assessment;
- separate prepare/configure/activate and make setup recoverable;
- qualify doctor by evidence level and support valid customized credentials;
- provide safe per-repository upgrades and versioned documentation;
- measure fresh external-user journeys alongside fleet rollout and repair yield.

Do not delay all engine correctness fixes while designing a new onboarding product. Conversely, do not finish a fleet-specific rewrite and assume external usability can be added with documentation afterward. These are parallel acceptance dimensions sharing core contracts, not two competing product objectives.

## Handoff and decisions

Objective and baseline are above. Existing uncommitted fleet-plan documents were preserved. Two bounded read-only investigations covered CLI/installation and runtime/adoption evidence; both returned completed findings. No required investigation result is missing. Remaining unknowns are provider-access lead time, real newcomer completion, actual willingness to grant access/pay, and performance on unfamiliar repositories; they require measurement rather than invented estimates.

No application tests were run or claimed: the executed checks were local help, immutable source comparison, npm metadata lookup and source/document inspection. No provider/account/privacy terms beyond the cited current GitHub behavior were independently revalidated; provider restrictions described here are the project's documented requirements.

Recommended next decision: accept repository-scoped progressive adoption and revise the reliability plan with that acceptance track. Recruiting people, running paid first-use trials or operating a managed service requires separate concrete scope. Assessment ends here; it does not authorize implementation or outreach.

## Addendum — external-installation feedback and assessment precision

The owner supplied a second agent's report about existing external installations. This adds an operational evidence source that the original assessment did not inspect; it is distinct from a completed independent usability study. Read-only verification and named repository/run receipts are retained in ignored `docs/agents/2026-10-25-fleet-recovery-plan/external-cohort-verification.md`. The consolidated eight-phase plan incorporates a separate existing-external-installation cohort; the earlier six-phase reference above describes the assessment's original point in time.

The read-only run audit confirmed historical non-repair attempts with preparation stops and a provider timeout, all executed under an older Action version. The currently installed newer pin had no exercised repair in the observed window. Other selected installations had only skips consistent with successful watched CI; no eligible failed source run was found for them. This corrects the evidence gap in the original assessment: external operational evidence exists, while independent first-use success, user awareness and perceived usefulness remain unmeasured. The exact cohort, dates, counts and run/pin identities remain in the private verification report.

The feedback reinforces assessment before account provisioning and narrower public positioning. Those mechanisms were already in the consolidated plan; the enhancement makes their acceptance more precise: doctor invokes the same assessment as the local entry point and hosted inspect; reports are per selected CI job and target Action version; trigger configuration and observed delivery are checked separately; current preparation evidence and a useful next action are available to the developer without the maintainer's collector. README must put supported job shapes and the provider-access prerequisite before the credential checklist.

Three qualifications prevent new promises from outrunning the evidence:

- Existing external installation is not proof of unaided adoption. No eligible failed CI means repair is unexercised, not proven broken or useless. A preparation stop is a real exercised failure, but its log alone cannot establish what the developer saw, understood or valued. Retain the exact window and installed Action version before comparing old failures with current code.
- Core already provides reusable local checks, not only sandbox-time checks: Node selection reads local metadata (`packages/core/src/runtime/node.ts:10`), snapshot enumeration/validation precedes upload (`packages/core/src/executor/contree.ts:1074`), and configuration guards reject unsafe inputs (`packages/core/src/security/snapshot-inputs.ts:36`). The missing-prerequisite detector requires execution results and optional native logs (`packages/core/src/heal.ts:563`). Static validation can reject known blockers and identify candidates; it cannot prove dependency installation, environment fidelity or eventual trigger delivery. Extract safe shared rules without constructing a live executor during assessment.
- Static repository inspection cannot predict an exact attempt cost. Configured inference/audit limits (`packages/core/src/engine/repair-budget.ts:1`) omit other execution/runner charges. The plan now requires dated assumptions for any modeled cost range and explicit unknown components; observed cost and enforceable limits remain separate. No provider calls or pricing lookup occur by default in local assessment.

The recommended promise is guided setup for assessed, self-contained Node/Python jobs with the required provider access. It excludes application secrets, unsupported native preparation and services in the selected job, not every repository that contains another service-backed workflow. Keep ConTree for this cycle and disclose its documented access-controlled prerequisite. Alternative executor feasibility and isolation equivalence have not been investigated; this feedback does not justify an executor rewrite or a universal plug-and-play claim.
