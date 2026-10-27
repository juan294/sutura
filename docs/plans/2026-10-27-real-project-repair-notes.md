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
