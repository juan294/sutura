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
`repairPrsOpened` field is a historical fixed-outcome proxy and its `recovered`
field remains `null`. Use the recovery ledger for exact PR and target-branch
attribution. A `sutura-green` row requires a linked failed CI attempt, fixed
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

The aggregate summary contains no repository names. Review it before publishing
because it is operational evidence, not a controlled benchmark. A verified
repair count in the historical view is a proxy, not independent proof of a PR.
Human review and merge remain separate.

Set the repository variable `SUTURA_DISABLED=true` to skip the monitor before
credentials, providers, or sandboxes are used for a deferred or currently
unsupported project. Such skipped monitor runs remain `not-triggered` rather
than repair attempts.
