# Sutura technical evaluation guide

Reviewed source (historical architecture baseline): `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a` (release v0.3.9), re-reviewed 2026-10-07. Scope: repository source, test definitions, and retained evidence. The [architecture cards](architecture.md) were re-read claim by claim against this source, and the test files they cite were run locally and passed. This is not a fresh deployment or live-provider validation.

Historical source-anchor refresh on 2026-10-07 at integration commit `f87c7ea86dd641669421a0d26f4a2cc1a913fbe9`: the evidence status, demo identity and source anchors below.

## The project in one minute

A green CI command can hide a deleted test, weakened assertion, or repair to the
wrong cause. Sutura investigates failing GitHub Actions and proposes an audited
repair for human review. Its [product workflow](../devpost/sutura-submission.md#product-workflow)
retains failure evidence and never merges the generated repair.

- **Controller authority:** the model proposes a bounded replacement; the
  controller selects its target and runs trusted verification.
  [Source and regression proof](architecture.md#controller-authority).
- **Reusable isolation:** dependency preparation feeds separate reproduction,
  repair, and audit branches. [ConTree evidence](architecture.md#contree-branches).
- **Layered audit:** mechanical checks, a fresh rerun, and semantic review can
  refuse a previously green candidate. [Audit evidence](architecture.md#layered-audit).

On 2026-10-27, the exact v0.4.1 release subject
`3b6152d9d72beebd7dcbaaa4045c94d640456adb` completed 51/51 cases and
55/55 evaluations for USD 4.99103270, with zero false approvals and no
infrastructure stops. It fixed 14/18 repairable cases, caught 17/19 traps,
classified 10/10 flaky cases, and met the rejection-proof criterion for 10/11
deceptive candidates. Hidden repair preservation passed 3/4; one did not run.
The Tavily arm fixed 0/4 upstream cases, versus 2/4 without Tavily.

Three repairs gave up: `python-repair-missing-await`,
`repair-esm-extension-nested`, and `repair-tsconfig-drift`. `repair-bad-import`
was refused. The two traps `trap-pass-with-no-tests` and
`trap-workflow-check-removal` gave up and approved nothing. All 11 deceptive
patches failed independent hidden tests; the workflow-removal run stopped
before supplied-candidate evaluation, so only 10 have defined rejection proof.

The [v0.4.1 evidence index](../demo/sutura-v0.4.1-release-benchmark-evidence.md)
retains every result, workflow URL, cost and identity. Inference cost was USD
0.705778 and sandbox cost USD 4.28525470; median evaluation time was 75.56
seconds. Nine default flaky fixture contents were revised while retaining the
same case IDs and numbered sequences. This supports no like-for-like
improvement claim over older corpus contents.

A separate, earlier development/validation measurement used a different corpus
and candidate. Candidate `042af3aada158347db6006e30a4a0e6e7c65e420` completed all
80 cases for USD 6.431018 in recorded inference and sandbox cost. It repaired 33
of 42 repairable cases (78.6%) with zero false approvals. Hidden repair-preservation
checks passed 4 of 8, with 4 not run, so that gate did not pass. The held-out 20
remain sealed. Read the [sanitized Stage 3 v8 evidence](../demo/run-manifests/development-validation-v8-evidence.md),
[evidence status](#evidence-status) and [limitations](#limitations) before
treating either result as more than its stated scope. The earlier
[Stage 3 v1 record](../demo/run-manifests/development-validation-v1-evidence.md)
remains unchanged as historical evidence of the false approval and defective
cumulative accounting.
The [architecture cards](architecture.md) connect each claim to code and tests.

## Verification implementation

[Generated repairs](../../packages/core/src/heal.ts), [supplied patches](../../packages/core/src/verification/external.ts) and counterfactuals share production verification gates. A separate baseline-only challenge-generation call freezes a bounded set before candidate work. The controller qualifies baseline observations, checks each candidate with repeated probes, then applies policy, mechanical audit, clean rerun and adjudication before search admission. Required contracts bind a frozen source manifest. Default healing remains optional; external verification requires assurance.

The [CLI](../../packages/cli/src/verify.ts) and [supplied-patch Action](../../packages/action/src/verify-execution.ts) retain canonical evidence and artifact bytes. The Action authenticates the exact same-repository failed run and source SHA; fork sources are refused. [Evidence v2](../../packages/core/src/verification/types.ts) records the actual executor baseline image ID separately from an unavailable OCI digest, with observed model, operation and cost records. This implementation shipped in v0.3.0 and later releases (see the [changelog](../../CHANGELOG.md)). Its measured quality is only what the benchmark and development results below report.

Remaining work includes remediation of the development misses, a separately
authorized held-out measurement, a Data Lab batch run (the upload is done, the dispatch was rejected), and
[December judging-access evidence](../runbooks/judging-access.md). The newer local candidate prepares a bounded adoption study; no independent
participant result exists, so this guide makes no claim about external users
or reviewer comprehension. Historical reports below
retain the source and limitations of the runs they describe.

See [evaluation recovery](run-recovery.md) for durable job recovery, cumulative spend reservations, offline failure tests, and terminal notification setup.

<a id="criteria"></a>

## Hackathon criteria

The [official rubric](https://nebiusglobalaihackathon.devpost.com/rules) provides
these four criteria.

| Criterion                    | Supported behavior                                                                | Evidence and limit                                                                                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Technological Implementation | Bounded proposals, isolated execution, independent audit                          | [Controller and audit cards](architecture.md#controller-authority); source and fixture tests do not establish live judgment quality.                                                                                 |
| Design                       | Case selection leads to an explained outcome, provenance, and rejected candidates | [Result renderer `renderResultBody`](../../packages/case-lab/src/render.ts#L410); this review did not test the hosted experience.                                                                                    |
| Potential Impact             | Maintainers receive a diff and verification evidence before deciding to merge     | [Audience](../devpost/sutura-submission.md#who-it-is-for) and [dogfood record](../demo/sutura-v0.2.0-phase-0-evidence.md?plain=1#L28); seeded cases and dogfooding do not establish adoption or measured time savings. |
| Quality of the Idea          | Making CI green is tested against alternative patches and rejecting gates         | [Counterfactual card](architecture.md#counterfactual-verification); the offline survivor and control-only Arena prevent a claim of complete safety or competitive superiority.                                       |

## NVIDIA, Nebius, and Tavily roles

| Integration                                  | Why used                                                                                                                                          | Source or artifact and actual mode                                                                                                                                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NVIDIA Nemotron through Nebius Token Factory | Separate diagnosis, proposal, and audit roles                                                                                                     | [`DEFAULT_MODELS`](../../packages/core/src/config.ts#L11), [`createTokenFactoryClient`](../../packages/core/src/llm/token-factory.ts#L25): implemented runtime client; measured subjects remain in the reports below. Requested role and actual provider model are distinct.                   |
| OpenAI GPT-6 Astra (optional second opinion) | Veto-only adversarial cross-check from a different provider; can only reject, never approve, so it cannot dilute the Nebius/Nemotron runtime gate | [`OpenAiClient`](../../packages/core/src/llm/openai.ts), [`secondOpinion`](../../packages/core/src/audit/adjudicate.ts): implemented, gated on `OPENAI_API_KEY`; absent, failed, or over its own USD 0.30 budget records `skipped` and the run proceeds on Nemotron alone.                     |
| TypeSafe Jev (optional calibrated audit)     | Veto-only calibrated audit voice with typed probabilities; can only reject, never approve, so it cannot dilute the Nebius/Nemotron runtime gate   | [`TypeSafeClient`](../../packages/core/src/llm/typesafe.ts), [`typesafeAudit`](../../packages/core/src/audit/typesafe-audit.ts): implemented, gated on `TYPESAFE_API_KEY`; absent, failed, uncertain, or over its own USD 0.02 budget records the row and the run proceeds on the other gates. |
| Nebius ConTree                               | Share prepared dependencies while isolating execution branches                                                                                    | [`prepareSandbox`](../../packages/core/src/heal.ts#L694): runtime implementation; image availability and dependency support constrain execution.                                                                                                                                               |
| Tavily                                       | Ground dependency failures in release sources                                                                                                     | [`ground`](../../packages/core/src/diagnose/tavily.ts#L500): runtime Search/Extract with validation; [versioned ablations](architecture.md#grounded-dependencies) retain failed arms.                                                                                                          |
| Nebius Data Lab                              | Execute a finite, manifest-bound quality experiment with recoverable submissions and exact output joins                                           | [Runner](../../scripts/datalab-quality-experiment.mjs) and [dataset and request](../datalab/README.md): locally implemented and fixture tested; the reviewed dataset was uploaded on 2026-10-07, but its one batch dispatch was rejected (HTTP 403), so no batch result exists ([record](../demo/nebius-data-lab-upload-2026-10-07.md)).                                                                                              |
| NVIDIA ATIF / NeMo Agent Toolkit             | Export interoperable sanitized trajectories and validate their shape                                                                              | [Committed trajectory and validation command](../../README.md#evaluation-lab): offline validation; NeMo is not the live repair orchestrator.                                                                                                                                                     |

## Follow a Case Lab result

Open the [Case Lab](https://sutura-case-lab.vercel.app/), choose a case, and follow
these source-backed sections. [Replay provenance](../../packages/case-lab/replay/README.md?plain=1#L3)
distinguishes deterministic bundles from recorded-result fallback. The catalog's
[`expectedOutcomeFor`](../../packages/case-lab/src/cases.ts#L54) records expectations, not observations.

| Visible section                                            | Renderer to inspect                                                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Mode badge and failed commit / CI evidence                 | [`renderHeader`](../../packages/case-lab/src/render.ts#L174), [`renderEvidence`](../../packages/case-lab/src/render.ts#L198) |
| ConTree search tree and branch status                      | [`renderSearch`](../../packages/case-lab/src/render.ts#L232)                                                                 |
| Rejected patches and rejection reasons                     | [`renderRejections`](../../packages/case-lab/src/render.ts#L270)                                                             |
| Clean audit branch and Ultra verdict                       | [`renderAudit`](../../packages/case-lab/src/render.ts#L291)                                                                  |
| Accepted patch beside rejected alternatives, when attached | [`renderCounterfactual`](../../packages/case-lab/src/render.ts#L114)                                                         |

Empty search and “Not run” audit states describe that run's path. Text readers
can inspect the renderer and committed artifacts without the site or video.

<a id="evidence-status"></a>

## Evidence status

Canonical reports retain dates, corpus, denominators, outcomes, and identities.
Historical rows were refreshed on 2026-10-07 at integration commit
`f87c7ea86dd641669421a0d26f4a2cc1a913fbe9`. Product source has changed since
the reviewed source recorded at the top of this guide. Benchmark subjects,
matrix Actions, and demo pins remain separate identities. The v0.4.1 benchmark
and source-binding rows were added on 2026-10-27; this does not claim a fresh
claim-by-claim architecture review.

| Evidence                                                                                                            | Status and interpretation                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [v0.4.1 release benchmark, 2026-10-27](../demo/sutura-v0.4.1-release-benchmark-evidence.md) | Published subject `3b6152d9d72beebd7dcbaaa4045c94d640456adb`: 51/51 cases, 55/55 evaluations, USD 4.99103270, zero false approvals and no infrastructure stops. Repairs 14/18; traps 17/19; flakes 10/10; deceptive rejection proof 10/11. Hidden preservation 3/4 passed, one not run. Tavily 0/4 versus 2/4 without. Revised fixture contents prevent a like-for-like comparison with older measurements. |
| [v0.3.9 release benchmark, 2026-10-03](../demo/sutura-v0.3.9-release-benchmark-evidence.md) | Recorded public release measurement on exact subject `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a` (tag v0.3.9): 51/51 cases and 55/55 evaluations for USD 4.92427699; zero false approvals; no infrastructure stops. Trap catch 18/19, fix rate 14/18, flaky accuracy 10/10, deceptive rejection 11/11, Tavily upstream fixes 1/4. Hidden repair preservation passed three of four repair cases; one did not run. Fix rates for v0.3.6 to v0.3.9 were 14/18, 17/18, 13/18 and 14/18, which is run-to-run variance for one live evaluation per case, not a measured trend. |
| [Stage 3 v8 development/validation result, 2026-09-09](../demo/run-manifests/development-validation-v8-evidence.md) | Clean development/validation measurement (not the release result) on exact candidate `042af3aada158347db6006e30a4a0e6e7c65e420`: 80/80 cases completed for USD 6.431018; 33/42 repairs (78.6%); zero false approvals. Hidden repair preservation passed 4/8 with four not run. The held-out split remains sealed. |
| [v0.2.1 repair-quality rerun, 2026-09-05](../demo/sutura-v0.2.1-repair-quality-evidence.md?plain=1#L13)             | Live Placebo v0.2 corpus, 51 cases / 55 evaluations, subject `f5c3056acc96597f1ae11f411a3b9cfe03ba990f`: repair and Tavily gates fail; hidden verification retains three `not-run` cases. Zero observed false approvals does not make it release-ready.                   |
| [Candidate external matrix](../demo/sutura-v0.2.1-candidate-matrix.json#L1)                                         | Live candidate-mode evidence on Action `ce3502d86a32883eac8c7a2adcc9df2c07e12e85`: `repository-policy-refusal` and `python-repair` fail; `ready` is false. This is not a public-release matrix or hosted-demo acceptance.                                                 |
| [Earlier v0.2.1 candidate](../demo/sutura-v0.2.1-phase-0-evidence.md?plain=1#L13)                                   | Failed quality gates on `f8195e8a82ffe1527d755ae7ecb8a047484af9fa`; preserved as historical evidence.                                                                                                                                                                     |
| [Historical v0.2.0 baseline and matrices](../demo/sutura-v0.2.0-phase-0-evidence.md?plain=1#L9)                     | Failed benchmark and both external matrices on release subject `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`; includes unavailable Python-image failures.                                                                                                                    |
| [Current counterfactual report](../demo/sutura-counterfactual-v0.2-initial-failure-v1.json) | Offline deterministic control on the revised fixtures: 10/10 shortcuts rejected, zero expectation mismatches. This is not live repair-quality evidence. |
| [Historical counterfactual report](../demo/sutura-counterfactual-v0.2.json#L1)                                                 | Offline deterministic experiment; a visible-green, hidden-failing alternative survives. See [gate omissions](architecture.md#counterfactual-verification).                                                                                                                |
| [Arena report](../demo/sutura-arena-v0.2.json#L1)                                                                   | Scripted dummy/refuse-all controls exercise scoring; not a measured Sutura comparison.                                                                                                                                                                                    |
| [Fleet recovery observation, 2026-09-28](../demo/fleet-recovery-observation-2026-09-28.md) | Read-only aggregate over 24 configured repositories and 159 failed or timed-out attempts: 0 verified repair pull requests, and 102 of the 141 linked monitor outcomes were infrastructure stops. It predates v0.3.4 through v0.3.9 and is descriptive only; it supports no recovery or savings claim. A v0.3.9 fleet report waits for the observation window that ends no earlier than 2026-10-09. |
| [Demo source identity](../../packages/case-lab/release.json#L1) | Source catalog bound to v0.4.1 Action `3b6152d9d72beebd7dcbaaa4045c94d640456adb` and `placebo-v0.4.1-live-2026-10-27.json`. Actual hosted publication and live-smoke proof are linked from the [v0.4.1 release record](../release/v0.4.1-case-lab-record.md). Historical v0.3.9 deployment remains in its dated record. |

<a id="limitations"></a>

## Limitations and reproducing the review

Source inspection establishes implemented behavior; linked tests establish
existence, not a fresh pass. Live outcomes describe their measured subject.
Offline fixtures omit provider behavior; controls validate a harness; Data Lab
batch inference and final submission evidence remain separate work.
Zero false approvals does not mean every trap was caught: infrastructure and
unsuccessful outcomes remain in the [scoring denominator](../../packages/placebo/README.md?plain=1#L245).

Follow [contributor setup](../../README.md#contributor-setup) and the existing
[offline replay commands](../../README.md#offline-replay). The documentation check
is `node --test scripts/submission-contract.test.mjs`; run project typecheck,
lint, tests, and build sequentially. These local checks do not measure live
repair quality. Current publication evidence follows the [v0.4.1 release record](../release/v0.4.1-case-lab-record.md). The [v0.3.9 release evidence contract](../demo/sutura-v0.3.9-release-evidence-requirements.json#L1) remains historical.

On refresh, review changed source bytes and update inspected references. Keep
reviewed source, historical benchmark subject, and demo Action identity separate;
a documentation commit cannot contain its own final hash.

The local [protected Node reproduction candidate](../reproduction-profiles.md) adds complete native failure sets, reviewed wrapper profiles and a separately approved one-use final-verification allowance. It retains the original full audit and existing default budgets. Synthetic/subprocess and replay regressions are local evidence; native delivery and integration remain separately measured outcomes.
