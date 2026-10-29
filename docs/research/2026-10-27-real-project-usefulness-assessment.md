# Making Sutura useful on real projects

Date: 2026-10-27. Baseline: `82f0554dbad8ad3a9febfc77867ea1ce64e15430`, local and remote develop. Scope: source assessment, existing-run downloads and local evidence preservation. No implementation, new execution, routing change or publication.

## Question and conclusion

Why does controlled benchmark success fail to produce useful repairs on the owner's projects?

The immediate bottleneck is reaching a faithful, supported reproduction of the actual failed job. The next engineering cycle should take current fleet incidents through capture, a failing regression, a production fix and exact native verification. Two directly inspected incidents stop before repair inference. One is a CI control check that cannot run meaningfully in an application sandbox; the other cannot establish complete matching diagnostics.

Success means a useful repair PR passing the project's native checks. Integration remains a separate observation under existing human authority. Every unsuccessful attempt and coverage gap stays in the measurement.

## Observed fleet evidence

The private collector summary was captured at `2026-10-27T08:10:07.850Z`. It covers mixed historical Action versions and has incomplete collection and baseline coverage. Status is **PARTIAL**, not a measurement of v0.4.1 effectiveness.

- 410 recorded repair attempts: 237 infra-stop, 153 gave-up, 17 unknown, two fixed and one flaky-no-patch.
- The two fixed sandbox outcomes are dated September 26. Verified native repair proposals and integrated recoveries remain unmeasured.
- Within the collected October 20–27 window: 101 attempts, 51 infra-stop, 40 gave-up, ten unknown and zero recorded fixed outcomes.
- Those 101 records report provider invocation false for 72, true for 19 and unknown for ten. Only five have a positive search-start observation; missing search evidence is not a confirmed negative.

Sources: `.sutura/fleet-dogfood-metrics/summary.json:1`, `events.jsonl` and `recovery-summary.json:1`. The private appendix preserves selected run/source identities, event rows and the source hash at `docs/agents/2026-10-27-hackathon-final-window/real-project-assessment-cases.json`. Private project identifiers and logs are excluded from this public assessment.

## Findings

### REAL-01 — Unsupported control checks reach application preparation

A retrieved October 27 case failed a GitHub PR merge-parent/routing guard. Its command required shell, Git and GitHub workflow context. Sutura selected the repository's Python runtime, prepared dependencies and executed seven sandbox operations, then stopped with zero repair inference. The case file required a supported command and exact package-script provenance.

The current implementation prepares the sandbox at `packages/core/src/heal.ts:1814`. Failure-identity comparison later refuses unsupported command provenance at `packages/core/src/engine/failure-identity.ts:318`. The refusal protects correctness, but the known unsupported command category could have been routed before preparation.

Recommended change: admit the exact selected job and command before importing an image or preparing dependencies. Route Sutura control checks through the existing Sutura coordination boundary with repository, commit and native run evidence. Preserve cadence settings and permission boundaries.

### REAL-02 — Real wrapper commands and diagnostic boundaries prevent reproduction

A retrieved October 27 CLI case ran a repository-specific PTY test-selection wrapper. Native CI reported an assertion failure. The sandbox record ended with exit code -1 and a selected-file listing, without the matching assertion. The case stopped at failure-identity with incomplete native/sandbox diagnostics, zero triage attempts, no search and no repair inference.

The exact cause of sandbox exit -1 is **UNAVAILABLE** from this bounded inspection; a timeout is not established. The recorded replay is incomplete, with a pending model boundary, so it cannot be presented as a complete replay fixture.

The identity gate requires complete diagnostic evidence at `packages/core/src/engine/failure-identity.ts:317`. An unmatched identity returns gave-up before model diagnosis/search at `packages/core/src/heal.ts:1066`.

Recommended change: capture the exact wrapper, manifests/configuration, selected failed test, working directory and prerequisites. Establish a trusted focused reproduction retaining the original assertion, followed by full required native verification for any repair. Preserve the identity check; improve command support and evidence collection rather than accepting a different sandbox failure.

### REAL-03 — Reporting loses the new stop reason

Confirmed against both retrieved case artifacts: workflow logs report `stop=failure-identity`, but `parseCaseFileHtml` returns `triageStopReason: null`. Its expression lists older reasons and omits failure-identity at `scripts/fleet-dogfood-metrics.mjs:111`.

Recommended change: retain the exact stop reason and bounded reproduction explanation in the observation, with regressions from these real artifacts. Rebuild affected local summaries from preserved evidence without deleting history. This reporting repair must not itself be counted as a recovered project.

### REAL-04 — Existing incident learning does not establish delivered repairs

Real fleet incidents have already influenced code. Captured tests cover failed-step windows, long TAP failures and package-relative paths at `packages/core/src/github/fleet-gated.captured.test.ts:12` and `packages/core/src/github/fleet-gated.captured.test.ts:108`.

However, the central captured-bundle contract requires its listed bundles to come from the Sutura repository at `scripts/captured-fixtures.test.mjs:103`; several adapter/runtime/provider imports remain explicitly pending at `scripts/captured-fixtures.test.mjs:43`. This is not an inventory of every fixture, but coverage is not universal. The four selected October 27 monitor IDs were not found in package, script, research or plan sources during this assessment. Existing regressions do not demonstrate delivery for those current incidents.

Recommended change: turn current real incidents into the next regression inputs. Preserve repository shape, lockfiles, wrapper commands and failure signatures. Use private fixtures or reviewed sanitized equivalents for private source. Require a regression to exercise the failed production boundary and fail without the corresponding fix.

### REAL-05 — Infrastructure and source access also block attempts

Other selected collector records report sandbox disk exhaustion and inability to fetch an exact failing SHA. These are recorded observations; their provider/account root causes were not independently investigated here. Keep them separate from application repair. Provide a specific recovery action and preserve measured or unknown costs. Patch search depends on first obtaining the actual source and usable execution environment.

## Alternatives and recommended direction

| Option | Expected value | Limitation |
| --- | --- | --- |
| Another unchanged controlled benchmark | More sampling of that corpus | Does not repair the inspected fleet boundaries. |
| Another model or broader patch authority | Could help some admitted repair cases | The inspected stops happen before repair inference; expansion is not supported by this evidence. |
| Incident-led reproduction and delivery fixes | Directly targets observed failures and creates reusable proof | Recommended; acceptance must include native behavior, not only fixture passes. |

## Smallest useful next increment

1. Repair stop-reason reporting and cheap unsupported-command admission using the existing real artifacts.
2. Repair one supported wrapper/reproduction path, starting with the inspected CLI incident and preserving its native failure.
3. Demonstrate a correct source patch and repair PR passing exact native verification. Record integration only when independently observed; do not merge automatically.
4. Use another independent incident in that supported class to check generalization. Keep unresolved and unsupported cases visible.

Initial success is one real repair delivered with native proof, followed by repeatability on another incident. No arbitrary test count, success percentage or new evaluation platform is required. Controlled safety tests remain regression checks; real incident delivery becomes the primary product acceptance evidence.

## Limits and handoff

No fresh full-fleet scan or paid execution was started. Existing logs and artifacts were retrieved for two gave-up cases, and four selected collector records were inspected. No engine/configuration change, test run, provider mutation or public disclosure occurred. The baseline remains `82f0554`; this new assessment is local and uncommitted. Private evidence is retained under `docs/agents/2026-10-27-hackathon-final-window/`.

This is a prioritized diagnosis, not an implementation or a claim that all root causes are solved. Next implementation should be bounded to the inspected admission, reproduction and reporting paths, reuse unchanged passing safety evidence, and be accepted against original-case behavior. New paid verification and publication retain separate authority and an explicit budget.


## Planning refinement — 2026-10-27

The follow-up planning inspection resolved REAL-02's earlier unknown: the preserved provider HTTP response explicitly records a 60-second timeout, killed signal and timed_out=true. The normalized executor result drops those details (`packages/core/src/executor/contree.ts:339`). The complete selected-step log is available in the recording and contains two distinct failures; an excerpt cannot replace that complete set. The full native command exceeded the current 600-second repair maximum (`packages/core/src/engine/repair-budget.ts:15`), so explicit deadline propagation alone cannot make the incident deliverable.

REAL-03 also needs a writer/parser repair: identity stops bypass legacy SPRT text (`packages/core/src/report/format.ts:111`), so simply adding a regex alternative would not parse the preserved artifacts. Action orchestration and local healing are distinct preparation entry paths and both require admission coverage.

The original incident's PR is now merged. It is a historical regression input; any new organic delivery claim must use a current eligible incident and exact native proof. The [real-project repair plan](../plans/2026-10-27-real-project-repair.md) records these findings and their bounded implementation/authority contracts. Original private evidence and incomplete replay status remain unchanged.
