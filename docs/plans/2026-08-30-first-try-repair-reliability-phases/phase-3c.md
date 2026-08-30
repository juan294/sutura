# Phase 3c: Guard tests — engine, budget, policy, runtime, config + `guards:verify` `[batch-eligible]`

## Goal

Every remaining guard is reached by a test, and `scripts/guards-verify.mjs`
makes the 337-of-337 property a CI gate that re-derives the count on every
run.

Baseline (VERIFIED 2026-08-30): engine/repair.ts + repair-attempt.ts 21/43,
budget/search/triage/flake 5/22, policy 8/14, runtime/detect 2/5,
runtime/python 7/16, config + trace 7/10, audit 4/9, security 1/2, classify
3/9, action main/input/acceptance 8/10. Target: 140/140 in this phase and
337/337 across 3a+3b+3c.

## Files

Add:

- `scripts/guards-verify.mjs` and `scripts/guards-verify.test.mjs`.
- `packages/core/src/runtime/__fixtures__/captured/…` — real `.sutura.json`
  + directory listings recorded from the dogfood-16 checkout (runtime
  detection is an input boundary).
- Tests for each unreached guard in: `engine/repair.test.ts`,
  `repair-attempt.test.ts`, `repair-budget.test.ts`, `search.test.ts`,
  `triage.test.ts`, `flake-confidence.test.ts`, `policy/schema.test.ts`,
  `policy/load.test.ts`, `runtime/detect.test.ts`, `runtime/python.test.ts`,
  `config.test.ts`, `trace/recorder.test.ts`, `audit-only.test.ts`,
  `audit/adjudicate.test.ts` (new), `security/external-text.test.ts`,
  `diagnose/classify.test.ts`, `packages/action/src/main.test.ts`,
  `input.test.ts`.

Modify:

- root `package.json` — `devDependencies['@vitest/coverage-v8']` pinned to
  the installed vitest major (4.1.x); scripts `guards:verify`; add
  `scripts/guards-verify.test.mjs` to `test:release-contracts`.
- `packages/core/package.json`, `packages/action/package.json` — `test:coverage`
  scripts: `vitest run --coverage.enabled --coverage.provider=v8 --coverage.reporter=json --coverage.reportsDirectory=<dir>`.
- `.github/workflows/ci.yml` — add `- run: pnpm run guards:verify` after
  `pnpm run test`; `scripts/release-workflow.test.mjs` asserts it.

## Implementation

1. `guards-verify.mjs`:

   ```js
   // 1. scan: for each file in packages/{action,core}/src/**/*.ts excluding *.test.ts,
   //    collect {file, line} for every /^\s*throw new \w+Error?\(/ and /core\.setFailed\(/
   //    (skip lines inside a `// guards-verify: not-a-guard` marker comment — none expected).
   // 2. run: execFileSync('pnpm', ['--filter','@sutura/core','--filter','@sutura/action','run','test:coverage'])
   // 3. read coverage-final.json from both report directories
   // 4. for each guard: hits = lineCoverage[file][line]; unhit if hits === 0 or undefined
   // 5. print `guards: <hit>/<total>`; list every unhit file:line; exit 1 if any
   ```

   Scan count is printed, never hard-coded; the test file asserts the scanner
   finds the known guard at `packages/core/src/llm/json.ts:74` and that a
   synthetic coverage map with one zero-hit line makes the script exit 1.

2. Per-guard tests: the same checklist procedure as 3a/3b. Notable inputs:
   - `repair-budget.ts` modelTurns / diffBytes exhaustion: a budget with
     `modelTurns: 1` and a second reservation; a 65,537-byte diff.
   - `runtime/detect.ts` three unreached guards: recorded directory listing
     from the captured checkout with a symlinked `.sutura.json`, a
     `.sutura.json` above `MAX_POLICY_BYTES`, and conflicting evidence
     without a policy.
   - `runtime/python.ts` TOCTOU and encoding guards: temp directory whose
     `pyproject.toml` is replaced between stat and read (inject the fs
     dependency), and a UTF-16 file.
   - `audit/adjudicate.ts` reply schema: mutate the captured Ultra reply once
     Phase 5 produces it; until then, the existing inline shape with each
     required field removed (marked pending in the manifest like ConTree).
   - `action/main.ts:29,34`: `mapActionInputs` with missing ConTree config and
     a malformed `GITHUB_RUN_ID`.

3. Replace the three interim checklist tests (`guards-3a/3b/3c.test.ts`) with
   `guards:verify` once all three phases are merged; delete them in this
   phase's final commit only if 3a and 3b have already landed, otherwise in
   the merge commit that follows the batch.

## Automated success criteria

- `pnpm run guards:verify` prints `guards: N/N` with N re-derived by the scan
  and exits 0 on `develop` after 3a, 3b, and 3c merge.
- `guards-verify.test.mjs` passes (scanner finds `json.ts:74`; zero-hit
  synthetic map exits 1; the `not-a-guard` marker is honored).
- `release-workflow.test.mjs` asserts `ci.yml` runs `guards:verify` after
  `pnpm run test`.
- Coverage run adds ≤ 90 s to core + action test time (measured and recorded;
  Placebo is excluded from coverage).
- `pnpm run ci:local` passes.

## Manual success criteria

None.

## Exit evidence

Record `guards: N/N`, the coverage run duration, and the list of guards
deleted as structurally unreachable across 3a/3b/3c.
