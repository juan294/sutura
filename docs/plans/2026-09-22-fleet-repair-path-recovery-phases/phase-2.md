# Phase 2: Carry the failing command past truncation

Closes [#150](https://github.com/juan294/sutura/issues/150). Parks
[#136](https://github.com/juan294/sutura/issues/136).

Sequential — changes `packages/core` and rebuilds the committed Action bundle.

## Goal

Make the observed failing command survive log bounding, so the 17 fleet runs
that died at `orchestrate.ts:602` reach diagnosis instead.

## Current behaviour (VERIFIED)

Two independent causes, both required for a complete fix.

**Cause A — the byte cap (12 runs).** The adapter already retains the command
line: `adapter.ts:68-70` returns `[commandLine, ...matching.slice(-199)]` when
the step exceeds `FAILED_STEP_LINES`. `collectFailedLogs` then prepends
`` `[${jobName} / ${stepName}]` `` (`orchestrate.ts:294`). But
`classifyMechanically` re-bounds with `finalLines(log, MAX_LOG_LINES)` —
`maxLines: 200`, `maxCharacters: 20_000`, **`maxBytes: 20_000`**
(`classify.ts:12-14, 27-33, 94`) — and `boundedTail` cuts from the **front**
(`text/bounded-tail.ts:9-24`). For a verbose step the header is outside the
window, `failingCommand` returns `'unknown'` (`classify.ts:70`) and the gate at
`orchestrate.ts:599-605` throws.

Measured against the real gh-glance log (job `106473097216`, 877-line step):

| Input to `classifyMechanically` | `failingCmd` |
| --- | --- |
| full step log | `unknown` |
| header + last 399 lines | `unknown` |
| header + last 199 lines | `unknown` |
| header + last 49 lines | `npm run test:pty` |

The line cap is not binding — the byte cap is.

**Cause B — the marker miss (5 runs).** `failedStepLog` locates the header with
`` const groupMarker = `##[group]${step.name}` `` (`adapter.ts:61-63`). This
only matches when GitHub auto-named the step after its command. A step with a
custom display name never matches, `groupIndex` is `-1`, and line 68's
retention branch is skipped entirely — the header is never carried at all.

| Repo | Failed step name | `##[group]<step name>` occurrences | Cause |
| --- | --- | ---: | --- |
| gh-glance | `Run npm run test:pty` | 1 | A |
| cirujano / sutura | `Run pnpm run test` | 1 / 4 | A |
| layalga | `Run browser tests` | **0** | B |
| archy (private) | a custom display name | **0** | B |

Layalga's real header is `##[group]Run pnpm …`; archy's is likewise a
`##[group]Run pnpm …` command header.

**Do not use the step name as the command.** Layalga's display name
"Run browser tests" matches `failingCommand`'s
`^(?:Run|\$)\s+(\S.*)$` (`classify.ts:49`) and would yield the non-command
`browser tests` — a false positive Sutura would then try to reproduce.

**The same bug exists a third time.** `failureLog` (`heal.ts:1616-1621`) builds
`` `Run ${command}` `` + reproduction output and applies the identical
200/20 000/20 000 `boundedTail`, losing the header on verbose output.

## Change

### 1. A header-preserving bounded tail (`packages/core/src/text/bounded-tail.ts`)

```ts
/**
 * Bounded tail that keeps one head-anchored header line. The header is the
 * evidence of which command failed; it is always the first line of a step's
 * log, so an unmodified tail loses it exactly when the log is most verbose.
 * Total output still respects every bound: the header's cost is subtracted
 * from the budget before the tail is taken.
 */
export function boundedTailWithHeader(
  value: string,
  bounds: TailBounds,
  isHeader: (line: string) => boolean,
): string {
  const tail = boundedTail(value, bounds);
  if (tail.split(/\r?\n/).some(isHeader)) return tail;        // survived: change nothing
  const header = firstMatchingLine(value, isHeader, MAX_HEADER_SCAN_LINES);
  if (header === undefined) return tail;                       // no header: unchanged
  const carried = `${header}\n`;
  return carried + boundedTail(value, {
    maxLines: Math.max(1, bounds.maxLines - 1),
    maxCharacters: Math.max(0, bounds.maxCharacters - carried.length),
    maxBytes: Math.max(0, bounds.maxBytes - Buffer.byteLength(carried, 'utf8')),
  });
}
```

- `MAX_HEADER_SCAN_LINES` is a small constant (64): the scan must be bounded,
  and a step's header is line 1.
- When the header already survives, the function returns the current string
  **byte for byte** — this keeps every currently-passing replay body unchanged.

### 2. Use it where the header matters

- `classify.ts`: `finalLines` delegates to `boundedTailWithHeader` with the
  existing `githubLogPayload` + `^(?:Run|\$)\s+` predicate, so both
  `classifyMechanically` (`:94`) and the nano prompt (`:176, :185`) see the
  command. Keeping both in step matters: `classify.ts:225` compares the model's
  `failingCmd` against the mechanical one and caps confidence at 0.49 on
  mismatch, so a prompt without the header would penalise every repaired case.
- `heal.ts:1616-1621` `failureLog`: same helper, same predicate.
- `orchestrate.ts:282-296` `collectFailedLogs`: unchanged. The adapter and the
  classifier are the two ends that matter; leaving this untouched keeps the
  three direct tests at `orchestrate.test.ts:1253-1293` valid.

### 3. Fix the adapter's marker match (Cause B)

```ts
// adapter.ts:61-63 — today: `##[group]${step.name}`, which only matches
// GitHub's auto-generated "Run <cmd>" step names.
// Find the step's own command group instead: within the step's time window the
// first `##[group]Run ` line is this step's header, whatever the display name.
const groupIndex = matching.findIndex(({ line }) => GROUP_RUN_MARKER.test(line));
```

- Keep the existing behaviour when the step-name marker *does* match, so
  `adapter.captured.test.ts:83` (`replays A3 with the current command
  retention`) stays green: try the step-name marker first, fall back to the
  generic `##[group]Run ` match.
- The time-window filter at `adapter.ts:60` already restricts `matching` to this
  step, so a generic match cannot pick up a neighbouring step's header.

## Tests (executable artifacts)

Fixtures are captured from the real gated runs — see the plan's cause table.
Per `.claude/rules/ci-parity.md:17-20`, every guard needs a fixture from a real
CI log. There is no fleet bundle in the repo, so follow the `33239848825`
precedent: commit the trimmed job log as a fixture and build a synthetic
`FailingWorkflowRun` from it.

- `packages/core/src/github/__fixtures__/layalga-106300682270-named-step.log` —
  from monitor run `35590192744`, job `106300682270`, step `Run browser tests`
  (Cause B, marker absent).
- `packages/core/src/diagnose/__fixtures__/gh-glance-106473097216-verbose.log` —
  from monitor run `35644619036` (Cause A, 877-line step).
- `bounded-tail.test.ts` (new cases):
  - "returns the plain tail byte-for-byte when the header already survives" —
    guards every existing replay body.
  - "carries the header when the byte cap would drop it" — assert the result
    starts with the header, contains the tail's last line, and is
    ≤ 20 000 bytes and ≤ 200 lines.
  - "leaves a log with no header unchanged".
- `classify.test.ts`:
  - "recovers the failing command from a verbose step log" using the gh-glance
    fixture → `failingCmd === 'npm run test:pty'`.
  - `:249` (`bounds one huge log line by characters and UTF-8 bytes`) must stay
    green — the budget arithmetic above is what keeps it green.
  - `:210` (`fails closed when the CI log has no observed command`) must stay
    green — a log with no header anywhere still fails closed.
- `adapter.captured.test.ts` — named replay test for Cause B:
  "retains the command header for a step with a custom display name
  (layalga 35590192744)": build the step from the fixture, assert the retained
  log's first line is `##[group]Run pnpm …` and that the last line of the real
  tail is still present. **Verify it fails without the adapter change** by
  reverting locally once.
- Regression guard for the false positive: assert the recovered command for the
  layalga fixture is **not** `browser tests`.

### Replay fingerprints that must be updated (expected, not a surprise)

Changing the nano `messages[1].content` invalidates recorded exchanges. Per
design decision 4, **bundles are not edited**; the assertions move and carry a
comment citing this phase.

- `packages/case-lab/src/replay.test.ts:125` — asserts `mismatch.sequence === 16`
  and `mismatch.path === '$[1]'`. The nebius classify exchange is consumed
  earlier, so the mismatch will surface at the nebius body instead.
- `packages/core/src/replay/replay-orchestrate.test.ts:142` and `:166` — assert
  `error.sequence === 7`, `error.path === '$.method'`.
- `packages/core/src/orchestrate.test.ts:401` (`replays live crash B4`) — it
  synthetically strips line 1 to recreate a header-less log. Re-check its
  premise: with the fix, a log whose header was stripped **entirely** must still
  fail closed, so this test should still pass; if it inverts, that is a real
  signal the header scan is reaching outside the step.

Note for whoever runs this: three of the 29 captured bundles are complete
(`33321106629`, `33323765566`, `33325938237`); the other 26 are GitHub-half and
cannot be replayed.

## Verification

```bash
pnpm --filter @sutura/core exec vitest run src/text src/diagnose src/github src/orchestrate.test.ts
pnpm run test:captured-fixtures     # hash gate: no bundle may drift
pnpm -r test                        # every named replay test
pnpm run build && git status --porcelain packages/action/dist   # must be committed in the same commit
pnpm run ci:local                   # required: this touches packages/core
```

## Follow-up

- Update #150 with the two-cause split; it currently describes only Cause A.
- Comment on #136 that Phase 2 removed its trigger, and re-measure before
  building a configured fallback.

## Done when

All 17 previously-gated fixtures yield a correct command, the Cause B replay
test fails without the fix, `ci:local` is green, `dist/index.cjs` is rebuilt in
the same commit, and the changed replay assertions carry their explanation.
STOP.
