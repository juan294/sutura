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
