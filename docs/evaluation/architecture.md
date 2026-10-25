# Sutura architecture evidence cards

Reviewed source: `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a` (release v0.3.9).
Re-review date: 2026-10-07. The cards were first written against
`ce3502d86a32883eac8c7a2adcc9df2c07e12e85` (2026-09-05); each claim and cited line was
checked again against v0.3.9. The test files the cards cite were run locally on
2026-10-07 and passed (10 files, 251 tests). That run is source evidence, not provider
validation: no live model or ConTree call was made for this review.

Start with the [evaluation guide](README.md), its [evidence status](README.md#evidence-status),
and [limitations](README.md#limitations). The cards use stable IDs and seven
visible fields so their claims can be checked without following repository
instructions or interpreting a custom data format.

## Lifecycle and trust boundaries

```text
Failing GitHub Actions run + exact repository state + policy
  -> dependency-input snapshot -> dependency preparation -> source overlay
  -> hook-disabled Git baseline -> initial reproduction -> bounded failure evidence
  -> Nano-first diagnosis -> optional Tavily grounding
  -> reproduction probes, focused on the failing test file when the runner
     supports it, under a cumulative sandbox-time budget
  -> persistent failure: diagnosis recovery, then bounded Super proposals
     (or controller-granted edits) and controller-run tests
  -> passing candidate walks the ordered verification gates: policy, mechanical
     checks, held visible result, fresh suite rerun from the patched image,
     frozen challenges, adjudication (Ultra, plus optional veto-only second
     opinions), repository policy, resource limits
  -> outcome: fixed (evidence-backed repair PR for human review), flaky-no-patch,
     refused, gave-up, or infra-stop
```

The [existing architecture diagram](../devpost/sutura-submission.md?plain=1#L55)
shows the service roles. Dependency preparation is a distinct network-enabled
stage; reproduction and repair stages record disabled-network execution.
[`prepareSandbox`](../../packages/core/src/heal.ts#L614) constructs the staged
images and can freeze the source when the policy has verification contracts;
[`healCase`](../../packages/core/src/heal.ts#L1689) first reproduces the
observed command, then [`repairFailure`](../../packages/core/src/heal.ts#L941), a
budget wrapper around [`repairFailureWithinBudget`](../../packages/core/src/heal.ts#L979),
coordinates diagnosis, triage, search, and verification. A budget abstention ends
as `gave-up`. Runs may stop before search or verification: a flaky result, a
sandbox-time budget stop, and an upstream-dependency give-up each end early.
Supplied patches and counterfactual alternatives use the same verification
modules ([`external.ts`](../../packages/core/src/verification/external.ts#L79)).

<a id="controller-authority"></a>
## Controller authority over proposals and verification

| Field | Evidence |
| --- | --- |
| Claim | The controller selects a bounded target set of one to two policy-admissible source excerpts, one slot per excerpt. The model supplies replacement text for each slot; controller code derives the coordinates, applies the patch, runs trusted verification, and submits a candidate internally. A failing test result is a checkpoint that feeds the search, not a candidate. |
| Product value | A proposal cannot select an arbitrary file or substitute an easier command to manufacture success. Maintainers receive a candidate whose execution path is controlled and recorded. |
| Criterion | Technological Implementation; Quality of the Idea. |
| Implementation | `selectRepairTargetSets` picks the target set and caps it at two files: [repair-targets.ts:138](../../packages/core/src/engine/repair-targets.ts#L138). `prepareControlledRepairProposalTemplate` selects editable source and constrains the response: [repair-attempt.ts:196](../../packages/core/src/engine/repair-attempt.ts#L196). `runControlledRepairAttempt` derives target coordinates and owns tool execution: [repair-attempt.ts:534](../../packages/core/src/engine/repair-attempt.ts#L534). `repairFailureWithinBudget` constructs trusted commands: [heal.ts:1115](../../packages/core/src/heal.ts#L1115). |
| Verification | The regression “replays live runs 13 and 14: the model cannot select a path or line range” asserts no sandbox call and a bounded retry: [repair-attempt.test.ts:435](../../packages/core/src/engine/repair-attempt.test.ts#L435). The budget reservation test checks worst-case inference reservation before a request: [repair-budget.test.ts:25](../../packages/core/src/engine/repair-budget.test.ts#L25). |
| Mode and revision | Source and test definitions inspected at `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a` on 2026-10-07; the cited test files ran and passed. Regression fixtures and mocked responses are not a new live-model run. |
| Limit | Bounds restrict authority, not semantic error. A selected excerpt can omit the real cause; a syntactically valid replacement can still be wrong. Candidate submission is not permission to merge. Since the first review the controller can also grant a controller-exact edit (for example inserting an `await`) that bypasses the model; those grants are controller-authored and are verified through the same gates. |

<a id="contree-branches"></a>
## ConTree branches across preparation, triage, repair, and audit

| Field | Evidence |
| --- | --- |
| Claim | Dependency preparation precedes source overlay; triage, adaptive repair search, and audit use isolated execution branches. The verification rerun executes the suite from the candidate's patched image with the network disabled. Search records lineage and bounded expansion, and admits a branch only after full verification. |
| Product value | Prepared dependencies can be reused while each branch preserves its own execution evidence. A reviewer can trace what reproduced, what changed, and which candidate survived. |
| Criterion | Technological Implementation; Design. |
| Implementation | `prepareSandbox`: [heal.ts:614](../../packages/core/src/heal.ts#L614); `ContreeExecutor.snapshot`: [contree.ts:170](../../packages/core/src/executor/contree.ts#L170); legacy `triage`: [triage.ts:47](../../packages/core/src/engine/triage.ts#L47) and the bounded `boundedTriage` used by `healCase`: [triage.ts:163](../../packages/core/src/engine/triage.ts#L163); `adaptiveSearch`: [search.ts:103](../../packages/core/src/engine/search.ts#L103); the production rerun from `winner.imageId` in `evaluateRuntimeCandidate`: [runtime.ts:74](../../packages/core/src/verification/runtime.ts#L74) (the exported `audit` helper keeps the same rerun at [audit.ts:102](../../packages/core/src/audit/audit.ts#L102)). `DEFAULT_SEARCH_LIMITS` defines configurable search defaults: [search.ts:7](../../packages/core/src/engine/search.ts#L7). |
| Verification | “uploads only dependency manifests before network-enabled preparation”: [contree.test.ts:830](../../packages/core/src/executor/contree.test.ts#L830). “uses stable lineage and deterministically expands the best beam”: [search.test.ts:24](../../packages/core/src/engine/search.test.ts#L24). |
| Mode and revision | Source and test definitions inspected at `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a` on 2026-10-07; these links establish fixture coverage, not fresh ConTree execution. |
| Limit | Runtime-image availability and supported dependency forms constrain execution. Bounded search can exhaust its budget without finding a repair; branching alone proves neither an optimal patch nor a successful audit. |

<a id="layered-audit"></a>
## Layered audit and refusal after a green command

| Field | Evidence |
| --- | --- |
| Claim | A production candidate walks an ordered gate stack (`VERIFICATION_GATE_ORDER`): reproduction, policy, mechanical checks, held visible result, fresh suite rerun in the candidate image, frozen runtime challenges, semantic adjudication, repository policy, and resource limits. The adjudication step is Nemotron Ultra plus two optional veto-only voices (GPT-6 Astra, TypeSafe Jev) that can only add refusals. A failed fresh rerun returns refusal before any model call. |
| Product value | Earlier success cannot override a later execution failure. The refusal retains bounded failure output and avoids spending on an adjudication, or on either optional voice, whose prerequisite has already failed. |
| Criterion | Technological Implementation; Quality of the Idea. |
| Implementation | `evaluateRuntimeCandidate` is the production path, called for searched and supplied candidates: [runtime.ts:47](../../packages/core/src/verification/runtime.ts#L47). The gate order is [`VERIFICATION_GATE_ORDER`](../../packages/core/src/verification/evaluate.ts#L20). Its failed-rerun branch records the skipped model rows: [runtime.ts:79](../../packages/core/src/verification/runtime.ts#L79). The exported `audit` helper keeps the mechanical, held, rerun and adjudication subset: [audit.ts:56](../../packages/core/src/audit/audit.ts#L56); the heal path no longer calls it. |
| Verification | Production path: “refuses when the fresh rerun fails” with neither veto voice called: [runtime.test.ts:198](../../packages/core/src/verification/runtime.test.ts#L198). Helper: “refuses when the fresh suite rerun fails and does not call Ultra”: [audit.test.ts:215](../../packages/core/src/audit/audit.test.ts#L215). “refuses a mechanically clean patch when Ultra finds the wrong-cause repair”: [audit.test.ts:199](../../packages/core/src/audit/audit.test.ts#L199). |
| Mode and revision | Source and controlled executor/model tests inspected at `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a` on 2026-10-07; the cited test files ran and passed. |
| Limit | Mechanical rules and model judgment can miss defects. The ordering regression does not measure the auditor's live semantic accuracy or prove all repository policies were exercised. The optional voices only veto: `skipped` and `uncertain` rows pass, and they never approve a candidate. |

For the bounded example, the fixture supplies an honest diff, an earlier held
candidate, and a fresh executor exit code of 1. It also queues an approving model
reply. The assertions require refusal, retained “Assertion failed” output, and
zero model calls. Thus the queued approval cannot rescue the failed rerun. This
is an inspected test of controller ordering, not an observed live refusal. The helper
test above drives that fixture; the production-path test at
[runtime.test.ts:198](../../packages/core/src/verification/runtime.test.ts#L198) covers the same ordering through
`evaluateRuntimeCandidate`.

<a id="flake-triage"></a>
## Flake triage with explicit uncertainty

| Field | Evidence |
| --- | --- |
| Claim | Progressive reproduction records counts, a versioned confidence method (`sprt-p20-p80-a05-b05-v1`), Wilson interval, and stop reason. Mixed pass/fail evidence continues to the configured maximum rather than stopping at a crossed numeric boundary. Triage runs under a cumulative sandbox-time budget (default 240 s) and, when the runner supports it, first reruns only the failing test file. If the next probe would exceed the budget, triage stops with status `not-run` and stop reason `sandbox-budget`, and the run ends as `gave-up`. |
| Product value | The terminal result explains how much reproduction evidence exists and why sampling stopped, helping distinguish a persistent failure from an intermittent one. A budget stop is not evidence for or against flakiness. |
| Criterion | Technological Implementation; Potential Impact. |
| Implementation | `completedTriageVerdict` retains evidence: [triage.ts:25](../../packages/core/src/engine/triage.ts#L25). `boundedTriage`, which `healCase` calls, adds the sandbox-time budget and focused probes: [triage.ts:163](../../packages/core/src/engine/triage.ts#L163). `evaluateFlakeConfidence` implements decisions and boundaries: [flake-confidence.ts:58](../../packages/core/src/engine/flake-confidence.ts#L58); `wilsonInterval`: [flake-confidence.ts:40](../../packages/core/src/engine/flake-confidence.ts#L40). |
| Verification | Mixed-sequence maximum and bounded interval regressions: [flake-confidence.test.ts:39](../../packages/core/src/engine/flake-confidence.test.ts#L39). Budget stops: [triage.test.ts:105](../../packages/core/src/engine/triage.test.ts#L105). Focused probes and the restart on a pass or mismatch: [triage.test.ts:229](../../packages/core/src/engine/triage.test.ts#L229). Measured v0.3.9 flake outcomes (10/10) are in the [release benchmark evidence](../demo/sutura-v0.3.9-release-benchmark-evidence.md); the [v0.2.1 report](../demo/sutura-v0.2.1-repair-quality-evidence.md?plain=1#L48) is historical. |
| Mode and revision | Source and tests inspected at `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a` on 2026-10-07; the cited test files ran and passed. The linked benchmark reports evaluate their own named candidates. |
| Limit | Finite samples and the declared statistical assumptions cannot prove that a test never flakes. A benchmark's classification rate is bounded by its corpus and denominator. A sandbox-budget stop yields no verdict. |

<a id="grounded-dependencies"></a>
## Grounded dependency diagnosis

| Field | Evidence |
| --- | --- |
| Claim | Tavily Search and Extract provide dependency-release citations. Optional release extraction checks exact package/version registry ownership and accepts matching public release sources. |
| Product value | Diagnosis can use release-specific evidence when installed dependency behavior changes, with inspectable citation provenance instead of relying solely on model recollection. |
| Criterion | Technological Implementation; Potential Impact. |
| Implementation | `TavilyClient.search`: [tavily.ts:140](../../packages/core/src/diagnose/tavily.ts#L140); `TavilyClient.extract`: [tavily.ts:214](../../packages/core/src/diagnose/tavily.ts#L214); `addRegistryVerifiedReleaseCitations`: [tavily.ts:460](../../packages/core/src/diagnose/tavily.ts#L460); `ground`: [tavily.ts:500](../../packages/core/src/diagnose/tavily.ts#L500). |
| Verification | Exact npm ownership and malicious/unrelated extraction tests: [tavily.test.ts:248](../../packages/core/src/diagnose/tavily.test.ts#L248), [tavily.test.ts:335](../../packages/core/src/diagnose/tavily.test.ts#L335). Upstream-case results with Tavily are in the [v0.3.9 release benchmark evidence](../demo/sutura-v0.3.9-release-benchmark-evidence.md) and its [result file](../demo/placebo-v0.3.9-live-2026-10-03.json); the [v0.2 report](../demo/placebo-v0.2-live-2026-09.md?plain=1#L1), [v0.2.1 result](../demo/placebo-v0.2.1-live-2026-09-05.json#L1) and [v0.3.0 benchmark](../demo/sutura-v0.3.0-release-benchmark-evidence.md) are historical. |
| Mode and revision | Source and fixture tests inspected at `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a` on 2026-10-07. `tavily.ts` and its tests have not changed since the first review, so the line anchors above are unchanged. Live results retain their own subject SHA and date. |
| Limit | Validated citations do not guarantee a correct proposal. Historical v0.2 failed all four upstream repairs in both arms. The recorded releases v0.3.7, v0.3.8 and v0.3.9 fixed 2, 2 and 1 of the 4 upstream cases with Tavily, so the 4/4 Tavily gate was never met. Neither establishes consistent benefit on arbitrary dependency failures. Grounding runs only for dependency, environment-config and build classes, retries a first 403 once, and recovers from a repeated 403 only through registry-verified release extraction. |

<a id="counterfactual-verification"></a>
## Counterfactual verification and surviving alternatives

| Field | Evidence |
| --- | --- |
| Claim | Alternative patches are evaluated through rejecting gates, recording evidence and added cost; passing alternatives can survive. Each alternative runs patch policy, the verification race, and then the shared runtime verification (`evaluateRuntimeCandidate`). If the shared repair budget runs out, completed alternatives are kept and the evidence is marked insufficient (`budget-exhausted`). The committed offline experiment exercises only deterministic portions of this path. |
| Product value | Reviewers can inspect why a shortcut was rejected even when visible tests passed, and see examples where the available verification remains insufficient. |
| Criterion | Quality of the Idea; Technological Implementation. |
| Implementation | `evaluateCounterfactuals` evaluates each alternative through the shared verification gates ([`VERIFICATION_GATE_ORDER`](../../packages/core/src/verification/evaluate.ts#L20)): [evaluate.ts:173](../../packages/core/src/counterfactual/evaluate.ts#L173). `DETERMINISTIC_GATES` and omitted-gate reasons define the offline scope, which mirrors that order without calling the core function: [counterfactual.ts:71](../../packages/placebo/src/counterfactual.ts#L71). Supplied patches share the gates through [`executeExternalVerification`](../../packages/core/src/verification/external.ts#L79). |
| Verification | “approves an alternative that passes every gate” uses controlled dependencies: [evaluate.test.ts:316](../../packages/core/src/counterfactual/evaluate.test.ts#L316). The [committed offline report](../demo/sutura-counterfactual-v0.2.json#L1) retains each alternative, rejecting rule, hidden result, cost and the controller authorization recorded for each case; it was regenerated after the first review. |
| Mode and revision | Source and test definitions inspected at `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a` on 2026-10-07; the cited test file ran and passed. The report is offline corpus evidence, not fresh provider adjudication or validation of this source revision. |
| Limit | Offline coverage omits a second-image suite rerun, provider adjudication, and repository-policy commands absent from fixtures. Deleted-test and test-touching alternatives are now rejected at the patch-policy gate; the mechanical gate still catches shortcuts that policy admits. `python-repair-missing-await/drop-the-coroutine` survives deterministic checks while failing hidden verification. The [Arena control report](../demo/sutura-arena-v0.2.json#L1) remains dummy/refuse-all scoring evidence, not a comparative Sutura win. |
