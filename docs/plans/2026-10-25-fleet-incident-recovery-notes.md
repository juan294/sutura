# Fleet recovery implementation notes

## Authorization and identity

The owner authorized implementation of all eight phases without intermediate stops, local integration into `develop`, and task-worktree cleanup. This does not authorize publication, provider operations, credential mutation, mail delivery or recruitment. Base: `22ba8a92c3f53b3f7cd23e631863542102d0dc91`; task branch `feat/fleet-incident-recovery`. Remote integration matched this base at entry. Existing untracked plan and assessment documents were copied unchanged into the isolated checkout and preserved at their original location.

## Phase 1

Local first-delivery boundary independently approved; implementation through `ba7f5431348254f623b7337195d2590a28522324`. CodeQL grouping covers aligned and inconsistent multi-action references. README states supported job shape and ConTree access before setup. Existing snapshot and Node-range corrections are retained. A names-only App setup evaluator records missing/malformed metadata, configured-but-unverified access, failed scoped validation and validated access without claiming preparation or repair readiness (`scripts/fleet-setup-readiness.mjs:17`). Its CLI emits no input payloads and returns incomplete-readiness exit 2 for setup-blocked cases.

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

## Phase 2

Compatibility candidate frozen at `ba7f5431348254f623b7337195d2590a28522324`. Exact-candidate package installation, bundle verification and routing tests passed. `packages/`, the lockfile and root Action metadata are byte-identical to the product tested by the complete phase 1 gate at `0893dc8`; the added setup-packet evaluator has its own corrected regression and complete release-contract run. The Action bundle blob is `f9fc0e2c79a0c8cd152251384e40c0781eb231e5`, also present at the original integration baseline.

Private pilot pin patches and exact rollback bytes are prepared from refreshed default-branch workflows. They preserve App/provider wiring, watched names, conditions and permissions. The pin patches are now applied in isolated consumer worktrees. Full consumer local gates are running before any publication review; exact rollback and parsed workflow-equivalence checks passed. The candidate includes the complete development delta since stable, not only two cherry-picked fixes. Source inspection covered runtime/input safety, Action wiring, routing ownership, collector changes, Case Lab evidence/copy and evaluation serialization; tests cover the complete product. This does not establish live provider behavior or an exhaustive dependency audit.

The pilot evaluator separates installed identity, passed stop stage, safety-window status and organic recovery. Initial 11-case and 435-case release-contract suites passed. Independent review identified bounded FIFO opening and descriptor-scope binding defects; both now have captured RED/GREEN regressions and independent approval (13 focused cases). The descriptor digest binds its protected source, event applicability, full-check rule and exact job/matrix obligations. Digest integrity does not authenticate supplied receipts; the collector retains that responsibility. Three simplify passes found no further changes. Hosted publication, App administration and the 72-hour observation window are not authorized or measured. The live disposition is **pending activation; stop removal and organic recovery unmeasured**. Later local correctness work may proceed after the evaluator's local acceptance; no event or approval is invented.
