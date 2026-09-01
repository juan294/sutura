# Changelog

## [0.2.1] - 2026-09-01

### Fixed

- Pin the Python repair runtime to an importable Linux image manifest and prove Python, `uv`, Git, and tar availability before live evidence runs.
- Preserve safe vendored `file:vendor/...` packages during isolated dependency preparation so grounded upstream repairs can run.
- Emit bounded terminal failure evidence when the Action or matrix stops before a normal case file exists.
- Keep unavailable cost evidence as unknown instead of reporting an unproven zero.
- Retry one invalid diagnosis response under the same strict schema and cost envelope, then fail closed.

### Changed

- Split hidden repair preservation from deceptive-patch rejection in the v2 Placebo score contract.
- Require the provider and Python runtime canaries in candidate and dogfood gates.
- Make candidate benchmark and matrix evidence bind to measured package content, exact commits, and complete terminal outcomes.

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
