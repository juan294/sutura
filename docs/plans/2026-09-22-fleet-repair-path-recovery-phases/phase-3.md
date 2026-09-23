# Phase 3: Root-cause the `infra-stop` wall and stop publishing an unredacted excerpt

Sequential, after phase 2 — also touches `packages/core` and the committed
Action bundle.

## Goal

Name the cause of the 12 `infra-stop` runs (coach 7, roots 5) and close the
redaction gap found while researching them. This is the only category that got
*past* the gates, so it is the next wall once phases 1–2 land.

## Current behaviour (VERIFIED)

- These runs are **not** a ConTree outage. They come from
  `preparationFailureCaseFile` (`heal.ts:507-531`) via `orchestrate.ts:672-686`,
  which fires when a sandbox command **exited non-zero during preparation**. A
  thrown `ContreeError` takes a path that never prints the `ConTree runtime:`
  line and concludes `failure` — the single roots HTTP 504 is that separate
  case. Zero model spend is guaranteed here (`heal.test.ts:1302-1321`).
- `prepareSandboxFromSource` (`heal.ts:622-707`) returns `{ok:false}` in exactly
  three places, and the **`Sandbox evidence: operations=N` line already tells
  them apart**:

  | `operations` | Failure | Line |
  | ---: | --- | --- |
  | 2 | `runtime.dependencyInputs()` threw — Python lock inputs missing; unreachable for Node, whose inputs are a constant (`runtime/node.ts:49-51`) | `heal.ts:626-642` |
  | 4 | the **network-enabled dependency install** exited non-zero | `heal.ts:670-678` |
  | 6 | the **git baseline init** exited non-zero (runs with network **disabled**, and includes `pnpm/npm rebuild`) | `heal.ts:700-702` |

- The cause is already recorded per run: `errorExcerpt` (2 KB tail of the
  install output) and a per-stage sandbox table in
  `sutura-case-file-<runId>.html`, plus the **untruncated** `RunResult` in
  `sutura-replay-<runId>.json` → `executor[]`. The `ConTree runtime:` log line
  itself carries no error detail by construction (`evidence.ts:29-36`).
- `.sutura/fleet-dogfood-metrics/events.jsonl` holds per-run cost and elapsed
  time. **coach is bimodal**: 4 runs at ~27 s / $0.28 versus 3 at ~1.25 s /
  $0.013 — at least two distinct causes inside those 7. roots sits at ~3 s.
- The dependency snapshot admits only a whitelist (`contree.ts:711-746`): root
  and workspace `package.json`, the lock files, `pnpm-workspace.yaml`,
  `.yarnrc.yml`, Python locks and declared `file:vendor/...` directories.
  Anything else an install needs is absent — `patches/` for pnpm
  `patchedDependencies`, `.nvmrc`, a preinstall's `scripts/`,
  `.yarn/releases/*.cjs`. The v0.2.1 remediation notes record the same failure
  shape: eight upstream evaluations stopped in dependency preparation because
  the snapshot omitted needed directories
  (`docs/plans/2026-09-01-sutura-v0.2.1-evidence-remediation-notes.md:25`).
- `corepack pnpm install --frozen-lockfile` / `npm ci` make **any lockfile
  drift a hard failure** (`runtime/node.ts:9-18`).
- There is **no retry**: each preparation step runs once, and `claimAttempt`
  (`adapter.ts:205-266`) blocks re-running the same workflow run, so an
  infra-stop is permanent for that CI failure.

## Step 1 — Read the artifacts (no new runs, no cost)

For each of the 12 runs, pull the already-uploaded evidence:

```bash
gh run view <monitor-run-id> -R <repo> --log | grep -E "Sandbox evidence:|ConTree runtime:"   # operations=N
gh run download <monitor-run-id> -R <repo> -n sutura-case-file-<ciRunId>.html                 # Error specimen + stage table
gh run download <monitor-run-id> -R <repo> -n sutura-replay-<ciRunId>.json                    # untruncated RunResult
```

Run ids are in `.sutura/fleet-dogfood-metrics/events.jsonl`
(`"outcome":"infra-stop"`). Artifact retention may have expired for the
September-13/14 runs; if so, say so rather than inferring, and use the later
ones.

Tabulate: repo, run, `operations`, failing command, exit code, first real error
line. **Read the excerpt as a head, not a tail** — it is a `boundedTail`, so a
verbose installer can push the real error out of the 20-line window; if that has
happened, the replay bundle has the full output.

## Step 2 — Fix the redaction gap (independent of what step 1 finds)

`diagnosis.errorExcerpt` on this path is **not** passed through
`redactExternalText`, unlike trace events (`trace/sanitize.ts:21`) and
terminal-failure messages (`terminal-failure.ts:52`). It is published in the
case-file artifact (`report/casefile.ts:93`) and the PR comment
(`report/markdown.ts:30`). A failing `npm ci` that echoes a registry token
would publish it.

```ts
// heal.ts preparationFailureCaseFile — redact before the excerpt escapes
const excerpt = redactExternalText(
  boundedTail([result.stdout, result.stderr].filter(Boolean).join('\n'),
    { maxLines: 20, maxCharacters: 2_000, maxBytes: 2_000 }),
).trim();
```

Test (`heal.test.ts`): a preparation failure whose stderr contains a
credential-shaped string produces a case file whose `errorExcerpt` does not
contain it, and still contains the surrounding error text.

## Step 3 — Write up, then decide

Write `docs/research/2026-09-22-infra-stop-preparation-failures.md` naming, per
run: which of the three preparation failures fired, the underlying cause, and
whether it is ours to fix or the repository's. Expected shapes to check for
explicitly:

- a lockfile that `--frozen-lockfile` / `npm ci` rejects (repository's to fix);
- an install needing a file the snapshot whitelist omits (ours — extend the
  whitelist, as `file:vendor/...` support already did);
- a `rebuild` needing network in the network-disabled git-init step (ours).

Do **not** implement a fix for the root cause in this phase. File it with the
evidence and let it be scheduled, unless it turns out to be a whitelist addition
of the same shape as `contree.ts:830-899`, which may land here.

## Verification

```bash
pnpm --filter @sutura/core exec vitest run src/heal.test.ts
pnpm run build && git status --porcelain packages/action/dist
pnpm run ci:local
```

## Done when

Each of the 12 runs is attributed to one of the three preparation failures (or
recorded as evidence-expired), the redaction test is green, `ci:local` is green,
and the research document states plainly which causes are ours. STOP.
