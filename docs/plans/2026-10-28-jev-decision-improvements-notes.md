# Jev decision improvements implementation notes

## Authorization and identity

The owner requested all six phases without stopping, local integration into `develop`, one integration push, and removal of the task worktree. This supersedes the plan's default stop/publish boundary. No live inference experiment, credential/provider change, release, production deployment or hosted role activation was authorized. New roles remain off by default.

Base: `969bd68b08c973c3a16f00bb2b67dc19c6300a6d`. Task branch: `feat/jev-decision-improvements`; worktree: `/Users/juan/code/sutura-jev-decisions`. The original three research artifacts and complete plan were copied without changes into this isolated tree and preserved in implementation commit `f8bdd37233487d3bd7de061c4b096cb9540dfe3e`.

## Deviations

- Plan said: shadow capture must not consume the repair deadline. Found: an arbitrary local capture promise could stall. Chose: at most 100 ms, bounded further by the remaining controller deadline, then baseline fallback with `shadow-capture-failed`. Why: opt-in local capture cannot hold the repair indefinitely; no provider call occurs.
- Plan said: preserve historical JSON/HTTP bytes and old replay authority. Found: audit display changes alter an exact recorded pull-request body. Chose: an explicit `auditPresentation: typed-status-v1` marker in new recordings and a legacy outbound Markdown presentation for old recordings only. Why: historical recordings remain immutable and exact cursor matching remains enabled; normal reports retain accurate new status labels and returned control booleans are unchanged.
- Plan said: use the complete local gate. Found: the host uv 0.13.6 violates the repository's `>=0.12.7,<0.13` tool requirement. Chose: isolated uv 0.12.7 via `/tmp/sutura-jev-toolchain/uv`, with no repository requirement change. Why: verify with the declared toolchain rather than weaken the gate.

## Phase 1: foundation and presentation

Implementation includes independent assignments for audit presentation and config/replay, with the parent owning transport, decision budget/capture, public evidence and integration. All assignments stayed local; the parent owns commits. Independent review was performed by a separate read-only reviewer. TDD evidence includes initial missing foundation modules; late response ledger mutation; unbounded capture; navigator retry; missing CLI configuration error; malformed metadata; and immutable captured replay body. Targeted repairs passed before broad checks. Raw logs remain in ignored `docs/agents/jev-phase-1-*` files.

Review findings P1-R1 (missing usage), P1-R2 (unknown public fields), P1-R3 (input failure escaping fallback), P1-R4 (standalone audit deadline), P1-R5 (shadow capture deadline), P1-R6 (question redaction), P1-R7 (navigator retries) and P1-R8 (CLI configuration exit) were resolved with source/test evidence. Replay exact presentation compatibility was a further confirmed finding from the full gate. Reuse, quality and efficiency review rejected broad/cosmetic rewrites; standalone audit timing reuses the existing deadline helper. A three-lens simplify pass found no further justified changes after these repairs.

Retained failed checks: first exploratory `ci:local` was interrupted (exit 130) pending independent-review repairs; the first completed gate failed a stale evaluation-guide source anchor (621/622 release contracts passed); repaired anchor tests passed 15/15. The next aggregate gate returned `ci:local=2` for uv mismatch, core coverage=1 for the exact captured report body (2513 passed, 11 skipped), Action coverage=0 (232 passed). These failures remain evidence and are not relabeled as successful. Complete gates on the repaired candidate are pending; no Phase 1 acceptance or Phase 2 implementation is claimed yet.

Public limitations: offline behavior does not qualify model quality, calibration, performance, repair yield, or developer comprehension. No live TypeSafe request was made. Requested new-role model remains `jev-1.14.0`; legacy audit requests/model policy retain original bytes and veto thresholds.
