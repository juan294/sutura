# Notes: `2026-09-22-fleet-repair-path-recovery`

## Deviations

### Phase 2

- **Header scan direction.**
  Plan said: carry the first header found in the first 64 lines.
  Found: `failingCommand` picks the last match. Layalga's two failed steps
  (acceptance, integration) are concatenated, and the bounded tail shows only
  the integration step's output.
  Chose: `boundedTailWithHeader` carries the nearest header at or before the
  cut (backward scan). It returns the plain tail when the header alone would
  exceed a bound or when `maxLines < 2`.
  Why: `failingCommand(boundedTailWithHeader(x))` then equals
  `failingCommand(x)`, and the carried command belongs to the step whose output
  the tail shows. With a first-header scan, layalga would pair `test:e2e` with
  integration output.

- **Adapter fallback match.**
  Plan said: `findIndex` of the first `##[group]Run ` line in the step window.
  Found: the window starts at second precision. The real layalga fixture
  (job 106300682270) opens with 3 lines from the previous step in the same
  second.
  Chose: `findLastIndex` of `/^\S+Z ##\[group\]Run\s/`.
  Why: last match cannot pick an earlier same-second step's header, and the
  existing step-name path already uses `findLastIndex`.

- **`errorExcerpt` stays a plain tail.**
  Plan said: `finalLines` delegates to the header-preserving tail everywhere.
  Chose: only the 200-line classifier/prompt log carries the header. The
  20-line `errorExcerpt` is still a plain `boundedTail`.
  Why: a published excerpt that already works must not change.

- **Fixture layout and scope.**
  Plan said: `github/__fixtures__/layalga-106300682270-named-step.log` and
  `diagnose/__fixtures__/gh-glance-106473097216-verbose.log`; the Cause B test
  goes in `adapter.captured.test.ts`; 17 runs.
  Found: `archy` is a private repository and this repository is public. The
  17th run (sutura) is absent from `.sutura/fleet-dogfood-metrics/events.jsonl`.
  Chose: every committed fleet fixture lives in
  `packages/core/src/__fixtures__/fleet-gated/`: 15 runs from gh-glance,
  layalga and cirujano, each trimmed to the failed step's time window, plus a
  `runs.json` manifest. `github/fleet-gated.captured.test.ts` holds the fleet
  table, the Cause B named test and the false-positive guard. archy was
  verified locally only (`pnpm run test:release-evidence` recovered) and is not
  committed.
  Why: no private-repository content goes into a public repository. 16 of the
  17 runs are verified; the sutura run has no fleet-log record to replay.

- **Recovered command for cirujano is `pnpm -r test`.**
  The step runs `pnpm run test`, whose script is `pnpm -r test`. Last-match
  `failingCommand` already preferred the nested script header when the
  header survived. This is existing semantics, and the command is equivalent.

- **Replay fingerprint assertions did not move.**
  Plan said: `case-lab/src/replay.test.ts:125` and
  `replay/replay-orchestrate.test.ts:142,166` would need new assertions.
  Found: both pass unchanged. The header survives in every recorded bundle, so
  the output is byte-identical.
  Chose: left them untouched.

- **B4 (`orchestrate.test.ts`) inverted, but not because the scan left the step.**
  Found: the captured A3 log carries an in-step `$ pnpm -r test` at line 6
  that the 20 KB byte cap used to drop. A first-64-lines scan would also find
  it.
  Chose: assert the live-crash log now recovers `pnpm -r test`, and keep the
  fail-closed premise by stripping every command header.

- **Verification gaps.** `pnpm run ci:local` stops at
  `placebo smoke:offline`, and 34 `placebo` tests fail locally. The same
  failure reproduces on unchanged `develop`:
  `ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE` from corepack's pnpm
  12.4.2 in temp fixture installs. CI on `develop` is green, and no
  `placebo` file changed. Every other `ci:local` step was run separately.
