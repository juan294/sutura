# Changelog

## [Unreleased]

## [0.3.4] - 2026-09-30

### Added

- Sutura posts a neutral **Sutura repair verification** check on the repair commit of a repair pull request; if GitHub refuses it, the Action logs a warning and the audit check and comment still carry the decision. Before, Sutura's only check sat on the failing commit, and a repair pull request opened with the workflow token showed no checks at all, because GitHub holds that pull request's CI for approval.
- The case file records `challengePreparation`: counts of retained, excluded and qualified behavioral probes, and counts per reason code, without probe text or inputs. A probe that used to fail as a generic `invalid-probe` now reports `unsupported-relation`, `input-outside-domain` or the validator's own reason.

### Changed

- For a Node repository, the sandbox image follows `.nvmrc` or `package.json` `engines.node` (`node:22` or `node:24`, default `node:22`). The run is refused when the two disagree or when `.nvmrc` names another major version; an `engines.node` range outside 22 and 24 is ignored.
- Diagnosis treats a missing relative import from a source file at the workspace root as a local `build` failure, even when the model calls it an upstream dependency, as seen in the v0.3.3 benchmark's `repair-bad-import` case. Imports from `node_modules`, `.yarn/unplugged`, unknown importers, and logs that also match another failure class are unchanged.
- Every audit voice (Nemotron, GPT-6 Astra, TypeSafe Jev) receives the fresh-suite command and its exit code. The prompt states that an exit code of zero alone does not prove the repair, and adjudication returns `insufficient` when the fresh suite did not run.
- Behavioral challenge generation gives the model each contract's citation (path, hash and line range) to copy, and for `exact`, `codec-round-trip` and `json-property` contracts requires one of the policy's example inputs. Whether a probe counts as preservation or bug regression is decided by what the trusted baseline observes, not by the model's label.
- A replay bundle recorded by v0.3.3 or earlier does not replay with 0.3.4, and the reverse. The diagnosis prompt, the failed-step log selection, the audit and challenge prompts, and the calls on the `fixed` path all changed.

### Fixed

- Sutura never repairs its own `sutura/fix-*` branches. The Action refuses such a run before it reads a pull request or claims the run, and reports `repair-branch-skipped`; the generated workflow skips those branches. Before, a failing CI run on a repair pull request could start a repair of the repair.
- The Action recovers its claim comment when `github-token` is a GitHub App installation token and the comment names the claimed check run. Before, it recognised only `github-actions[bot]`, so a retry with an App token would post a second claim comment. A pull request opened with an App token triggers the repository's CI normally.
- Missing-`await` repairs: when one Vitest stack line or Python unittest traceback, confirmed again by the controller's probe, points at a test line, the controller writes the `await` insertion itself without a model call. This covers `expect(fn())` on the failing line, a preceding assignment in Python, and an imported async helper in `.test.js`, `.test.cjs` or `.test.mjs` files. In other authorized await repairs the model may insert only `await` and `async` tokens, and the budget reservation quotes that prompt.
- When a failed step is followed in the same second by an `if: always()` action such as `actions/upload-artifact`, the failed step is still the one selected. Action references are no longer taken as commands, and a multi-line `run:` script is recorded whole as the failing command instead of its first line.
- Assertion lines that GitHub prints without a timestamp in a multi-line CI error, such as a diff or a `❯ file:line` location, stay with the failed step, so the source location reaches repair.
- A repository `.npmrc` that contains only `engine-strict=true` (with comments or blank lines) no longer stops dependency preparation; it is still left out of both snapshots. Media files under `docs/plans/**/evidence/` are left out of the repository overlay; other documentation assets stay, because repository tests may read them.
- The two-file repair prompt's example lists the actual selected slot IDs instead of a single `slot-1` placeholder.
- The local heal path (`sutura heal --case-dir`, which the Placebo release benchmark drives) now passes the optional GPT-6 Astra second opinion and TypeSafe Jev calibrated audit to adjudication. The CLI built both from `OPENAI_API_KEY` and `TYPESAFE_API_KEY`, but `healCase` dropped them, so every benchmark audit recorded them as not configured; the GitHub Action path was unaffected.
- The Case Lab workflow and the external matrix `cleanup` command close their bot pull requests, delete their branches and delete the held `pull_request` CI runs GitHub creates for them, which GitHub otherwise fails after 30 days with an email to the owner.

### Security

- The Action bundles `undici` 6.29.0 (was 6.28.0), and the development toolchain resolves `brace-expansion` 2.1.7 and 5.0.12, past the open advisories. The Placebo fixture lockfiles keep their pinned versions because the benchmark corpus hash is frozen.

Retired guidance: none.

## [0.3.3] - 2026-09-23

### Fixed

- A run with several failed steps diagnoses the one that finished first instead of whichever log came last. An aggregate gate job that only asserts other jobs' results always finishes after them, and its `echo` line was being reproduced green, which stopped four fleet runs at infra-stop. If the chosen command still reproduces green, the next failed step with a different command gets one more reproduction attempt (#151).
- The Case Lab release gate reads the controller commit from the local repository before asking GitHub, so the push that completes a Case Lab cycle is no longer refused as unreadable.
- The Case Lab release gate accepts a checkout that is already complete when it tries to deepen it; on `main`'s CI checkout `git fetch --unshallow` refused the repository as complete, and the pre-push contract test failed.

### Changed

- The release benchmark workflow passes `OPENAI_API_KEY` and `TYPESAFE_API_KEY` so the optional GPT-6 Astra and TypeSafe Jev audit voices run in the benchmark; `publish.yml` waits up to 10 minutes for npm to serve the version before verifying it.

## [0.3.2] - 2026-09-23

### Fixed

- The failing CI command now survives log truncation: the classifier's 20 KB front-cutting tail carries the nearest `Run`/`$` header past the byte cap instead of dropping it, and the adapter falls back to a custom-named step's `##[group]Run` header when the step's display name never matches. Fixtures are the real failed-step windows of 15 gated fleet runs; 16 of 17 measured gated fleet runs now yield a real command (#150).
- The dependency snapshot now admits the files named in `pnpm.patchedDependencies`, with the same refusals as `file:`/vendor directories; preparation-failure excerpts are redacted before publication, and redaction now recognises npm `_authToken=`/`_auth=` values and `npm_` granular tokens.
- The sandbox Git baseline now adds its manifest with `git add --force`, so files a repository tracks under its own `.gitignore` (the cc-rpi layout: `.claude/**`, `docs/agents`, `docs/research`) are no longer refused; the refusal stopped the run at infra-stop, and 9 of 19 local fleet checkouts track such paths (#152).
- The Case Lab controller is now pinned to the commit that carries the release rather than the tag, so the demo's controller checkout reads a `release.json` naming the newest release instead of the previous one; the first live publish after every tag no longer fails.
- The Case Lab release-check gate reads the controller commit's `release.json` from git when `gh` is unauthenticated, instead of failing on the GitHub contents API.
- The release gate retries the `--unshallow` deepen fetch on `.git/shallow.lock` contention, fixing a collision when the pre-push hook runs concurrently on a shallow CI checkout.
- The Case Lab release check deepens a shallow checkout before testing tag reachability; in CI a one-commit checkout made every earlier tag read as unreachable and the check refused the release squash with "no v* tag is reachable".

## [0.3.1] - 2026-09-17

### Added

- Repair proposals and diagnosis hypotheses request `response_format: json_object` instead of `json_schema`; the proposal and hypothesis contracts are enforced locally (`parseProposal`, `validateHypotheses`). Provider contract `sutura-super-repair-v6`. Reason: on 2026-09-16 Nebius Token Factory's schema-guided decoding began dropping string escapes (`{n  return` for `{\n  return`) on every Nemotron model, producing uncompilable patches; the same request with `json_object` is correct. Raw evidence in `packages/core/src/llm/__fixtures__/nebius-json-schema-drift-2026-09-16/`; replay compares the two request shapes as one so bundles captured before the change still replay.

- Optional GPT-6 Astra second opinion on the adjudication gate: when `OPENAI_API_KEY` is configured, a different provider re-runs the same adversarial audit as a veto-only check (it can reject a Nemotron approval but never approve on its own); absent, failed, timed out, or over its own USD 0.30 budget, it is recorded `skipped` and the run proceeds on Nemotron alone. The runtime model remains Nemotron on Nebius Token Factory.
- Optional TypeSafe Jev calibrated audit as a third, veto-only voice on the adjudication gate: when `TYPESAFE_API_KEY` is configured, a System One decision model answers the same adversarial question as a typed choice with calibrated probabilities (it can reject a Nemotron approval when P(green-wash) is at or above 0.5 at confidence at or above 0.7, but never approve on its own); uncertain, absent, failed, or over its own USD 0.02 budget (`repair-typesafe-audit-usd`), it is recorded and the run proceeds on the other gates. The call is recorded as an optional `typesafe` replay boundary.
- The public Case Lab tracks the newest release tag: `release:case-lab` gate wired into pre-push and CI, release-mode Placebo benchmark (`--release-tag`), and the Case Lab live-run cap raised to 24 runs / USD 18 per day.

### Fixed

- Replay bundle identity checks (`publish.ts`, `replay.ts`) compare `actionSha` against the release commit instead of the demo commit, fixing a v0.3.0 regression that blocked every live Case Lab dispatch from publishing a result.
- `release:case-lab deploy` links to the correct Vercel project by name before building or deploying, instead of silently creating a new one when no local link exists.
- Replay compares `updateCheckRun` without the checkout-derived check annotations, so a real live bundle replays deterministically; the v0.3.0 Case Lab live bundle (run 34977342282) is now a named replay fixture for the `gave-up` path and for the release-bound `actionSha` guard.
- `release:case-lab` resolves repository paths against the repository root and builds `@sutura/case-lab` before `verify-pin`, so `check` and `bump` behave the same from any working directory or fresh worktree.
- `runTest` no longer discards a trusted test run's evidence when its combined stdout+stderr exceeds the 16KB cap; it now always records the bounded, truncated output and lets the actual exit code decide pass/fail, instead of refusing a possibly-correct patch outright.
- The public demo's repair-monitor workflow had lost its `case-lab/` and `matrix/` branch guards and its pinned Action reference; both are restored, and the demo's own contract tests are now shape-based instead of asserting literal pinned values, so they cannot silently go stale the same way again.

## [0.3.0] - 2026-09-14

### Added

- Add cumulative fleet dogfood metrics with bounded evidence collection, collaborator-repository support, and separate counts for attempted, claimed, provider-invoked, search-started, fixed, non-repairable, and unknown runs.
- Add structured terminal-failure telemetry for Action identity, target commit and pull request, failure code and stage, runtime detection, provider calls, sandbox operations, search state, and terminal-comment state.
- Add `SUTURA_DISABLED=true` as a repository-level opt-out for deferred or unsupported projects.

### Fixed

- Detect the project runtime from root manifests before scanning nested files, while bounding traversal and retained evidence for large monorepositories.
- Bind replay and terminal evidence to the installed Sutura Action commit instead of GitHub's default-branch workflow SHA.
- Complete an existing pull-request or commit comment when a claimed repair attempt terminates unexpectedly.
- Preserve infrastructure stops and distinguish non-repairable CI conclusions in fleet metrics.
- Let the CLI bundle and Placebo patch-sweep verification finish before their test processes exit.

### Changed

- Record the clean Stage 3 development and validation measurement: 80/80 terminal results, 15/15 deceptive patches rejected, zero false approvals, and zero infrastructure stops.
- Refresh production and development dependencies.

Retired guidance: none.

## [0.2.1] - 2026-09-13

### Added

- Reject ES module `import`/`export` syntax introduced into CommonJS files as an unsafe repair, naming the target module system and the policy violation.
- Add a `develop` push freeze (`pnpm run push-freeze on|off|status`) shared across worktrees; `.husky/pre-push` refuses to push while a paid live run has the branch frozen.
- Verify patches supplied by other agents through the same isolated reproduction, challenge, policy, clean-rerun, and audit pipeline used for generated repairs.
- Add controller-owned behavioral challenges, bounded two-file repair transactions, deterministic replay views, and candidate-bound evaluation tooling.
- Add the public Case Lab, sanitized ATIF and Data Lab exports, maintainer-study tooling, and a complete Devpost submission gallery.

### Fixed

- Pin the Python repair runtime to an importable Linux image manifest and prove Python, `uv`, Git, and tar availability before live evidence runs.
- Preserve safe vendored `file:vendor/...` packages during isolated dependency preparation so grounded upstream repairs can run.
- Emit bounded terminal failure evidence when the Action or matrix stops before a normal case file exists.
- Keep unavailable cost evidence as unknown instead of reporting an unproven zero.
- Retry one invalid diagnosis response under the same strict schema and cost envelope, then fail closed.
- Recover adaptive search branches that repeat an identical proposal by requesting a materially different repair instead of stalling.
- Preserve cumulative benchmark spend and pending GitHub jobs across restarts, including delayed workflow-title recovery and terminal notifications.
- Preserve the primary Action outcome when later output writes fail, and harden four CodeQL-reported regular expressions against polynomial backtracking.

### Changed

- A Super reply that reaches the completion-token limit now ends only its own search branch; the search stops early only when such replies outnumber applied proposals.
- Split hidden repair preservation from deceptive-patch rejection in the v2 Placebo score contract.
- Require the provider and Python runtime canaries in candidate and dogfood gates.
- Make candidate benchmark and matrix evidence bind to measured package content, exact commits, and complete terminal outcomes.
- Expand Placebo v0.2 to a frozen 100-case inventory with development, validation, flake, deception, upstream, and hidden-preservation strata.
- Refresh development dependencies and document the completed 80-case development measurement, including its failed repair and hidden-preservation gates.

Retired guidance: none.

## [0.2.0] - 2026-08-31

### Added

- Add a bounded repair agent with adaptive checkpoint search, exact source targeting, automatic patch verification, and an independent final audit.
- Add deterministic model routing, progressive flake triage, model-specific Nebius Token Factory contracts, and an exact-SHA provider canary.
- Add verified Python repair support with locked dependency preparation and network-disabled execution.
- Expand Placebo v0.2 with JavaScript and Python repair, flake, upstream-release, and adversarial policy cases.
- Add deterministic replay capture, offline orchestration, sanitized ATIF exports, GitHub Checks, and reduced-assurance audit-only mode.
- Add candidate and public package verification, external release matrices, fail-closed release evidence, and the canonical 10/10 live repair ledger.

### Fixed

- Make live repairs controller-owned, bounded by exact source ranges, and automatically verified before acceptance.
- Correct provider thinking controls, tool-call handling, zero-reasoning usage handling, and null tool-call compatibility.
- Fail closed on incomplete, malformed, drifting, or lossy replay evidence.
- Preserve trusted workspace paths, fixture bytes, Git environments, and repair completion limits.
- Make Sutura's own workflow fail unless the product outcome is `fixed`.

### Changed

- Resolve the `v0.2.0` Action tag to an immutable commit during setup and verify the pin with `doctor`.
- Replace fixed candidate races with adaptive repair search and explicit branch, operation, time, inference, tool, and diff budgets.
- Make Sutura workflow rows describe whether repair was requested, unnecessary, or not triggered.
- Strengthen local, pre-push, exact-SHA CI, package-install, guard-coverage, and release-publication contracts.

## 0.1.1 - 2026-08-28

- Use a unique GitHub Marketplace name for the public Action.
- Repair actionable failures from every GitHub Actions event with an exact head branch.
- Record direct-run evidence as a comment on the failing commit.

## 0.1.0 - 2026-08-28

- Verify failed GitHub Actions runs with isolated reproduction and repair races.
- Reject flaky failures and unsafe shortcuts before publication.
- Open evidence-backed pull requests for human review.
- Install the public GitHub Action through the `sutura` npm CLI.
- Keep provider billing with each repository through bring-your-own-key setup.
