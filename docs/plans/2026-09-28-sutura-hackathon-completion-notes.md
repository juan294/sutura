# Hackathon completion implementation notes

## Phase 1 — Fleet evidence and recovery attribution

Execution started from local `develop` at `77f9872` in the isolated
`sutura/phase1-fleet-evidence` worktree. The planning base was
`d249c2562704d4b42c22a08e06c5ffd0dc2bfe9c`; the execution base was
rechecked before editing. GitHub access in this phase was read only. Private
fleet inputs and detailed output remain under `.sutura/` and are ignored.

The collector now inventories repository and workflow state, expands CI rerun
attempts, retains content-hashed terminal evidence and incident observations,
and classifies recovery only from exact CI, monitor, PR, repair CI, integration,
and target-branch identities. Its versioned summary excludes repository and
run identities. A later API failure cannot erase known incident proof. A run
that disappears from a later complete GitHub listing makes denominator
coverage incomplete. Before and after windows use each attempt's creation
time; recovery duration starts at failed completion. GitHub permits reruns for
30 days after the original run, so the CI listing uses a 35-day parent-run
lookback. This limit comes from [GitHub's rerun documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).

## Deviations and limits

- The initial local config named 21 repositories. Read-only reconciliation
  found 24 installations. The measurement uses a separate private config and
  leaves the prior config untouched.
- Activation is bounded by installation or update evidence and the first
  observed monitor run. A baseline inside that interval is censored, not an
  exact untreated comparison.
- The default GitHub client has no authenticated agent-session source.
  Agent fallback therefore remains a coverage gap and is never inferred from
  author text or a later green CI run.
- No private live case has publication consent. The public report contains
  aggregate counts only; no repository names, run IDs, URLs, logs, or source.
- A local API scan at 08:42 UTC was incomplete after GitHub returned HTTP 403
  rate limiting. It was superseded by saved per-repository reads. One broad
  pass also returned an implausible empty workflow result; the per-repository
  refresh and exact run API restored eight incidents. The immutable earlier
  observations were checked against the attempt API before final aggregation.

## Phase 1 read-only result

The final local aggregate was written at 2026-09-28 09:11:12 UTC. Its
repository windows ended from 08:47:52 to 09:09:41 UTC. All 24 configured
repositories were read: 23 active, one disabled, none uninstalled or
inaccessible. The declared windows contain 159 failed or timed-out attempts.
An independent earlier inventory listed 131 eligible current failed runs;
all 131 appear in the ledger. The other 28 are later observations or failed
attempts hidden by a later rerun in the inventory's latest-run listing.
The summary reports complete incident pagination, zero missing prior runs,
and zero unresolved legacy-window timestamps.

Of 159 incidents, 141 have a monitor link, none has a verified repair PR,
none is Sutura-green or proposal-only, 73 are externally resolved, 68 remain
unresolved, and 18 lack enough monitor evidence. No fallback recovery has
authenticated actor proof. Cost is measured for 67 incidents ($88.5511 in
reported inference and sandbox cost) and unavailable for 92. No saved
subscription spend is claimed. One example of each available outcome class
was traced read-only against GitHub API identities. A fixed monitor case had
an unmerged PR and no target-branch green proof.

The before/after comparison has 23 censored activation baselines and one
unmeasured baseline; it is descriptive only. Its measured portions contain
397 failures in 2,391 completed attempts before and 159 in 675 after. The
public redacted account is in [the demo report](../demo/fleet-recovery-observation-2026-09-28.md).

## Phase 2 measured blocker handoff

Historical monitor attempts span multiple Action SHA cohorts. Structured
failure codes include 34 runtime-evidence-limit, 22
failing-command-not-observed, 11 ConTree errors or HTTP 504, six
already-attempted claims, and one replay-snapshot-limit. These are triage
counts, not proof that each still reproduces on the latest Action. Phase 2
should use the exact private incident and SHA ledger to disposition #135 and
#136, then replay current candidates before changing behavior. The two fixed
monitor outcomes do not satisfy the recovery oracle. A public live case
remains unavailable without publication consent.

## Verification record

- Focused collector and ledger tests passed, including rerun boundaries,
  crash and artifact expiry, PR attribution, privacy, and missing-run coverage.
- Independent code review found and verified repairs for a run-attempt window
  error, journal completeness, and exit-status propagation.
- The post-review simplify pass checked shared collector helpers, persistence,
  and the recovery ledger. It removed redundant GitHub reads for stale parent
  runs and found no remaining behavior-preserving simplification.
- `pnpm run typecheck` and `pnpm run lint` passed in the worktree.
- The first `pnpm run test` lacked built workspace package exports. After
  building `placebo`, the second test run found the case-lab site build needed
  the other workspace packages built. `pnpm run build` then passed. These
  failed runs remain part of the verification record. The third `pnpm run
  test` passed all six tested workspace packages, including placebo's 234
  tests. `pnpm run verify:bundle` passed against the current source bundle.
- The first `pnpm run ci:local` passed the contracts, setup, smoke, typecheck,
  lint, bundle, and workspace test gates. Its package install gate rejected
  the uncommitted candidate, as `test-candidate-install.mjs` requires an exact
  clean commit. The package and guard gates therefore remained unverified in
  that run.
- After commit `72f5c034f9a116bb57290bd165f9b10f5d34585a`, the clean-candidate
  `pnpm run ci:local` passed, including package install and 673/673 guards.

## Phase 2 — Measured blockers and local candidate hardening

Phase 2 started on local `develop` at `72f5c03` in the isolated
`sutura/hackathon-phases-2-7` worktree. The Phase 1 private ledger remained
ignored in the original checkout. Read-only GitHub checks did not mutate
issues or dispatch provider work.

The private incident ledger has one historical snapshot-cap result, on an
older Action cohort. Its consumer monitor is now disabled and has no later
attempt that proves a current cap. Issue #135 remains open; no broader
exclusion policy was implemented. Current snapshot size and safety guards are
at `packages/core/src/executor/contree.ts:44-46,948-965,1053-1065,1154-1199`.
All 22 `failing-command-not-observed` incidents are on older Action cohorts;
none is among 15 current v0.3.3 monitor attempts. The original #136 examples
had commands in their source logs, and the post-#150 adapter and classifier
retain observed command headers (`packages/core/src/github/adapter.ts:56-95`,
`packages/core/src/diagnose/classify.ts:41-47,125-140`). Issue #136 remains
open and the configured fallback stays parked. Zero current observed cases
does not prove the condition cannot recur.

The v0.3.3 release report called all six missed repairable cases `gave-up`.
The saved result records five `gave-up` and one `refused` (`repair-bad-import`);
the report is corrected without changing the historical score. Its 3/15
hidden score covers 11 deceptive trap checks and four repair checks, of which
three passed and one was not run. `packages/placebo/src/score.ts:186-194`
already reports the repair and deceptive subsets separately.

The `repair-bad-import` case artifact records a missing relative import from
the workspace root, but the diagnosis called it an upstream dependency.
The audit refused the candidate patch, so no false approval occurred. A new
regression in `packages/core/src/diagnose/classify.test.ts` failed before the
fix. Classification now treats that narrow root-source pattern as a local
build failure only when Nano labels it upstream and no competing mechanical
class is present. Dependency, hidden package directory, unknown importer,
mixed TypeScript, and other Nano-class controls remain unchanged. This is a
new local candidate; the v0.3.3 quality result does not transfer to it.

## Deviations

- The plan called for captured replay before a behavior change. Saved v0.3.3
  case summaries have the diagnosis and outcome, but the workflow uploaded
  case summaries rather than complete provider replay bundles. The 24/24
  local recovery integration suite tests deterministic controller paths and
  older captured diagnoses; it cannot replay the six v0.3.3 provider proposals.
  The classifier regression uses the exact saved error shape. A new live fix
  rate requires a separately authorized bounded capture and measurement.
- The phase specification describes six v0.3.3 `gave-up` repair cases. The
  result artifact shows five `gave-up` and one `refused`; the public report
  now names both outcomes. This corrects a factual label, not the denominator.

## Phase 2 review and local checks

The independent blocker review checked current Action cohorts and issue
evidence. The independent code reviewer found that the first local-import
matcher could misclassify installed dependencies and a mixed log. Negative
tests reproduced those cases before repair. The reviewer approved the narrowed
classifier and report correction; this approval does not establish a live
repair. The simplify pass hoisted the competing-class list and found no useful
additional reuse or allocation change. The focused classifier, grounding and
orchestration suites passed 164/164; `pnpm run typecheck`, `pnpm run lint`, and
`git diff --check` passed after simplification. No paid or public outcome is
claimed from these local checks.
