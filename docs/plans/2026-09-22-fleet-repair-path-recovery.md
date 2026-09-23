# Fleet repair-path recovery: make a verified repair reachable

Date: 2026-09-22

Status: All four phases done (2026-09-22/23; see `2026-09-22-fleet-repair-path-recovery-notes.md`). Next wall: #152

Owner: Juan

Integration branch: `develop`

Release branch: `main`

Submission deadline: 2026-10-30 at 10:00 PDT

Source measurement: [2026-09-22 fleet dogfood metrics](../research/2026-09-22-fleet-dogfood-metrics.md)

Tracking issue: [#150](https://github.com/juan294/sutura/issues/150) (Phase 2);
[#136](https://github.com/juan294/sutura/issues/136) is parked by Phase 2's
finding, not implemented.

## Why this plan exists

Across 18 repositories and 370 monitor triggers, Sutura has produced **zero
verified repairs**. 76 runs had red CI to work with; 56 of them died at a
fail-closed gate before diagnosis, 12 stopped as `infra-stop`, 8 reached
`gave-up`. The winning thesis — "AI agents can make CI green; Sutura proves
whether they fixed the problem" — currently has no fleet evidence behind it.

This plan removes the two gates that account for 51 of those 76 runs, proves
the repair path works end to end on a real consumer repository, and finds out
what the next wall is.

## What is true today (VERIFIED 2026-09-22)

- **The runtime-evidence gate is fixed but unproven.** `.sutura.json` with an
  explicit `runtime` now sits on the default branch of 13 repositories, and
  every file parses under `parseRepositoryPolicy`. It has **not** been observed
  clearing the gate in a live run: the four repositories whose CI ran after the
  push went green, so the monitor skipped. Both v0.2.1 and v0.3.1 accept the
  `runtime` key (`git show v0.2.1:packages/core/src/policy/schema.ts:31`), so
  repositories still on the old pin also benefit.
- **The failing-command gate has two distinct causes, not one.** Issue #150
  describes only the first:

  | Cause | Mechanism | Runs | Repos |
  | --- | --- | ---: | --- |
  | **A — byte cap** | `adapter.ts:68-70` *does* retain the command line, but `classifyMechanically`'s `finalLines` re-trims to 200 lines / 20 000 chars / **20 000 bytes** (`classify.ts:12-14, 27-33, 94`) and the header falls outside it | 12 | gh-glance 8, sutura 2, cirujano 1, gh-glance(older) 1 |
  | **B — marker miss** | `failedStepLog` searches for `` `##[group]${step.name}` `` (`adapter.ts:61`). A step with a custom *display name* never matches, `groupIndex` is `-1`, and the header is never retained at all (`adapter.ts:68-70` falls through to `matching.slice(-FAILED_STEP_LINES)`) | 5 | layalga 4, archy 1 |

  Evidence: gh-glance's log contains `##[group]Run npm run test:pty` once
  (step name == command); layalga's failing step is *named* "Run browser tests"
  and that marker appears **0 times** — its real header is
  `##[group]Run pnpm …`. Same for archy ("Test release-evidence contracts").
- **Step names are not a safe command source.** Layalga's display name
  "Run browser tests" matches `failingCommand`'s `^(?:Run|\$)\s+(\S.*)$`
  (`classify.ts:49`) and would yield the non-command `browser tests`. The
  header must come from the step's own log.
- **The same bug exists a second time.** `failureLog` (`heal.ts:1616-1621`)
  builds `` `Run ${command}` `` + output and applies the identical 200/20 000/
  20 000 `boundedTail`, so the reproduction log inside the repair loop loses its
  header on verbose output too.
- **Hashes are safe; replay assertions are not.** `bundleSha256` covers only the
  raw `bundle.json` bytes (`scripts/captured-fixtures.test.mjs:54-56, 100`), so
  no fixture hash can break. But replay compares recorded request bodies exactly
  (`replay-fetch.ts:57-84`), and the nano classify body contains
  `collectFailedLogs` output verbatim — confirmed in bundles `33321106629`
  (seq 50), `33323765566` (seq 44), `33325938237` (seq 43), all beginning
  `[checks / Run pnpm run test]`.
- **No fleet bundle exists.** All 29 captured bundles are `juan294/sutura`; the
  Case Lab fixture is `juan294/sutura-demo`. There is no gh-glance or layalga
  bundle and no offline regenerator — `scripts/capture-run.mjs` is a live tool.
- **The 12 `infra-stop` runs are not a ConTree outage.** They come from
  `preparationFailureCaseFile` (`heal.ts:507-531`, via `orchestrate.ts:672-686`),
  which fires when a sandbox command **exited non-zero during preparation**. A
  thrown `ContreeError` takes a different path that never prints the
  `ConTree runtime:` line at all — the one real HTTP 504 (roots) is a separate
  event that concluded `failure`. Zero model spend is guaranteed on this path.
- **The cause is already recorded; the log line just doesn't show it.**
  `evidence.ts:29-36` interpolates only triage counters, so the line is
  diagnostically empty. But the case file keeps `errorExcerpt` (a 2 KB tail of
  the failing install's output) and a per-stage sandbox table, and
  `sutura-replay-<runId>.json` keeps the untruncated `RunResult`. The adjacent
  `Sandbox evidence: operations=N` line already discriminates the three
  preparation failures: **2** = Python dependency-input throw
  (`heal.ts:626-642`), **4** = network-enabled install failed
  (`heal.ts:670-678`), **6** = git baseline init failed (`heal.ts:700-702`).
  Phase 3 is therefore a read of existing artifacts, not a new investigation.
- **Local evidence already exists**: `.sutura/fleet-dogfood-metrics/events.jsonl`
  carries the per-run cost and elapsed time. coach's signature is bimodal —
  4 runs at ~27 s / $0.28 versus 3 at ~1.25 s / $0.013 — so at least two
  distinct causes sit inside those 7.
- **`diagnosis.errorExcerpt` is published without redaction.** Unlike trace
  events and terminal-failure messages, this path never calls
  `redactExternalText`, yet the excerpt goes into the public case-file artifact
  and the PR comment (`casefile.ts:93`, `markdown.ts:30`). A registry token
  echoed by a failing install would be published.
- **paisaxe needs `main`.** All 22 of its monitor runs, including all 8
  failures, are on `main`. Its `develop` is 554 commits ahead. Neither half of
  the fix reaches it until `main` changes.
- **The fleet workflows have drifted from `sutura init`.** The deployed copies
  set `capture-replay: true` and `runtime: auto` but lack the
  `vars.SUTURA_DISABLED != 'true'` kill switch that `setup.ts:76` now generates,
  and do not pass `openai-api-key` / `typesafe-api-key`.
- **`pnpm run dogfood` is already a seeded-red-CI harness** (~USD 1.05/run,
  `docs/demo/dogfood-ledger.json`), but it is hard-wired to `juan294/sutura`
  (`scripts/dogfood.mjs:235,242,254,276,283,295,457,572,629,729`) and cannot be
  pointed at a consumer.

## Design decisions

1. **Prove the consumer fix in termplex, not via dogfood.** The runtime-gate fix
   lives in the *consumer's* `.sutura.json`; dogfood runs against `sutura`,
   whose policy file already existed, so it cannot prove it. termplex is chosen
   because it has never gone red (11 triggers, 0 red) and its failing step will
   be short — the command header survives, isolating the runtime fix from #150.
2. **Live proof before the #150 fix.** Accepting that the pinned v0.3.1 still
   contains the truncation bug: termplex's failure is small enough that Cause A
   cannot fire, so the run is still a clean test of the runtime gate.
3. **Fix both causes in one change, at one place.** Carry the command header
   *outside* the bounded tail rather than hoping it survives, and make the
   adapter's header retention independent of the step's display name. A shared
   helper keeps `collectFailedLogs`, `classify` and `failureLog` consistent.
4. **Recorded bundles are historical evidence and stay untouched.** Where the
   new excerpt text breaks a replay fingerprint, the *test assertion* moves and
   carries a comment saying why — the precedent set at
   `packages/case-lab/src/replay.test.ts:125-135`.
5. **#136 is parked, not built.** Its premise (logs omit the command) is false
   for both runs it cites; the evidence is posted as a comment on the issue.
   Re-measure after Phase 2 before building a configured-fallback feature.
6. **paisaxe gets a targeted two-file PR against `main`**, not a 554-commit
   release.

## Phases

| # | Phase | File | Needs authorization | Batch |
| --- | --- | --- | --- | --- |
| 1 ✅ | Prove the runtime fix with a real red CI in termplex | [phase-1](2026-09-22-fleet-repair-path-recovery-phases/phase-1.md) | **Yes** — one paid live run, ~USD 1, in a consumer repo | `[batch-eligible]` with 4 |
| 2 ✅ | Carry the failing command past truncation (causes A and B) | [phase-2](2026-09-22-fleet-repair-path-recovery-phases/phase-2.md) | no | sequential |
| 3 ✅ | Root-cause the `infra-stop` wall from existing artifacts; redact the excerpt | [phase-3](2026-09-22-fleet-repair-path-recovery-phases/phase-3.md) | no | sequential, after 2 |
| 4 ✅ | Fleet loose ends: kalpha push, paisaxe `main` | [phase-4](2026-09-22-fleet-repair-path-recovery-phases/phase-4.md) | **Yes** — a PR against paisaxe `main` | `[batch-eligible]` with 1 |

Phases 1 and 4 touch no file in this repository and no file in common with each
other, so `/batch` may run them in parallel. Phases 2 and 3 both change
`packages/core` and both rebuild the committed
`packages/action/dist/index.cjs`, so they must not run in parallel — the bundle
would conflict.

## Order

1. Phase 1 and Phase 4 (parallel). Phase 1 answers "does the repair path work
   for a consumer at all", which is the question the submission depends on.
2. Phase 2 once Phase 1 has reported, so the live run is interpreted against
   known code.
3. Phase 3 last: it is the next wall only if Phases 1–2 succeed.

## Success criteria

**Automated**

- `pnpm run ci:local` green after Phase 2 and after any Phase 3 change.
- `pnpm run test:captured-fixtures` green — no bundle hash drifts.
- New named replay test for the Cause B fixture is green and fails without the
  fix (assert by reverting the change locally once).
- A test over the captured fleet logs asserts a correct command for all 17
  previously-gated runs (fixtures named in phase-2).
- `git status --porcelain packages/action/dist` is empty after
  `pnpm run build` in the same commit as any `packages/core` change.

**Manual**

- Phase 1: a termplex monitor run reaches a `Sutura outcome:` line — any
  outcome other than the runtime-evidence gate — and its log shows
  `policy-sha=` something other than `default`.
- Phase 3: the root cause of the 12 `infra-stop` runs is named in a dated
  research document, with a statement of whether it is ours to fix.
- paisaxe's PR against `main` is opened and left for human review.

## Out of scope

- Merging paisaxe `develop` into `main` (a release decision).
- Any push to `layalga` or `spoken-letter` — both remain under code freeze;
  their local `develop` commits stay local.
- Any commit or push to `frivas/roots` — third-party.
- Building #136's configured fallback command.
- Regenerating or re-capturing replay bundles from paid runs.
- Re-pinning the fleet to a post-#150 release; that is the next release cycle.
