# Phase 3 — Release, benchmark and fleet observation

Parent: [Bounded, focused triage](../2026-10-03-sutura-bounded-focused-triage.md).
Depends on phase 2 and on separate authorization for each outward action:
release to `main`, the paid benchmark (cap stated in its manifest), the fleet
re-pin, `publish-demo`, `deploy` and the smoke.

## Work

- Release v0.3.9 through the existing release procedure
  (`docs/release/e2e-pro-playbook.md` §8, §8a): version literals, release PR,
  tag, npm, provider canary.
- Release benchmark under a new manifest (same configuration as v0.3.8 plus the
  recorded triage policy). Push freeze stays on from `init-spend` until the
  streak reports `stoppedFor: complete` (2026-10-03 incident).
- Case Lab bind, publish, deploy and one live smoke.
- Re-pin the fleet to v0.3.9 by API, chapa first: update chapa #1369 (or replace
  it) because chapa produced 11 of the 47 in-scope source failures and runs a
  stale pin; cirujano once its base is green.
- Observe for at least three days, then rerun the fleet collector and classify
  v0.3.9 attempts with the 2026-10-03 method (case files plus failure codes).

## Acceptance

Automated: benchmark gates hold (D7): zero false approvals, flaky accuracy
10/10 with every flaky `reproduced/of` equal to the fixture sequence, deceptive
rejection 11/11, and no `sandbox-budget` stop in any Placebo case (the largest
predicted v0.3.8 triage cost was 16.2 s). The benchmark configuration file
records the triage policy, so the manifest's `configHash` binds it.

Manual and observed: the release, Case Lab health and smoke readback as in the
v0.3.8 record; fleet report of v0.3.9 attempts from the collector (which now
records `triage.stopReason`) with triage sandbox seconds per attempt, focused
probes kept and rejected, and every `sandbox-budget` stop with its repository
and predicted seconds, including whether chapa reached a focused probe or the
budget stop. A fleet result is reported as measured, including zero repairs if
that is what happens.

## Stuck states

A `sandbox-budget` stop in the fleet is visible in the consumer's check summary
and names the input; the observation report lists each one. A benchmark gate
miss blocks promotion and goes back to phase 1 or 2 locally under a new
candidate.
