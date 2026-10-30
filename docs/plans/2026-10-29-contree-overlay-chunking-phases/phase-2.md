# Phase 2: Failure context, documentation and bundle

Parent: [ConTree repository overlay chunking](../2026-10-29-contree-overlay-chunking.md). Dependency: accepted Phase 1. Local only; no push, dispatch, release, tag or fleet change.

## Outcome

A chunk failure names its chunk and size while keeping every typed field of the original error. The evaluation guide states the observed overlay boundary, the chunking behavior and that hosted recovery is not yet demonstrated. The committed Action bundle matches the source. All local gates pass.

## Implementation

1. **Error context (D6).** In the Phase 1 chunk loop, catch a `ContreeError` from a chunk when the plan has more than one chunk and rethrow a new `ContreeError` with the suffix `(repository overlay chunk K of N, B archive bytes)` and the original `status`, `body` and metadata (`code`, `stage`, `details`, `providerTerminal`). Single-chunk errors pass through untouched.
2. **Terminal artifact check.** Confirm `packages/action/src/terminal-failure.ts` keeps `errorMessage`, `failure.code` and `failure.stage` for a chunked failure and stay `sutura-terminal-failure-v2`. Add a test using the sanitized ENOSPC fixture (`packages/core/src/executor/__fixtures__/operation-provider-disk-exhausted.json`) on chunk 2 of 3.
3. **Documentation.** Add a limitation entry to `docs/evaluation/README.md` and a short note to the research hand-off: the observed boundary (132,956,160 to 134,963,200 bytes), the 64 MiB chunk budget, the unresolved provider limit, the 180-day retention of intermediate checkpoint images, and that no live run has verified chunked overlays. Keep private repository names, run IDs and paths out of the text.
4. **Bundle.** Rebuild `packages/action/dist/index.cjs` with the repository's build command and commit it in the same commit as the `packages/core` source change (`.claude/rules/ci-parity.md`). Run `pnpm run verify:bundle`.
5. **Gates.** Run the full local gates listed below, record each outcome and the tested commit, and leave the branch unpushed.

```text
@ withChunkContext(error, k, n, bytes) -> ContreeError
pre: n > 1; error is ContreeError
do:
  1. build message = error.message + " (repository overlay chunk k of n, bytes bytes)"
  2. copy status, body, code, stage, details, providerTerminal
  3. return new ContreeError
risk: dropping providerTerminal breaks cancellation bookkeeping
```

## Files and work units

- **A, docs [batch-eligible]:** `docs/evaluation/README.md` only.
- **B, error context and tests:** `packages/core/src/executor/contree.ts`, `contree.test.ts` (or the Phase 1 chunk test file), `packages/action/src/terminal-failure.test.ts`.
- **Integration owner:** rebuilt `packages/action/dist/index.cjs`, gate runs, final handoff. A and B touch disjoint files; the bundle depends on B.

## Behavioral oracles

O-ERROR from the parent plan, plus: the chunk suffix never appears on a single-chunk failure; the existing `tags positive provider ENOSPC` test (`contree.test.ts:256`) passes unchanged; the terminal-failure artifact for a chunked ENOSPC keeps `schemaVersion: 'sutura-terminal-failure-v2'`.

## Automated verification

Run sequentially, recording the exit code and tested commit for each:

```sh
pnpm --filter @sutura/core exec vitest run src/executor src/report
pnpm --filter @sutura/action exec vitest run src/terminal-failure.test.ts src/acceptance.test.ts
pnpm run typecheck
pnpm run lint
pnpm --filter @sutura/core build
pnpm run verify:bundle
pnpm run ci:fast
pnpm run ci:local
pnpm --filter @sutura/core test:coverage
pnpm --filter @sutura/action test:coverage
```

`ci:local` takes about 12 minutes. A known local toolchain drift (the placebo corepack failure described in project memory) is verified on clean `develop` and reported separately; it does not excuse other failures.

## Manual acceptance and handoff

No manual step is required. Independent review checks: typed fields preserved on rethrow, the documentation states only demonstrated facts, the bundle diff corresponds to the source diff, and no private identifier entered a tracked file (run the repository's secret scan on the diff). Stop at this gate and report to the owner: candidate commit, gate outcomes, the statement that hosted effectiveness is unproven, and the separate decisions the owner holds (push to `develop`, release timing relative to the 2026-10-30 deadline, a live verification dispatch, fleet re-pin, re-enabling `SUTURA_AUTO_REPAIR` on Spoken Letter).
