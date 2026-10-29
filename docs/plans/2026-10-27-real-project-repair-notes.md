# Real-project repair implementation notes

Implementation approved by the owner on 2026-10-27 with continuation across all four phases. Local changes target `develop`; paid execution, publication, consumer changes and long-verification spending retain separate authority.

## Phase 1

Base: `da981874d4280419dd60148748cf26a199d56750`, product baseline `82f0554dbad8ad3a9febfc77867ea1ce64e15430`. Worktree: `/Users/juan/code/sutura-real-project-repair`; branch `fix/real-project-repair-20261027`.

Implemented optional process termination and monotonic wall duration, stage/replay/Case Lab preservation, guarded reproduction and candidate consumers, explicit HTML stop metadata, scoped historical parsing, and immutable richer observation selection. Provider-operation SUCCESS is retained independently from a killed process. Provider signal -1 is normalized as its no-signal sentinel; historical absent evidence remains unknown. Two saved private incident artifacts reparsed into a new immutable journal with unchanged attempt identities and outcomes; no fixed, native-qualified or integrated recovery is created.

Independent review found and resolved: provider no-signal normalization; failed patch evidence loss; stale passing-test reuse after thrown execution; focused-probe mislabeling; provider versus process completion; malformed HTML attributes. Reviewers approved their source dispositions. Three simplify passes found shared process predicates appropriate for reuse, removed an unnecessary compiler configuration change by restoring the existing Node directive, and found no material efficiency issue. No architecture expansion was needed.

Initial RED receipts captured timeout decoder, identity, triage and audit failures. Expanded regressions exercise repair submission, supplied baseline, controller authority, typed observations, replay, reports and collector history. Six HTML snapshots changed only to add explicit triage-stop metadata. Historical timeout fixtures remain unchanged; current regression expectations now reject abnormal checkpoints instead of admitting them. Final phase gate receipts remain pending at this candidate commit; acceptance will record all exits, including repaired failures, before phase 2 starts.

Private evidence: `docs/agents/2026-10-27-real-project-repair-implementation/` in the permanent root checkout, including fixture hashes, both derived observations, immutable journal, failed/passing command logs and per-command exit records. These files contain private evidence and are excluded from public history.

## Deviations

- The complete local gate's bundle and candidate-install checks compare against committed HEAD. They necessarily reject a dirty implementation. Preserve the locally built candidate in a local commit, then run those exact identity checks; reuse passing checks for unchanged inputs rather than rebuild and repeat unrelated suites.
- Initial production compilation failed because a newly inserted import preceded the existing triple-slash Node directive. Restore that directive to the first line; no compiler-policy change remains.
- The evaluator's tested `prepareSandbox` source anchor moved by one line. Update that documentation link alongside the source change.

### Phase 1 acceptance

Accepted locally at `b29ac8438b2200c5b416af239afcd366af0be4fb`. All ci:local obligations passed using composed receipts after preserving the initial failures: release contracts (one moved source anchor repaired and its 15-test module rechecked), README/install setup, ATIF and Python evaluation, offline smoke, typecheck, lint, built bundles, all workspace tests, exact candidate install and guard coverage. Core coverage: 2,354 passed / 11 intentionally skipped; Action coverage: 211 passed. Remaining package tests passed, including 266 Placebo tests across 17 files. The corpus test took 1,205.85 seconds; it ran once. Final clean-candidate bundle, install and guard checks all exited zero. No paid provider call, hosted dispatch, publication or consumer mutation occurred. Source/review receipts and original failed exits remain in the private evidence directory. Phase 2 may now begin.

## Phase 2

Implemented admission before image import in Action and local healing, plus fallback re-admission. The known complete protected routing script stops with zero executor/model calls; unknown scripts and application commands defer to ordinary evidence checks. The stopped CaseFile uses existing gave-up/failure-identity contracts, not-run triage and a visible coordination instruction. CLI assessment and Action inspection now preserve the same blocker through real workflow parsing, including a job with another supported step.

Source checkout and provider-operation errors carry optional origin-owned code/stage/details. Exact fetch exhaustion retains the failing SHA and ref-attempt count; only the provider's exact FAILED errno-28 shape receives disk-exhaustion metadata. Common bounded recovery descriptions reach Action artifacts/outputs/check text and CLI evidence. Recovery text stays private in collection; public output admits only aggregate whitelisted codes. Source/resource failures remain red and require-fixed remains strict. No retry, cleanup, permission change or hosted setting mutation is introduced.

TDD receipts cover entry-path zero calls, fallback, direct/unknown commands, quoted and heredoc specimens, static adapter parity, exact-ref restoration, differing-HEAD refusal, positive/negative provider errors, strict outcomes and recovery disclosure. Independent review found and repaired the static extraction parity loss, heredoc false positive and mixed-job aggregation loss. Final disposition and local gates remain pending for this candidate.

Simplify reviewed reuse (one recovery helper), quality (full-script recognition rather than marker text) and efficiency (bounded pure admission with no I/O). The duplicate recovery lookup in artifact rendering was removed. Raw review and RED/GREEN receipts remain in the permanent private implementation directory.

### Phase 2 implementation adjustment

The plan called for a narrow structural control-script recognizer. Marker-line matching also recognized a harmless heredoc that printed the script. Use the complete reviewed script fingerprint after indentation normalization instead. This deliberately recognizes only that confirmed script; new variants stay unknown until reviewed. This is a bounded admission rule, not a generic shell interpreter or new authorization mechanism.

### Documented wall-duration correction

A read of the provider's [limits and usage documentation](https://docs.tokenfactory.nebius.com/sandboxes/operate/limits-retention-and-usage) confirmed operation `duration` as seconds, while raw resource units require separate confirmation. The original saved response contains top-level duration 60.6; the first synthetic structural fixture had incorrectly placed it in metadata. Preserve that earlier fixture/hash as history, add a corrected current fixture, map wallTimeSec from top-level duration, and leave absent historical wall duration unknown instead of deriving it from raw monotonic_time. RED covers both the corrected value and unknown historical duration. This changes the decoder only; retained raw elapsed/cost fields and termination evidence remain intact.

The complete P2 ci:local gate passed at 73783346b543e3b9e108e0214d6d31406993e05f, including the 20-minute local corpus check and 758/758 guard coverage. The decoder correction invalidates its focused executor tests, Core coverage/source static checks, bundles and exact candidate-install identity. Those checks are rerun; unchanged corpus, native contract and Action-source evidence is retained. No second corpus run is needed for this provider-only mapping correction.

### Phase 2 acceptance

Accepted locally at `dc47a3674283e51c246368ddf9326b39dfd78508` (P2 implementation at 73783346b543e3b9e108e0214d6d31406993e05f, followed by the documented provider-only duration correction). Independent reviewers approved all source findings. Full ci:local passed at the P2 implementation candidate. Updated Core coverage passed 2,377 active tests with 11 explicit skips; retained Action coverage passed 217 tests. Updated guard coverage passed 758/758. Rebuilt Action, root typecheck/lint through the normal commit hook, clean bundle identity and exact candidate install all passed after the correction. The corpus and unrelated contract checks retain their passing unchanged-input receipts. No paid execution, publication or hosted activation occurred. Phase 3 may begin.

### P3 protected policy for an explicitly approved historical source

- **Expected:** an authenticated one-attempt grant can select an unresolved old source after the pilot profile is enrolled.
- **Found:** ordinary push admission requires the failing source to remain the branch tip and policy is read at that source. A newly enrolled protected policy necessarily has a different commit.
- **Chose:** retain ordinary automatic admission unchanged; the explicit adapter grant separately binds the historical source SHA and the newer protected policy SHA/ref, verified from authenticated protected-ref evidence. It cannot substitute branch HEAD for the source or use candidate policy.
- **Why:** this implements the approved explicit retry boundary without erasing old claims or granting automatic historical retries. It does not authorize any live attempt.

### P3 complete diagnostics and profile unit

- Full selected-step Node diagnostics precede the display cap. Two-failure fixtures and actual local Node wrapper/probe execution agree on the complete identity set; clipped, killed, missing/changed/extra failures and JSON trust claims are rejected.
- Independent review identified native completion inferred from GitHub failure conclusions and undeclared loader/environment inputs. Both corrected: the selected step requires one normal exit-1 footer, and the initial profile rejects environment files/output destinations while requiring digested safe loader inputs.
- Protected profile resolution occurs before provider import in Action and local healing; stale/missing evidence returns a named review action. Ordinary profiles/policies remain optional. The original full command is retained separately from the complete focused probe.
- Focused integration receipt `p3-profile-integration.log`: 298 tests passed in eight files. Actual subprocess receipt: `p3-profile-subprocess.log`. Phase 3 remains unaccepted pending execution/authorization, review and full gates.

### P3 provider deadline preflight adjustment

- **Expected:** verify the authenticated account's provider timeout maximum before an approved long execution.
- **Found:** the primary provider documentation specifies a `limits` map from read-only `GET /v1/whoami`, but does not publish a stable timeout-limit key. Guessing a key or treating a packet's numeric maximum as provider evidence would be unsound.
- **Chose:** add optional protected-profile `providerTimeoutLimitKey`. A live adapter requires this reviewed key and checks its numeric account-effective value against the approved packet through authenticated GET before issuing/reserving the grant. Missing/unknown/insufficient metadata stops before provider operations. Synthetic tests explicitly use synthetic limit keys; they do not assert actual account support.
- **Why:** the owner reviews the semantic key together with the protected pilot profile. Product code validates actual returned account metadata without introducing a default provider maximum or a paid capability probe. Pricing remains an explicitly approved reservation, not an invoice ceiling; raw operation cost is not billing reconciliation.
- Primary reference: https://docs.tokenfactory.nebius.com/sandboxes/operate/limits-retention-and-usage (read 2026-10-27). No actual provider endpoint has been invoked in this implementation session.

### P3 execution unit and independent findings

- Added opaque packet/candidate/operation capabilities, explicit CLI digest + common-Git append-only account/reconciliation, protected authenticated owner-dispatch authority, source/policy read separation and a shared long-operation poller. All four live entry points now receive profile/final-budget wiring; supplied paths retain the original request/full audit separately from focused probes.
- One-shot search consumes the selected image/diff before cancel/drain and rejects competing candidates. Fake-clock full production audit stack beyond 600 seconds passes with reserved model capacity, unchanged command and all duplicate baseline/candidate policy checks; ordinary ports stay closed. New isolated modules and old focused suites pass; this is synthetic local verification, not a real repair win.
- Independent execution review found: per-category challenge deadline must be clamped; transport errors must not become provider terminal proof; adjudication's time hold must be released before later policy checks and adjudication itself bounded cumulatively; cancellation/drain must have a bounded terminal exit. All four findings are resolved and their focused regression receipts pass. Deadline-faithful replay additionally records controller clock inputs and consumes the same operation permits. The reviewer approved the completed source; the final hostname binding pins new authenticated CLI reads to github.com. Full phase gates now follow on the stable source.
- Core production build initially failed after a new import accidentally preceded `contree.ts`'s triple-slash Node type reference. Restoring the reference to the first line fixes the normal build; no TS configuration workaround is needed. All failed receipts remain retained.

### P3 simplify and source-review closeout

Independent source review approved the final source after the explicit GitHub hostname regression passed. Three simplify passes covered reuse, quality and efficiency. Reuse: shared environment, process and deadline helpers preserve one implementation across entry points; no further abstraction is needed. Quality: the normal compiler directive is restored and obsolete interim findings above are resolved. Efficiency: bounded diagnostic reads, clock recording and single-candidate verification avoid repeated execution; no speculative rewrite was applied. CLI clean-build inputs include the consumed package tsconfigs. Added the append-only account regression to the standard release-contract command so it remains an automatic gate. No new source behavior was introduced during this closeout.

### P3 final gate repairs

The first full gate stopped on a moved prepareSandbox documentation anchor; its complete submission-contract module passes after the link correction. The other release-contract modules passed and are retained. Core coverage passed 2,477 active tests with 11 intentional skips. Action coverage exposed a duplicate-attempt regression: recorder clock binding preceded the existing claim guard. Moving binding just after a successful claim preserves the original controller start timestamp and AlreadyAttemptedError. The package Action metadata also now mirrors the two new root inputs. Focused E2E/metadata tests pass; repaired Action coverage passes 220 tests. The guard scan identified seven unexercised new rejection paths; focused negative tests now exercise all seven paths without exclusions or threshold changes. Final guard coverage passes 821/821; Core coverage passes 2,480 active tests with 11 intentional skips and Action coverage passes 225 tests. Full gates continue from the failed boundary; the long corpus check has not run for P3 yet.

### P3 unchanged fixture-check reuse

The owner explicitly requires avoiding redundant verification. The P3 full-gate attempt and all repaired failures are retained. A new Placebo run was interrupted (exit 130, not GREEN) when the unchanged expensive corpus self-check was recognized. The four pure fixture self-check cases retain their P2 passing receipt; all other Placebo tests, including the real failure-identity and recovery consumers, rerun on P3. Their dependencies are the unchanged Placebo corpus/runtime and evaluation canonical JSON; they do not call changed Core execution. Git trees are identical: Placebo add8627473d8de62237699ecefbaf3ee2b95c4fc and Evaluation e4964415d2e79b77dbf38275a77a4aec6f35f7e3 at both accepted P2 and P3. Lockfile/workspace metadata and Node 24.22.1 are unchanged. This is composed evidence, not a fresh uninterrupted full-suite pass. No production test command or threshold is weakened.

The workspace CLI tests also exposed an old-contract fixture in doctor. The default fixture now advertises v2, and explicit v1/unavailable cases still require target-contract-unavailable. Its focused module passes. The full root build corrected an Action-only build made against stale generated Core output; the rebuilt normal bundle is committed and its exact-source comparison passes. These are bounded fixture/build repairs; unchanged successful gates are reused.

### P3 gate result before exact-candidate install

Independent plan/source review is approved. Fresh Core: 2,480 passed / 11 intentional skips; Action: 225 passed; Evaluation: 133 passed; Case Lab: 243 passed; CLI: 245 composed passes, including 16 passing doctor tests and the added old-contract case. Placebo: 262 fresh passes plus four unchanged P2 fixture-check passes, explicitly composed. Guard coverage: 821/821. README/setup, ATIF/Python evaluation, offline runtime, typecheck, lint and normal root build/bundle comparison pass. Routing modules passed in the release-contract selection. Original private native step digest ef40b8085711f14c0b0e401f5795d02d38a66cae70472f17a0f228f7486de2f5 passes production parsing with exactly two identities and 194 total / 192 passed / 2 failed. All failed/interrupted receipts remain retained. Exact clean-candidate install follows this local preservation commit; Phase 3 acceptance requires its zero exit.

### Phase 3 acceptance

Accepted locally at `246657676e44024b8d3edd1f0a0e9b7019b56c51`. The exact candidate package installs with that Action commit. The complete applicable gate is composed from the successful receipts above and retained unchanged-input evidence; earlier failed/interrupted runs remain visible. Independent source/oracle review and simplify are approved. The original raw native log also passes the production complete-set parser with both original failures. No provider execution, dispatch, publication or consumer mutation occurred. Phase 4 local preparation may proceed.

## Phase 4

The original source and human repair are preserved privately with immutable hashes, exact source/run/attempt/job/step and existing merge/native readbacks. The original PR is resolved and is historical only. The next-incident rule was frozen before current observation. The bounded latest-100 run inventory has older unadjudicated failures and is not a complete historical inventory; no new failing native event appears after the training merge in that returned window. There is no newly delivered Sutura recovery or independent-incident result.

The pilot's authenticated default-branch read reports unprotected. A policy declaration cannot grant protection. Secret/variable names are present remotely, but local ConTree credentials were absent in the checked environment/root configuration; their values and provider access are not claimed. A reviewed immutable prepared Linux runtime, authenticated provider timeout metadata, pricing/reservation and explicit one-attempt authority remain execution prerequisites. A local Node 22.22.2 installation does not prove native Linux or sandbox equivalence. The private preparation manifest is explicitly non-executable, with no invented source event, image, rate, grant or receipt. Native policy/producer preparation remains separate from deployed enrollment.

### P4 delivery-boundary adjustments

- **Expected:** the new authenticated long-verification path can publish its distinct attempt and pass the existing native collector.
- **Found:** publication hard-coded the old unsuffixed repair branch, and the collector accepted only workflow_run monitors. An owner workflow_dispatch would therefore fail after its repair rather than produce usable delivery evidence.
- **Chose:** bind dispatch publication to the actual live authenticated authority, exact source/engine/caller/workflow blob, attempt 1 and provenance-derived branch. Persist only that bounded authorization in the existing receipt. The targeted native collector admits it only under the existing protected producer/Action/source/parent/diff/native checks. Copied strings, reruns and unrelated events remain ineligible. Ordinary monitor behavior is retained. Automatic fleet discovery of another workflow is not implied.
- **Why:** this closes a concrete transport mismatch in the approved one-pilot delivery path without a new queue, event framework or authority grant.

- **Expected:** proposal and later integration receipts retain the same enrolled protected policy source identity when the branch advances without a policy change.
- **Found:** the receipt CLI resolved the policy ref to its latest commit, while the collector correctly retained the enrolled source commit.
- **Chose:** add an optional exact source-commit argument to the existing CLI, with authenticated ancestry and unchanged-blob validation; preserve the legacy invocation.
- **Why:** immutable source identity can survive unrelated integration advances without blessing a changed or rewritten policy. No branch setting or consumer publication follows from this local correction.

### P4 local verification and disposition

The delivery-boundary changes passed independent review. Fresh Action coverage: 232 tests. Guard coverage: 821/821, using unchanged valid Core production coverage and the fresh Action report. The shared real authority fixture passes 28 Core authority tests and normal Action typecheck. The complete native receipt/collector/incident/queue/field selection passes 120 tests, including the reviewed 12-job repair and 14-job historical release shapes. Normal root build passes. Existing unchanged Core, CLI, Evaluation, Case Lab, README/setup, ATIF, runtime and Placebo evidence remains valid; the P4 product changes are confined to Action publication and native receipt/collection. No redundant corpus run is needed for those unrelated leaf changes.

The private native draft also prepares a bounded authenticated associated-PR integration selector: exact merged commit, develop base, same head/base repository and a valid ordinary or dispatch Sutura repair head. Ordinary QUICK/covered cadence is preserved. Its 16 local tests exercise the actual proposed planner/CLI with only external GitHub calls replaced. Native checkout proof precedes candidate commands, and the isolated producer derives the actual last policy-file commit before invoking the exact-source receipt CLI. Independent review approves the bounded draft. Final immutable product pins, workflow/profile digests and private manifests are bound once after the final clean local commit. Deployment, branch settings and credential/provider permissions remain unchanged.

Local source implementation is GREEN; pilot execution remains PARTIAL_NOT_EXECUTABLE. P4-ORIGINAL has complete historical source/log/human-patch provenance and passing production parsing, but an actual-source fresh full repair remains unmeasured. P4-ENROLL is prepared and not deployed. P4-REAL, P4-INDEPENDENT and P4-INTEGRATION remain unmeasured. P4-RECOVERY has passing local adversarial proof tests and explicit blocked-state instructions. The original 101-attempt denominator is unchanged; no new recovery, success rate or hackathon effectiveness claim is created.

The local closeout targets develop, preserves private evidence outside disposable trees and removes only the two owned worktrees/branches after preservation and ancestry checks. Final clean-candidate bundle/install and integration identity are recorded in the permanent closeout receipt. No push, release, hosted dispatch, paid attempt, consumer edit or setting change is part of this delivery. The next execution needs a current eligible source, protected native/profile/caller enrollment, actual provider/runtime/deadline/pricing evidence and a separately approved one-attempt grant.
