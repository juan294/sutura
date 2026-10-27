# Protected Node reproduction and final verification

This describes the local implementation candidate. The published v0.4.1 package and existing installed Actions retain their current code and enrollment. The assessment contract is now `sutura-runtime-support-v2`; an older Action contract requires an upgrade before the newer CLI can assess its readiness.

## Reproduction evidence

A reviewed Node wrapper profile separates the complete focused probe from the original full verification command. The probe includes every native failing file. A green probe can enter verification; the unchanged full command, frozen challenges, adjudication and required policy checks still decide acceptance.

The Action derives a structured Node envelope from the complete authenticated selected step before producing its 200-line display excerpt. The envelope binds repository, exact source/run/attempt/job/step, runtime, original log digest and every complete assertion identity. It requires a consistent runner summary and normal exit evidence. Its bounds are 64 identities, 2 KiB of diagnostic material per identity and 128 KiB total, within the selected-log bound. Clipped blocks, conflicting totals, changed/missing/extra failures, collection errors and abnormal termination cannot establish reproduction.

Unprofiled direct Vitest/Jest/Node/Pytest cases retain their existing path. Recognized Node test wrappers without a reviewed profile stop before provider preparation with a concrete review action. This does not declare arbitrary repository wrappers supported.

## Protected policy

Policy v1 accepts optional `reproductionProfiles`, with at most eight profiles. Each profile declares:

| Data | Required contract |
| --- | --- |
| Identity and command | Unique bounded ID; exact native command and repository-relative cwd |
| Probe | Direct supported Node argv and every native failing file; deadline at most 600 seconds |
| Inputs | At most sixteen safe, policy-readable paths and SHA-256 values, covering wrapper, configuration and relevant manifests/locks |
| Runtime | Exact native and sandbox Node versions; a different version requires an explicit reviewed equivalence reason |
| Image | Immutable OCI digest; the prepared image must report the approved exact Node version |
| Full verification | The original native command, unchanged; declared full deadline at most 3,600 seconds |
| Provider preflight | Optional `providerTimeoutLimitKey`, reviewed against the authenticated account's timeout-limit semantics; live long verification requires it |
| Action callers | At most eight workflow ID/path/Git-blob/protected-ref/engine bindings and enrolled approver IDs |

Environment files and arbitrary reporter output destinations are unsupported. Preloads/loaders require explicit safe input digests. The controller environment remains `CI=true` and `NODE_ENV=test`. Profile inputs become protected patch paths for the attempt. A stale digest, denied input, wrong source/cwd/runtime or unavailable image stops with evidence; candidate policy cannot grant authority.

The protected policy and exact source may have different commits for an explicitly approved historical attempt. Both identities remain separate. Ordinary automatic source admission and existing attempt history remain intact.

## Two execution allowances

Ordinary repair/search remains at 600 seconds with the existing model, tool, branch, operation and money limits. The additional final-verification allowance defaults to zero and is bounded at 3,600 seconds. A profile or packet file cannot increase it.

Before paid search, the approved envelope must contain the full command, every required baseline/candidate command, frozen challenge obligations, cancellation/drain and final adjudication. Duplicate required command text still counts twice per occurrence. Missing pricing, account deadline support or allowance stops execution. Read-only authenticated provider preflight checks the reviewed account-limit key; it does not infer a provider maximum from packet data.

The first controller-admissible provisional candidate consumes the capability once and binds its image and cumulative-diff digest. Ordinary ports close. Siblings must cancel and drain within the cancellation allowance, with actual terminal evidence. Unresolved cancellation ends the attempt. Exactly one unchanged full audit may follow; a failed, killed or timed-out audit cannot select a fallback candidate.

The existing audit model turns and money pools are reserved before search and transferred to final ports. They are not reset or increased. Adjudication has one cumulative allocation, retains later policy-command capacity and releases its time hold before those commands run. Each operation is clamped to its category and remaining allowance. The provider request and client polling deadline agree; a long operation requires an opaque, single-use controller permit.

## CLI authority and recovery

The operator supplies both `--verification-packet` and `--authorize-long-verification`. The latter must equal the SHA-256 of the canonical packet. The envelope is a private operator-owned regular file containing exactly `packet`, `nativeLog` and `nativeBinding`. Packet digests bind both log and source/job/step/runtime metadata.

The CLI checks its embedded clean-build engine identity, canonical GitHub origin, clean exact source, protected policy commit/ref and complete native evidence. It then uses authenticated read-only `gh api` calls to verify the exact source attempt, job, selected step, runtime and full selected-step digest. Engine and consumer source SHAs remain distinct. A dirty or unidentified CLI build cannot authorize the extension.

The grant account lives in the repository's common Git directory, so linked worktrees and restarts share the same append-only history. Issuance is recorded before paid work. Reusing a packet, renaming a pending execution or copying an envelope cannot reset the account. Explicit reconciliation requires the exact pending identity and complete authoritative billing evidence. Unknown costs stay pending; reconciliation preserves the consumed grant.

Supplied verification uses the same packet mechanism and the policy command ID `profile:` followed by the reviewed profile ID. Its mandatory challenge obligations are included before grant issuance even when ordinary healing policy disables challenges.

## Action authority and recovery

Only an explicit `workflow_dispatch` run at attempt 1 can receive an allowance. The caller must be the current protected, enrolled immutable workflow, with enrolled actor and triggering actor IDs. Its YAML has one repair job and one named Sutura Action step pinned to the approved engine SHA, with sufficient job/step time and source-incident concurrency using `cancel-in-progress: false`. Matrices, reusable multiplication and automatic events cannot grant authority.

The pinned workflow directly maps required dispatch packet/digest inputs to `verification-packet`, `authorize-long-verification` and the selected source run. GitHub REST does not expose historical dispatch input values; the authenticated immutable mapping and runner-provided exact canonical strings supply that boundary.

A durable dispatch marker and pending source account are recorded before paid work. Successful dispatch publication binds the authenticated source/engine/caller to its distinct provenance-derived repair branch. The existing native collector validates that bounded dispatch receipt through its protected producer and exact native checks; a new dispatch workflow needs explicit targeted observation rather than assumed fleet discovery. Earlier claims, costs and receipts remain intact. A new explicit grant gets a distinct attempt/check/branch identity rather than deleting an old claim. Pending or corrupt history requires reconciliation. Supplied verification keeps source mutation and repair publication disabled; its v2 evidence separately reports authorized grant-bookkeeping status.

## Evidence and limits

Case evidence reports actual controller wall time, including preparation, waits and cancellation/drain. Per-operation wall durations may overlap and remain separate. Provider resource fields are diagnostic data; billing reconciliation uses authoritative billing evidence, not an inferred zero or an operation-cost total. See the provider's [limits and usage reference](https://docs.tokenfactory.nebius.com/sandboxes/operate/limits-retention-and-usage).

New replay configurations retain admitted limits/provenance, the consumed candidate, shared counters and bounded controller clock inputs. The owned offline executor validates the same single-use operation permit and exact request deadlines. Serialized approval cannot authorize a custom/live executor. Historical bundles retain their recorded semantics; replay and synthetic tests do not establish organic recovery.

Local verification and a prepared pilot packet are separate from native delivery. A current real repair needs its exact enrolled native checks; integration additionally needs the human merge and exact integration proof. The original 101-attempt denominator is retained. This implementation does not add a waiting period, broaden the pilot or authorize paid runs, publication or consumer changes.

## Source boundaries

- Complete diagnostics: `packages/core/src/engine/native-diagnostics.ts:47`.
- Protected profile resolution: `packages/core/src/engine/reproduction-source.ts:10` and `packages/core/src/engine/reproduction-plan.ts:52`.
- Budget and one-use capability: `packages/core/src/engine/repair-budget.ts:108` and `packages/core/src/engine/verification-allowance.ts:62`.
- Authenticated Action caller: `packages/core/src/engine/action-verification-authority.ts:97`.
- CLI operator boundary: `packages/cli/src/verification-authorization.ts:49`.
- Offline controller clock: `packages/core/src/replay/controller-clock.ts:5`.
