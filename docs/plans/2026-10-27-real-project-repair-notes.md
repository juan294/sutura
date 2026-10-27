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
