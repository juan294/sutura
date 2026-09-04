# Case Lab replay bundles

A file `<case-id>.json` in this directory is a complete `sutura-replay-v1`
bundle captured by the `Case Lab` workflow with `capture-replay: 'true'`. The
Case Lab replays it through `replayBundle` from `@sutura/core` without
credentials, network, or sandbox access, and labels the result
`Deterministic replay`.

Rules:

- The bundle's `actionSha` must equal `actionSha` in `../release.json`. A
  bundle from another Sutura commit is refused, because recorded request
  shapes drift between commits.
- A partial bundle (`completeness.complete: false`) is refused.
- The replayed outcome must equal the recorded outcome.
- Bundles are written with `flag: 'wx'` by `case-lab capture-replay` and are
  never overwritten. Replace a bundle by deleting it in a reviewed commit.

When no bundle exists for a case, the Case Lab falls back to the committed
live benchmark result in `docs/demo/placebo-v0.2-live-2026-09.json`, labeled
`Recorded live result`.
