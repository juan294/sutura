# Fleet recovery implementation notes

## Authorization and identity

The owner authorized implementation of all eight phases without intermediate stops, local integration into `develop`, and task-worktree cleanup. This does not authorize publication, provider operations, credential mutation, mail delivery or recruitment. Base: `22ba8a92c3f53b3f7cd23e631863542102d0dc91`; task branch `feat/fleet-incident-recovery`. Remote integration matched this base at entry. Existing untracked plan and assessment documents were copied unchanged into the isolated checkout and preserved at their original location.

## Phase 1

Local changes and gates complete; final independent gap-closure review pending. CodeQL grouping covers aligned and inconsistent multi-action references. README states supported job shape and ConTree access before setup. Existing snapshot and Node-range corrections are retained. A names-only App setup evaluator records missing/malformed metadata, configured-but-unverified access, failed scoped validation and validated access without claiming preparation or repair readiness (`scripts/fleet-setup-readiness.mjs:17`). Its CLI emits no input payloads and returns incomplete-readiness exit 2 for setup-blocked cases.

The Sutura product candidate `0893dc8c7d5af41c810c8ffa928f40c678115558` passed the complete pinned `ci:local` gate, including 245 offline Placebo tests, exact-candidate package installation and guard coverage. Separate core coverage (2,129 passed; 11 live tests skipped), Action coverage and routing checks passed. The later standalone setup evaluator and test selection were checked with five focused cases and the complete release-contract suite; packaged core/Action/CLI/Placebo inputs did not change, so their retained check evidence remains valid. Commit hooks recheck typecheck/lint. Earlier failed receipts remain preserved.

The second consumer passed its complete local gate and coverage (1,737 tests) and has a reviewed local grouping commit. The diagnostic-only consumer has a reviewed local commit, parsed RED/GREEN event tests, actionlint and its whitespace gate. Its original checkout remains untouched. Exact private identities and rollback bytes remain in the operational packets. Missing App membership/credential-source evidence, collector enrollment and all hosted changes remain pending, rather than represented as completed administration.

A complete representative security-updater log was captured. It reports an unresolved security update, but does not prove a cooldown-policy cause. Actual updater executable selection and downstream validation require captured-input replay in phase 3. Other probe, resource and trust-boundary investigations retain their explicit dispositions there.

Private source identities, consumer patches, baseline/configuration captures, RED/GREEN logs and operational packets are retained under ignored `docs/agents/2026-10-25-fleet-recovery-implementation/` in the integration checkout, outside disposable worktrees. Current capture is deliberately a thin selected-consumer inventory, not a full fleet census.

## Deviations

- Plan said unique retained coverage paths. The initial invocation appended a second `coverage.reportsDirectory` option to the package command; Vitest rejected duplicate options before running tests. Use each canonical coverage command sequentially, then preserve its output in a unique evidence directory. The original failed receipts remain retained.
- README positioning shifted source anchors in the documentation index and evaluation guide. The existing source-anchor regression failed; anchors were corrected and the 17 grouping/submission tests passed. This is a dependent documentation correction, not a weakened check.
- The first focused test command included a nonexistent snapshot test filename and passed only the two existing selected files. The real `snapshot-compatibility.captured.test.ts` suite was then run explicitly and passed with the Python suite. No absent test is counted as executed.
- A temporary fixture without a package-manager declaration selected the host Corepack default pnpm 12. The frozen offline archive requires pnpm 11.22.0. An isolated PATH shim now pins child processes as well as root commands; no dependency or assertion was changed.
- The host uv is outside the evaluation project's required range. Verification uses an isolated uv 0.12.9 installation and pnpm 11.22.0; global tools are unchanged.

## Pending external evidence

Compatibility activation, exact native execution, safety observation windows, stable release admission, delivery receipts, integrated organic recovery, recurrence measurement and independent newcomer results remain pending. Missing external evidence never becomes local test success.

## Phase 2 entry

Next: freeze the qualified compatibility candidate, prepare exact consumer pin/rollback packets and test the pilot evaluator. Hosted publication, App administration and the 72-hour observation window are not authorized or measured. Record this disposition before later local correctness phases; do not wait indefinitely for an event.
