# Phase 3 — Faithful bounded reproduction and full audit

Parent: [real-project repair](../2026-10-27-real-project-repair.md). Dependencies: accepted phase1 evidence and phase2 admission. Owner design decision: permit a separately approved long-verification budget and keep existing defaults. This phase implements local behavior; that design decision does not authorize a live long-running job.

## Outcome

A reviewed protected profile maps a supported repository wrapper to a direct Node test-runner probe retaining the complete native failure set. Every operation receives an explicit deadline and retains termination evidence. Focused work cannot substitute for the original full audit, and ordinary runs retain their existing limits.

The primary historical incident has two native failures, an execution killed at the provider's 60-second default, and a full native suite longer than the current 600-second repair limit. Each of those obstacles has its own oracle. Passing only timeout propagation is insufficient.

## Profile and evidence contracts

Extend policy v1 with optional `reproductionProfiles`; preserve old policies without it. Initially allow at most eight profiles, each with a unique bounded ID and:

- An exact native command and repository-relative working directory; direct Node test-runner argv, without shell interpolation. Preserve semantically relevant flags and runner/environment behavior; only the existing controller environment allowlist is allowed.
- Up to sixteen reviewed repository-relative source-input paths and SHA-256 values covering wrapper, selector/configuration and relevant manifests/lock. Existing snapshot/read limits and denied paths still apply. Protect policy/profile inputs against candidate edits for the selected attempt.
- An explicit native runtime and approved sandbox image/runtime. Exact matching or separately reviewed equivalence is required; matching major versions alone do not establish equivalence for this incident. Unavailable runtime support produces a visible stop.
- A probe deadline (positive and at most 600 seconds), the original full verification command and full deadline. The profile also contains a bounded approved-caller list: at most eight workflow IDs/path/blob SHA/protected-ref bindings and enrolled approver IDs for the one pilot. These are reviewed policy data, never inferred from a candidate or dispatch payload. Profile definitions cannot weaken existing requiredCommands, frozen challenges, policies, path/file limits or audit.

Load profile authority from the existing protected-base policy boundary (`packages/core/src/orchestrate.ts:683`), then match exact checked-out source bytes. A matching hash is not semantic authorization. Candidate-supplied policy or model-generated commands cannot create a profile. Absent/stale inputs show which path/digest requires review; the agent prepares a reviewable protected-policy diff and documentation, rather than executing arbitrary wrapper code to discover its meaning.

Introduce an additive bounded native diagnostic envelope shared by Action and local paths. It binds the exact source/run/job/step, parser version, original selected-step digest, normal completion/summary counts and every distinct complete failure identity. Default bounds: at most 64 identities, 2 KiB of diagnostic material per identity and 128 KiB total, inside existing authenticated download/snapshot limits. Overflow, missing summary, unfinished blocks, unsupported diagnostics and conflicting counts produce an explicit incomplete status.

For the selected Node wrapper, parse the complete authenticated step stream before deriving the 200-line display excerpt. The primary fixture must yield exactly two distinct failures. Keep the raw/display truncation flags truthful; the separate structured envelope establishes completeness only for its supported diagnostic contract. Generic text cannot set envelope trust. Other runner families retain existing matching behavior; this phase does not implement arbitrary wrapper interpretation for them.

## Execution and budget design

1. Resolve the profile and complete native diagnostic set before paid preparation/search. Build a direct supported focused probe covering **all** native failing files. Preserve original full verification separately; do not change it to the focused command. An unknown/absent profile is needs-evidence with a concrete profile-review action, not universal repository rejection.
2. Propagate explicit operation deadlines through initial reproduction, triage, search tests, fresh suite audit, policy checks and supplied-patch execution. Clamp to the operation/profile and remaining phase allowance; provider defaults must not decide execution length. Every timed-out/killed/negative-exit result is ineligible to establish original failure identity or candidate success, even if partial stdout contains a familiar assertion.
3. Keep the ordinary repair/search allowance at 600 seconds and existing inference/tool/branch limits. Add an opt-in isolated **final-verification allowance**, default 0, bounded above by 3,600 additional seconds and one full-suite pass. The selected candidate's full fresh command and existing required policy checks consume this allowance and its operation/cost reservation. Search/triage/model proposals cannot consume it or acquire extra turns. Measure total case wall time from actual controller start to terminal completion, including preparation, waits and cancellation/drain exactly once. Per-operation wall durations may overlap and are a separate metric, not an additive case clock. Do not hide the long phase in elapsed accounting.
4. Issue an in-memory, controller-only verification capability through an adapter-owned factory, following the existing session/capability pattern in `packages/core/src/engine/repair-authorization.ts:39`. Validate source repository/run/attempt/SHA, engine Action/code SHA, protected policy/profile digests, exact command and limits before issuance. Packet fields and filesystem location are bindings, not authentication. Candidate repair image/diff identity is separately bound when the capability is consumed. The adapter authority is specified below; serialized or replayed records cannot mint a live capability.
5. Before search, check that the declared full command, all required baseline/candidate policy checks, cancellation margin and reserved final adjudication can fit the combined envelope. Budget planning uses requested deadlines and known obligations, not optimistic elapsed predictions. If incompatible or unpriced/unapproved, show full-verification-budget-incompatible and the exact missing allowance/obligation. No paid search, fixed claim or PR is permitted from a skipped audit.
6. At the first controller-admissible provisional candidate, atomically consume the single final-phase capability and freeze its image plus cumulative-diff digest. Stop new proposals/tools and cancel/drain outstanding search operations before full verification; unresolved cancellation consumes the attempt and blocks verification. Competing admissions cannot acquire another capability. Failure, timeout, exception or cancellation is terminal for that attempt, with no fallback candidate or automatic long audit retry. Preserve original full fresh verification, all required commands, frozen challenges and independent adjudication in their existing order. A full audit failure/timeout or exhausted allowance ends that attempt with retained evidence; it does not start another long audit automatically. Before search, reserve the existing audit model turns/tokens/USD pools; do not reset or increase them. On the atomic transition, transfer only that reserved capacity to final-gate ports using the isolated final-phase deadline. Ordinary search/model ports remain expired/closed and cannot use this clock. Include challenges, required baseline/candidate commands, cancellation and final adjudication within the final-phase deadline; unused ordinary wall time is not silently replenished. A short focused green cannot approve a candidate whose full command failed, was killed, skipped or never ran.
7. Derive each ConTree client polling deadline from that operation's authorized timeout plus a bounded cancellation margin; keep the ordinary polling defaults for ordinary operations. Cover all live constructors: Action healing and supplied verification, CLI healing and supplied verification. The provider request timeout and client polling deadline must agree. Verify provider deadline support and workflow wall timeout during the concrete execution preflight. Provider refusal, unavailable runtime or inability to produce a bounded cost reservation ends in disclosure before execution. A controller cost reservation is not a provider-side invoice ceiling; returned costs and unresolved telemetry are retained and block another attempt until reconciled.

```text
@ reproduceAndVerify(native, profile, executionPacket) -> caseEvidence
pre: protected profile and exact source; independently authorized limits for extra verification
do:
  1. validate the complete native failure set and all profile input digests
  2. compute focused probe, unchanged full command and compatible phase reservations
  3. run bounded reproduction and search against every native failure
  4. run one selected candidate through the full fresh audit and required policy checks
  5. emit actual process, wall, cost and adjudication evidence
br: absent allowance or incompatible obligations -> visible stop before paid search
fail: timeout, wrong failure set, stale profile or failed full audit -> no fixed result or PR
```


## Authorization adapters and one-shot consumption

- **CLI:** authority is the explicit operator invocation, not a checked-out file. Require an explicit `--authorize-long-verification` flag whose value equals the canonical packet digest supplied by the operator, validate its bindings against the actual invocation/source/protected policy, then issue a capability through the private adapter factory. Repository discovery/configuration and model tools cannot supply this flag. A copied structurally valid packet without the separate matching operator invocation is rejected. This is an execution mechanism; the implementing agent still needs the owner's actual external/spend approval before invoking it.
- **Action:** an extra allowance is admitted only for an explicit `workflow_dispatch` invocation of a protected, policy-enrolled caller workflow, at attempt 1, by a protected-policy-enrolled approver ID. Re-fetch the caller run/workflow/actor/source identities from authenticated GitHub APIs; match workflow path/blob/commit, protected branch, source repository/run/attempt/SHA, engine Action SHA, profile and declared dispatch limits. Normal workflow_run, fork/untrusted/changed caller workflows, event JSON assertions, ambient environment flags and packet files from PR/source trees cannot grant extra allowance. This initially targets one owner-controlled pilot; it does not grant broad collaborator or public-demo authority.
- Bind an Action authorization ID to the authenticated dispatch run/attempt; bind a CLI ID to its explicitly approved one-attempt execution packet. For CLI, reserve/consume the grant under the existing common-Git process lock/account machinery before paid work; a restarted process sees issued/in-flight/settled state, never a free new grant. For Action, require the enrolled protected workflow to contain one repair job/Action step plus source-incident concurrency with cancel-in-progress=false; verify that pinned workflow structure and the authenticated caller job identity before issuance. Use existing durable GitHub attempt/check markers to record this dispatch grant before paid work, refuse a pre-existing in-flight/consumed marker and bind the capability to this run/job/attempt. Preserve an immutable link to the source incident. These constraints make read-then-write checks safe within the single enrolled invocation; do not claim arbitrary cross-workflow atomicity. Only a separately approved owner dispatch/CLI invocation can create a new grant; automatic callers cannot. A separately authorized new execution appends a distinct attempt and preserves earlier claim/cost/history; it never deletes an old marker or triggers a native workflow rerun. Duplicate/replayed grant IDs, rerun attempts, concurrent consumers and ambiguous in-flight grants are refused; ambiguity requires reconciliation, not a new ID to bypass it.
- The core capability factory accepts the adapter's validated authority object, not plain JSON, and tracks consumption non-refundably. Existing source/operation claims plus this capability prevent repeated publication or long verification within one approved execution. No new signing service, permission grant, credential format or global scheduler is introduced.
- Configuration capture records admitted limits, phase deadlines, reserved/shared counters and non-secret authority provenance for reproducibility. Extend `replay/bundle`, validation and replay-orchestrate accordingly. Offline replay uses recorded/simulated ports only; replayed approval is evidence and never live spending authority. Historical bundles omit the allowance and keep their old semantics.

## Files, consumers and implementation order

Sequential units because policy, orchestration, ledger and budget consumers overlap:

1. **Complete diagnostics:** `github/adapter`, GitHub/failed-step types, `failure-identity`, source preservation and tests. Action/native CLI must consume the same envelope contract when they have equivalent evidence; partial local logs remain incomplete.
2. **Profile:** `policy/schema`, policy loading/digests, `heal.readNativeFailureEvidence`, `orchestrate`, source snapshots, `packages/action/src/replay-repository.ts`, `replay/bundle`, `replay/validate`, `replay/replay-orchestrate`, assessment/inspect/CLI assess-doctor/upgrade docs and tests. Capture only declared bounded inputs. Existing profiles remain preserved during configuration upgrades.
3. **Execution phases:** `executor` options, `diagnose/hypotheses-budget`, `engine/repair-budget`, config/input validators and CLI/Action authority factories, all four live executor constructors, repair tools/search/agent, `verification/runtime`, policy audit, external verification and supplied-patch execution. Separate focused work from full verification in the command contract; inspect every caller in the parent sweep. Existing audit-only paths execute no commands and receive no allowance authority.

Do not mark these units batch-eligible. Reuse current parser, policy-load, reservation and recorder components instead of introducing another scheduler, generic script interpreter or automatic policy learner.

## Behavioral oracles

- **P3-COMPLETE:** the original full selected step produces both native identities despite a shortened display excerpt. A missing/extra/changed assertion, clipped block, summary mismatch, collection error or abnormal completion cannot match.
- **P3-PROFILE:** the reviewed sanitized wrapper profile maps to the complete direct-runner selection; changed wrapper/config/lock/source digest, wrong cwd/runtime, denied input, candidate policy or stale source stops with an exact next action. A corrected reviewed profile can subsequently pass validation without deleting incident history.
- **P3-PROCESS:** the recorded timeout preserves termination/costs and never becomes application reproduction. Explicit deadlines appear on the provider request, are clamped to remaining allowance, and cancellation retains terminal or unresolved status.
- **P3-ASSURANCE:** focused probes may pass while the unchanged full command fails; the result must not be fixed or publishable. Both original failures must be repaired within unchanged file/path policy before full acceptance.
- **P3-BUDGET:** no packet or default 0 gives current limits; a profile alone cannot expand them. One explicitly approved compatible synthetic allowance executes the full command, retains reserved adjudication and actual total wall time. Wrong source/policy/engine/repair identity, unapproved caller/event/actor, a copied valid packet without adapter authority, consumed/replayed grant, excess duration or a search tool trying to use verification capacity is rejected. With a fake clock crossing 600 seconds during the final phase, reserved final adjudication still completes while ordinary model/search calls remain rejected. Two concurrent provisional candidates produce exactly one full verification phase and zero subsequent search proposals; failure cannot select the second candidate. Include every required baseline/candidate command, even repeated identical command text. A synthetic authorized operation lasting over 600 seconds can finish through the client poller, while an unapproved one cannot.
- **P3-CAPACITY:** a declared 25-minute full audit cannot enter search under a 10-minute-only envelope. Required baseline/candidate commands count; missing pricing/permission and unavailable provider deadline/runtime are visible stops. Unknown cost never settles as zero.
- **P3-COMPAT:** existing unprofiled direct Vitest/Jest/Node/Pytest cases, old policies/replays, policy-required commands and supplied-patch safety retain their contracts. An old Action that cannot parse the new policy is reported as requiring upgrade; the CLI cannot certify its readiness using newer rules.

## Automated verification

Create explicit new profile, diagnostic and verification-allowance test modules; exercise owned code and real local subprocesses for structural selector/timeout behavior, mock only external APIs/clocks/providers. No paid run is needed for these oracles.

```sh
pnpm --filter @sutura/core exec vitest run src/engine/failure-identity.test.ts src/engine/triage.test.ts src/heal.failure-identity.test.ts src/heal.test.ts src/orchestrate.test.ts src/github/fleet-gated.captured.test.ts src/policy/schema.test.ts src/audit/repository-policy.test.ts src/verification/runtime.test.ts src/verify-execution.test.ts
pnpm --filter @sutura/action exec vitest run src/verify-execution.test.ts src/replay-repository.test.ts src/main.test.ts
pnpm --filter sutura test
pnpm run ci:local
pnpm --filter @sutura/core test:coverage
pnpm --filter @sutura/action test:coverage
pnpm run test:ci-routing
```

Run any additional invalidated/required phase checks and the parent final-integration gates before external execution. Compare old and new support results; any intentionally narrowed class gets an explicit documented disposition, not a hidden skipped test.

## Manual acceptance and handoff

No live-budget approval is inferred from implementing this phase. Independent security/quality review must examine profile authority, complete-set evidence, allowance isolation, cancellation and the unchanged full audit. Prepare the exact current pilot profile/runtime, source verification, native obligations, provider/time/cost limits and rollback as phase4's concrete packet. State LOCAL_READY separately from LIVE_DELIVERY_UNMEASURED.
