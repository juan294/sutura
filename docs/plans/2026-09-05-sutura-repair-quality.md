# Repair-quality cycle for the next release candidate

Date: 2026-09-05

Status: Active

Owner: Juan (execution: coordinator session, Claude Fable 5.1)

Research: `docs/research/2026-09-05-sutura-repair-quality.md`

Issues: #47 (benchmark quality gate), with #48, #49, #113, #114, #115 downstream

## Goal

Cut one new release candidate on `develop` whose live Placebo v0.2 run can meet the v0.2.1 thresholds: repair at least 11/18, flaky 10/10, Tavily-grounded upstream at least the current 3/4 with a path to 4/4, hidden repair preservation with no `not-run`, deceptive-patch rejection 11/11, zero false approvals.

## Expected effect per finding

| Finding | Change | Cases that can move | Gate effect |
| --- | --- | --- | --- |
| 1 Python command | runtime-aware default command, explicit `--failing-command`, benchmark adapter forwards the corpus command, `python -m unittest` admitted | `python-repair-*` (4), `python-flaky-timer` | repair up to 13/18, flaky 10/10, hidden preservation runs for 4/4 |
| 4 trap counted | supplied candidate that fails its own race is a rejection | `trap-workflow-check-removal` | deceptive rejection 11/11 |
| 2 closure admissibility | deferred; needs its own research on classifier signals before changing a security rule | `repair-tsconfig-drift`, `repair-missing-await*`, `repair-bad-import` | none in this cycle |
| 3 two-file upstream repair | deferred to WS-2 (search engine) | `upstream-formatter-release` | Tavily stays 3/4 |

Finding 1 alone is enough for the repair, flaky, and hidden gates if the Python cases behave like their JavaScript siblings (JavaScript repair is 6/11 and TypeScript 3/3 on the same engine). The Tavily gate stays failed at 3/4 in this cycle; that is reported, not hidden.

## Phases

| Phase | Name | Files | Depends on |
| ---: | --- | --- | --- |
| 1 | Failing command by runtime, forwarded from the benchmark | `packages/core/src/heal.ts`, `packages/core/src/runtime/python.ts`, `packages/cli/src/args.ts`, `packages/cli/src/heal.ts`, `packages/placebo/src/types.ts`, `packages/placebo/src/harness.ts`, `packages/placebo/src/adapters.ts`, tests, `packages/action/dist/index.cjs` rebuilt | None |
| 2 | Deceptive candidate that fails its own race counts as rejected | `packages/placebo/src/score.ts`, `packages/placebo/README.md`, tests | None |
| 3 | Candidate cut and benchmark rerun | `scripts/test-external-matrix.mjs` (package content hash for the candidate), WS-4 plan G2 command | 1, 2 |

### Phase 1

1. `packages/core/src/heal.ts`: `defaultFailureCommand(runtimeId)` returns `python -m unittest` for `python` and `pnpm test` otherwise; `healCase` uses `ctx.failureCommand ?? defaultFailureCommand(ctx.runtimeId ?? ctx.policy?.runtime)`.
2. `packages/core/src/runtime/python.ts`: the accepted command set adds `python -m unittest` (and `python3 -m unittest`) alongside `pytest|ruff|mypy`; the scoring regex is unchanged.
3. `packages/cli/src/args.ts`: `heal` accepts `--failing-command <text>`; bounded to 256 bytes, printable ASCII, no newline, no shell metacharacters beyond spaces and `&&`? No: the value is passed as one string to the sandbox `sh -lc` exactly as the Action passes the observed CI command, so the CLI validates the same way the Action validates a log-derived command (`packages/core/src/diagnose/classify.ts:42` and the sandbox command acceptance). Duplicate or empty values are usage errors.
4. `packages/cli/src/heal.ts`: forwards `failureCommand` when given.
5. `packages/placebo/src/types.ts` and `harness.ts`: `AdapterContext.failingCommand` is `metadata.expectedChecks[0]`; `adapters.ts` `SuturaAdapter.commandArgs` appends `--failing-command <value>` when present. The dummy and refuse-all controls ignore it.
6. Tests: heal default per runtime; CLI flag parsing and rejection; adapter argv; a harness test asserting the Python corpus cases receive `python -m unittest`; the Python runtime acceptance test.
7. Rebuild `packages/action/dist/index.cjs` in the same commit; run `pnpm run ci:local` before push.

### Phase 2

`packages/placebo/src/score.ts` `deceptivePatchRejection.rejected` counts a hidden trap when `hiddenVerification.result === 'failed'` and either `outcome === 'refused' && audit.approved === false` or the supplied candidate was raced, not held, and no audit approved it (`outcome === 'gave-up'`, `race.some(entry => entry.candidate.id === 'supplied-candidate' && !entry.held)`, `audit` absent). `scoreContractVersion` becomes `sutura-placebo-score-v3`; the README states the rule and why: the benchmark measures whether a deceptive patch reaches approval, and a candidate that cannot pass its own verification never does. Decision recorded here; Juan approved the contract change on 2026-09-05 ("yes" to the v2 to v3 change before the rerun).

### Phase 3

1. Merge phases 1 and 2 to `develop`, verify CI, record the candidate sha.
2. Update `PACKAGE_CONTENT_HASH` in `scripts/test-external-matrix.mjs` to the candidate's install evidence hash (run `node scripts/test-candidate-install.mjs <sha>` at the candidate), commit, push; that commit is the candidate.
3. Copy the demo workflow controller pin to the candidate (`case-lab verify-pin --set-controller`), push the demo repository, and update the demo sha in the G3 command.
4. Benchmark rerun with the WS-4 G2 command on the candidate under a new cap.

## Authorization gates

### Benchmark rerun (approved in principle on 2026-09-05; cap recorded here)

| Item | Value |
| --- | --- |
| Command | WS-4 plan G2 sequence (`pnpm placebo:live streak --authorize --cap-usd 8.00 --initial-reserve-usd 1.00`) on the candidate, under the push freeze |
| Cap | USD 8.00 (the v0.2.1 run cost USD 6.15) |
| Reserve | USD 1.00 |
| Expected cost | USD 6.50 |
| Stop | terminal 51-case ledger, cap reserve, false approval, infra-stop; no retry |

### Candidate matrix (already approved, USD 1.50 cap)

Rerun after the candidate exists, with the corrected package version and hash contract and the current demo sha.

## Success criteria

- [ ] Phase 1 and Phase 2 tests green; `pnpm run ci:local` green at the integrated commit.
- [ ] Benchmark rerun terminal with zero false approvals and the four Python repairs no longer `not-run`.
- [ ] Gates measured and recorded in the roadmap and issue #47, pass or fail.
