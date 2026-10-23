# Fleet dogfood metrics

Sutura can rebuild a cumulative dogfood ledger from GitHub Actions evidence.
The collector reads each repository's `sutura.yml` workflow runs and downloads
the bounded HTML case file or structured terminal-failure JSON for every repair attempt. It records green CI runs
where no repair was needed separately from actual repair attempts and from
cancelled or otherwise non-repairable CI conclusions.

Copy `fleet-dogfood-config.example.json` to the gitignored
`.sutura/fleet-dogfood-config.json`. Set the default owner, repository names, exact
Sutura Action commit, and the UTC instant when measurement starts. Repository
entries can use `owner/name` for collaborator projects. They can include private
repositories because the config and detailed output stay gitignored.

Run:

```bash
pnpm run dogfood:fleet-metrics
```

The configured GitHub CLI account must be able to read Actions in every listed
repository. The collector keeps four historical v2 monitor artifacts:

- `summary.json` and `summary.md` contain cumulative fleet totals.
- `events.jsonl` contains one detailed local record per Sutura monitor run.
- `installations.json` records whether the monitor exists in each repository.
- `snapshots.jsonl` retains one aggregate snapshot per UTC day.

It also writes a versioned recovery ledger in the same ignored output directory:

- `monitor-evidence-v2/` holds content-hashed parsed monitor observations. Each
  observation is written atomically before the next artifact request. A later
  missing or expired artifact does not erase known evidence.
- `observations-v2/` holds immutable, content-hashed incident observations.
  `incidents-v2.jsonl` is the current detailed local view; an incomplete later
  collection does not replace an incident's stronger known proof.
- `installations-v2.json`, `baselines-v2.json`, and `post-windows-v2.json` are detailed local inventory
  and comparison records. These files can contain private repository names.
- `recovery-summary.json` is an aggregate-only export. It reports the exact
  source-incident denominator, terminal states, Action SHA cohorts, cost
  coverage, before/after incident rates, recovery time and runs to green, and
  collection and baseline completeness. Recovery time and runs to green are
  calculated only for observed resolutions; unresolved incidents are counted
  separately as censored. Review the summary before publication.

The v1/v2 monitor output keeps its original semantics. In particular, its
`repairPrsOpened` field is a historical successful-wrapper/fixed-outcome proxy;
it does **not** independently prove that a PR was opened. The `recovered` field
remains `null`. Neither proxy is presented as verified delivery in the Markdown
report. `monitorConclusions` counts workflow wrapper conclusions separately.
A green advisory wrapper can contain a non-fixed outcome.

The report's `delivery` object distinguishes `typedFixedOutcomes` (sandbox
verification) from `verifiedRepairPrs` (a linked PR with successful native repair
CI) and `integratedRecoveries` (exact integration and target-branch green proof).
The latter two are populated only from the strict recovery ledger collected in
the same invocation; without that ledger they remain `null`, not zero. A partial
ledger retains known proof while its independent collection dimension remains
incomplete. These aggregate counters reveal no private repository identities.

The `evidence` object reports collection, baseline and actor-provenance coverage
separately. Collection completeness is API evidence coverage, not operational
health. Missing activation maps leave baseline evidence incomplete even when all
API pages were collected. `evidence.freshness` retains each monitor/recovery
collection timestamp, age in seconds, assessment timestamp and a documented
36-hour threshold for daily collection. Older evidence is `stale`; missing,
invalid or future timestamps are `unavailable`. The `writeFleetMetrics` helper
accepts an observation clock and `maxAgeSec` for deterministic callers. Freshness
alone never establishes repair success or fleet health. A retained previous
summary is dated evidence until a new collection completes.

The fixed-outcome percentage uses **all monitor attempts**, including infrastructure
stops and missing terminal evidence. It is not a search-only repair rate.
Use the recovery ledger for exact PR and target-branch attribution. A
`sutura-green` row requires a linked failed CI attempt, fixed
monitor, source-marked repair PR and diff, passing repair-branch CI, integration
commit, and same-workflow green run on the intended branch. A verified PR with
integration pending is `sutura-proposed`. A later green without those links is
`resolved-externally` unless authenticated agent provenance proves
`agent-fallback-green`. Missing or ambiguous evidence stays `unknown`.

Optional ignored `activationAtByRepository` values in the config bound each
repository's preceding 45-day comparison. `activationEvidenceByRepository`
can record the first observed monitor run as an upper bound. When enablement
occurred somewhere in that interval, the baseline is labeled `censored`;
it is not treated as an exact untreated comparison. GitHub run attempts are
fetched separately because a successful rerun can replace a prior failed
conclusion in the ordinary workflow-run listing. GitHub indexes reruns under
the original run's creation time, so the collector searches 35 days before
the measurement window and reads each rerun attempt's own creation time.
API page failures leave the affected repository unmeasured. If a later
complete API scan cannot find a previously observed run, its local evidence
remains visible and the denominator is marked incomplete.

The incident and comparison windows use each CI attempt's GitHub creation
time. Recovery duration starts when the failed attempt completed and ends when
the next same-workflow, same-branch green completed. The collector retains
older observations for evidence, but a complete rescan selects only incidents
in its current configured window.

Each run queries the full configured window again. A missed scheduled run does
not lose intermediate Sutura attempts while their GitHub evidence remains
available. `unknown` remains explicit when an attempted run has missing,
expired, or unreadable terminal evidence. Structured failures are grouped by
stable code and stage. Attempted, claimed, provider-invoked, search-started, and
fixed counts remain separate in that historical view. Measured cost totals include
inference and sandbox charges reported by the case file; unknown cost is never
treated as zero.

Cached monitor observations are scoped to the configured repositories and window.
Short names and `owner/name` aliases for the same repository share one run/attempt
identity, including when GitHub names differ only in case. Removing a repository
from the config excludes it from current totals while preserving its immutable
evidence files. Each snapshot records its collection window and expected Action
SHA; older Action SHA cohorts remain historical evidence, not current-version repairs.

The aggregate summary contains no repository names. Review it before publishing
because it is operational evidence, not a controlled benchmark. A verified
repair count in the historical view is a proxy, not independent proof of a PR.
Human review and merge remain separate.

Set the repository variable `SUTURA_DISABLED=true` to skip the monitor before
credentials, providers, or sandboxes are used for a deferred or currently
unsupported project. Such skipped monitor runs remain `not-triggered` rather
than repair attempts.
