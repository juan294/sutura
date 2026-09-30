# Fleet recovery observation — 28 September 2026

This is a read-only observation of the configured fleet, recorded at
2026-09-28 09:11:12 UTC. The 24 repository windows end between 08:47:52 and
09:09:41 UTC; each starts at its configured measurement or activation bound
between 13 and 26 September. The [aggregate JSON](fleet-recovery-observation-2026-09-28.json)
contains the versioned machine-readable result. Detailed repository and run
evidence remains in ignored local `.sutura/` files.

| Measurement | Observed result |
| --- | ---: |
| Installed monitors | 24 |
| Active / disabled monitors | 23 / 1 |
| Uninstalled / inaccessible repositories | 0 / 0 |
| Repositories with no eligible failed CI attempt | 6 |
| Failed or timed-out CI attempts | 159 |
| Attempts linked to a Sutura monitor result | 141 / 159 |
| Verified repair PRs | 0 / 159 |
| Sutura-green / proposal-only | 0 / 0 |
| Authenticated agent-fallback-green | 0 |
| Resolved externally / unresolved / unknown | 73 / 68 / 18 |
| Cost measured / unavailable | 67 / 92 incidents |
| Sum of measured inference and sandbox cost | $88.5511 |

The 18 unknown incidents have no usable monitor link. Among linked incidents,
102 terminal outcomes were infrastructure stops, 37 were gave-up, and two
monitor outcomes were fixed. A fixed monitor outcome alone is not a verified
repair: a sampled repair PR was unmerged and lacked target-branch green proof.
Direct GitHub API spot checks also matched one externally resolved, one
unresolved, and one unknown source attempt against its recorded identities.
No available incident satisfied the exact repair PR, repair CI, integration,
and target-branch green chain. The default collector has no authenticated
agent-session source, so agent fallback remains unmeasured as an attribution
capability; zero is the count of *verified* fallback recoveries.

## Comparison coverage

The preceding 45-day baseline is separate for each repository and monitored
workflow. Twenty-three activation dates are interval bounds, so their
baselines are censored. One repository has no defensible activation date and
its baseline is unmeasured. The measured portions contain 397 failed attempts
among 2,391 completed CI attempts (16.6%); the later windows contain 159
among 675 (23.6%). The windows, activation uncertainty, and different run
mix do not support a causal improvement or regression claim.

Observed same-workflow, same-branch green followed 269 of 397 baseline
failures and 74 of 159 later failures. Median time among these observed
resolutions was 2,352 seconds before and 3,065 seconds after; the 95th
percentiles were 121,971 and 97,543 seconds. The other 128 baseline and 85
later failures are censored from recovery-time statistics. These green runs
include external resolutions and are not evidence of Sutura recovery.

## Evidence and publication limits

The source-run denominator was checked against a separate read-only inventory:
all 131 independently listed eligible failed runs are present. The collector
also found 28 later or prior rerun attempts that the inventory's latest-run
listing did not count. API pagination completed for every configured
repository. A failed run and its monitor, a failed run without same-workflow
branch green, and an incident without monitor evidence were separately
spot-checked through GitHub's API.

The JSON was checked against all private repository identities, run IDs,
URLs, log fields, and free text; none appears in the export. No live private
case is published without publication consent. Costs are partial and no
subscription-dollar saving is claimed.
