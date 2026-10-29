# Phase 2 — Admission and actionable recovery

Parent: [real-project repair](../2026-10-27-real-project-repair.md). Dependency: accepted phase1 evidence contracts. No live retry, consumer activation or cadence change.

## Outcome

The observed Sutura CI control script is recognized before image import/dependency preparation in both Action and local healing. Exact-source and provider-disk failures retain specific bounded recovery instructions without silently making failed monitors green.

## Implementation

1. Add a narrow pure admission helper beside failure identity. It positively identifies the observed control-script structure: protected Sutura routing invocation plus Git merge-parent/event/output context. It does not match repository names, display names, isolated Git words or assertion text. Return a native unavailable identity/disposition only for a confirmed category; unknown commands defer until supported provenance/profile can be resolved.
2. Call the helper after inexpensive exact-source/runtime inspection and before `importImage` in `orchestrate` and `healCase`. Reuse a small stopped-CaseFile factory with existing runtime/outcome unions, not-run triage, zero reproduced attempts, empty search/race and a clear control-coordination action. Do not fabricate a sandbox result to invoke the identity comparator.
3. Reapply admission whenever orchestration selects another failed command after a passing probe. Admission of command A cannot authorize fallback command B.
4. Surface an explicit native-command-admission terminal detail in Action and CLI output, HTML and Markdown. Keep gave-up/failure-identity compatibility and strict `require-fixed` semantics. Static assess/inspect must describe the same known blocker when the same evidence is present; missing evidence stays unknown.
5. Add origin-owned optional code/stage metadata to the existing source-checkout and ConTree error classes. Tag only the exact exhausted-source fetch boundary and positively recognized provider ENOSPC. Preserve constructors and terminal-failure-v2. Generic errors and look-alike text remain unknown; do not classify the root cause as credentials or account capacity without evidence.
6. Reuse one bounded recovery-description helper for visible terminal output/artifacts. Exact source: show the failing SHA, scoped access/ref evidence needed, and prohibition on branch-HEAD substitution. Provider disk: show reported ENOSPC, retained operation evidence and capacity-inspection action. Preserve existing red/strict behavior, unknown costs and partial observed costs; no automatic retry, cleanup, permission change or advisory-success expansion.
7. If bounded terminal next-action detail is retained by the collector, ingest it privately, include it in richer-observation precedence and keep it out of public aggregate text. Do not group causes or qualify recovery from a stop reason or recovery sentence.

```text
@ admitSelectedCommand(source, command, runtime) -> defer | stoppedCase
pre: exact source and inexpensive runtime evidence validated
do:
  1. parse the selected command's evidenced control-script structure
  2. emit a stopped case and coordination instruction for a known control check
  3. defer other commands to provenance/profile and identity validation
br: changed selected command -> recompute admission before execution
fail: unavailable exact source -> preserve typed source stop; never use branch HEAD
```

## Files and work units

Two disjoint units are **[batch-eligible]** for local worktrees after agreeing the optional error metadata contract:

- **A — Admission:** `engine/native-command-admission.ts` (new), `engine/failure-identity` helper/factory as needed, `orchestrate`, `heal`, assessment/inspect/CLI output and focused tests. A owns no executor/repository-error or Action acceptance file.
- **B — Source/resource error origins:** `packages/action/src/repository.ts`, `packages/core/src/executor/contree.ts`, `packages/action/src/repository.test.ts`, `packages/core/src/executor/contree.test.ts` and origin-focused fixtures. B owns no collector, report, orchestration/admission or Action acceptance file.

The integration owner exclusively owns `scripts/fleet-dogfood-metrics.mjs`, `scripts/fleet-dogfood-metrics.test.mjs`, `scripts/fleet-public-summary.mjs` and its tests, shared `packages/action/src/acceptance.ts`, terminal/failure-safe/main wiring, report consumers and final bundles. Neither unit A nor B edits these files. Integration is sequential. If implementation reveals overlapping files, serialize the affected units rather than coordinating concurrent edits.

## Behavioral oracles

- **P2-ZERO:** captured/sanitized native control case returns the expected reason and next action with zero import/snapshot/prepare/run/model calls in both entry paths; no fabricated reproduction occurred.
- **P2-FALLBACK:** a newly selected control command is stopped even after an earlier supported command was admitted.
- **P2-BOUNDARY:** legitimate direct Node/Python commands, unknown wrappers and an assertion containing Git/control words are not falsely classified as control checks.
- **P2-PARITY:** assess/inspect/Action/CLI agree on the same known blocker and expose missing evidence explicitly.
- **P2-SOURCE:** exact fetch exhaustion retains typed source identity and a recovery action; restoring an exact permitted ref allows the normal exact-SHA path; a different HEAD never substitutes.
- **P2-DISK:** positive provider ENOSPC is distinct from generic provider/OS errors, retains operation/cost evidence and shows the capacity action; recovered capacity allows only a newly authorized attempt.
- **P2-STRICT:** added details do not expand `expectedActionStop`, suppress internal failures, weaken require-fixed, turn unknown charges into zero, or make failed terminal persistence successful.
- **P2-PRIVATE:** arbitrary terminal text stays bounded/private; public exports use an explicit code whitelist and contain no project identifiers/commands/logs.

## Automated verification

```sh
pnpm --filter @sutura/core exec vitest run src/heal.failure-identity.test.ts src/heal.test.ts src/orchestrate.test.ts src/engine/failure-identity.test.ts src/executor/contree.test.ts src/incidents/assessment.test.ts
pnpm --filter @sutura/action exec vitest run src/acceptance.test.ts src/main.test.ts src/repository.test.ts src/terminal-failure.test.ts
pnpm --filter @sutura/core build
node --test scripts/fleet-dogfood-metrics.test.mjs scripts/fleet-incident-queue.test.mjs scripts/fleet-recovery-ledger.test.mjs
pnpm run ci:local
pnpm --filter @sutura/core test:coverage
pnpm --filter @sutura/action test:coverage
pnpm run test:ci-routing
```

Add new tests and other invalidated phase checks explicitly. Do not dispatch a paid case to prove a deterministic pre-sandbox stop.

## Manual acceptance and handoff

No manual action is required. Independent review checks both production paths, fallback reselection, false-positive counterexamples and visible recovery. Preserve current hosted settings. Handoff: exact candidate, zero-call evidence, terminal/public-export compatibility, remaining unknown wrappers and phase3 entry conditions. A cheaper refusal is not counted as a repaired project.
