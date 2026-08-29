# CI failure retrospective: every red run, 2026-08-27 to 2026-08-29

Date: 2026-08-29
Scope: all 29 failed GitHub Actions runs in `juan294/sutura` since the repository
was created (2026-08-27T04:46Z). Source of truth:
`gh run list --limit 300 --status failure` on 2026-08-29 ~22:40 UTC.

Every claim below is labeled VERIFIED (read in the run log, commit, or
reproduced locally this session) or INFERRED (derived from commit messages
or plan notes).

## Headline

| Class | Runs | What it means |
| --- | --- | --- |
| A. Regressions we pushed to `develop` | 4 | Our own CI hygiene failed. 3 of 4 were reproducible locally in under two minutes. |
| B. Sutura crashed while repairing our real failures | 4 | 0 of 4 real failures were even diagnosed. Every crash was a fail-closed guard tripping on legitimate input *before* any reasoning ran. |
| C. Intentionally broken dogfood branches | 21 | The break was deliberate. Sutura fixed **1 of 22** attempts (4.5%). The injected bug was a one-line arithmetic assertion. |

The 08-29 dogfood loop alone ran 16 CI runs and 16 Sutura runs between
06:36Z and 18:49Z with one fix commit pushed after each `gave-up`. That loop
*is* the ping-pong pattern Sutura exists to eliminate, performed by us,
against ourselves, using GitHub as the test harness.

## A. Regressions pushed to `develop`

### A1. 33169026068 — 2026-08-28 11:55Z — `6242256 release: prepare Sutura v0.1.1`

- VERIFIED failure: `packages/cli/src/args.test.ts:78` "keeps the CLI version
  aligned with its package" — `expected '0.1.0' to be '0.1.1'`; and
  `packages/action/src/metadata.test.ts` "publishes equivalent metadata at
  the repository root".
- VERIFIED root cause: the release commit bumped 8 `package.json`/`action.yml`
  files by hand and missed the `VERSION` constant in `packages/cli/src/args.ts`
  and the root/package `action.yml` pair. The version lived in ~10 places with
  no single source of truth.
- Locally reproducible: yes, `pnpm --filter sutura test` (< 1 minute).
- Was it run locally: no. `.husky/pre-commit` runs only typecheck + lint; no
  pre-push hook existed.
- Fixed: `0d3b087` at 12:24Z (29 minutes later), bundled with an unrelated
  Action feature.
- Lesson: a release commit is the highest-stakes commit in the repo and got the
  least verification. Version must be asserted from one place (the
  `test:release-contracts` gate now does this for 0.2.0), and the full test
  suite must run before any release-bearing push.

### A2. 33238191746 — 2026-08-29 06:19Z — `6eb1e5e merge: integrate Phase 11 release readiness`

- VERIFIED failure: `packages/cli/src/bundle.test.ts:10` `beforeAll` —
  `Hook timed out in 10000ms`.
- VERIFIED root cause: `d388493` (04:22Z) changed `packages/cli` `build` to
  also build `@sutura/evaluation` before bundling. The `beforeAll` in
  `bundle.test.ts` spawns `pnpm run build` under Vitest's default 10 s hook
  timeout. On the GitHub `ubuntu-latest` runner that build now exceeds 10 s;
  on the local Apple Silicon machine it does not, so the suite passed locally.
- Locally reproducible: **no** — this is an environment-parity failure.
- Lesson: any test that spawns a build or install must declare an explicit,
  generous timeout (we now use 30 s; 60 s is safer). When a commit changes the
  cost of a build, the tests that run that build must be re-examined.

### A3. 33239848825 — 2026-08-29 07:01Z — `146cbc7 fix: align repair tools with Token Factory`

- VERIFIED failure: identical to A2, same file, same line, same 10000 ms.
- VERIFIED root cause: A2 was still red. `146cbc7` was pushed 42 minutes later
  to address a *dogfood* problem (C, run 1) without fixing the red `develop`
  build first. This is the exact "push and see what comes back" behaviour the
  product forbids.
- Fixed: `58b4443` at 09:06Z raised the hook timeout to 30 s
  (`packages/cli/src/bundle.test.ts:14`), 2 h 47 m after A2 first failed.
- Lesson: **never push on red.** A red `develop` blocks every other push until
  it is green; the fix for the red run is the only thing that may be pushed.

### A4. 33268672246 — 2026-08-29 18:35Z — `54def5c fix: use model-specific thinking control`

- VERIFIED failure: `scripts/test-candidate-install.mjs:39`
  `Candidate package or Action source differs from the candidate commit`,
  raised by `pnpm run test:package` — the **last** CI step, after 613 s of
  tests had already passed.
- VERIFIED root cause (reproduced this session in a worktree at `54def5c`:
  `pnpm install && pnpm run build` → `git status` shows
  `M packages/action/dist/index.cjs`): the commit changed
  `packages/core/src/llm/nebius.ts` but did not rebuild the committed Action
  bundle. Every preceding commit that day (`3e14fc8`, `9648815`, …) *did*
  include `dist/index.cjs`; the discipline was manual and was skipped once.
- Locally reproducible: yes, ~60 s (`pnpm run build && git diff --exit-code --
  packages/action/dist/index.cjs`).
- Fixed: `d0a3ba1 build: refresh action bundle` at 20:15Z, 3 h 40 m later.
- Two compounding defects:
  1. CI ordering put the 11 s check after the 613 s check, so the signal
     arrived 11 minutes late.
  2. The error message names neither the file nor the reason; a reader has to
     open the script to learn it is a stale bundle. For a product whose whole
     value is diagnosis, our own gates must name the cause.

## B. Sutura crashed on our real failures (0 of 4 diagnosed)

Each of these ran `.github/workflows/sutura.yml` against one of the runs above.
All four terminated inside the Action's input handling; none reached triage.

| Run | Triggered by | VERIFIED terminal error | Root cause | Fix |
| --- | --- | --- | --- | --- |
| 33106159849 (08-27 18:58Z) | dogfood C run 2 | `JSON repair failed: Reply does not contain a JSON object` | Nemotron reply for the diagnosis prompt was not JSON and the one-shot repair could not recover it | `#20 bound structured repair reasoning` |
| 33169087281 (08-28 11:56Z) | A1 | `Workflow run metadata does not match the action event` | `ALLOWED_RUN_EVENTS` was `{pull_request, workflow_dispatch}`; a failing **push** to `develop` was rejected as invalid input (`git show 0d3b087 -- packages/action/src/github.ts`) | `0d3b087` |
| 33238255332 (08-29 06:21Z) | A2 | `Runtime evidence exceeds 500 entries; set runtime in .sutura.json` (`packages/core/src/runtime/detect.ts:59`) | After the Python corpus merge the repository held > 500 runtime-evidence files; the detector refused instead of ranking | `906eb10` added `.sutura.json` `runtime: node` |
| 33239910020 (08-29 07:02Z) | A3 | `Failed-step logs do not contain an observed failing command` | The failed-step log was truncated to its last N lines, which dropped the command line at the top (`git show 58b4443 -- packages/action/src/github.ts`) | `58b4443` |

Pattern: three of four (B2, B3, B4) are **guards written from imagination,
not from captured real inputs**. A failing push event, a polyglot monorepo,
and a long test log are all ordinary inputs any customer repository will
produce on day one. Fail-closed is correct; failing closed on *normal* input
is a bug, and each one costs the developer their one and only first
impression.

## C. Dogfood: 22 attempts, 1 fix

The injected failure in every attempt was a single declared arithmetic
assertion (a "3-line source", per the plan notes). This is the easiest case
the product will ever see.

### 08-27 `demo/dogfood-typecheck` (5 attempts, 1 fixed)

| Attempt | CI run | Sutura run | Outcome (VERIFIED from log) | Fix pushed next |
| --- | --- | --- | --- | --- |
| 1 | 33104093797 | 33104247197 | gave-up | `#19 resolve monorepo diagnostic paths` |
| 2 | 33106066503 | 33106159849 | **crash** (B1) | `#20 bound structured repair reasoning` |
| 3 | 33108254241 | 33108388525 | gave-up | `#21 run observed package managers via Corepack` |
| 4 | 33111238494 | 33111276693 | gave-up | `#22 ground generated repairs in exact source` |
| 5 | 33118205130 | 33118310653 | **fixed** → branch `sutura/fix-33118205130`, CI 33118889191 green | — |

### 08-29 `dogfood/sutura-v02-live-N` (16 attempts, 0 fixed)

All 16 Sutura runs reported `outcome=gave-up` (VERIFIED from each run's
`Sutura outcome:` line). Reasons per attempt — 1–9 INFERRED from the fix
commit that followed each; 10–16 VERIFIED from
`docs/plans/2026-08-29-live-repair-reliability-notes.md`:

| # | CI run | Reason it gave up | Fix commit | Class |
| --- | --- | --- | --- | --- |
| 1 | 33238860852 | repair tool definitions rejected by Token Factory | `146cbc7` | provider contract |
| 2 | 33240572371 | `tool_choice` contract mismatch | `6e8c1d9` | provider contract |
| 3 | 33241358531 | model-turn budget exhausted | `0fb71bc` | budget |
| 4 | 33242204485 | ESM `.js` import not resolved to `.ts` source | `06950a2` | path resolution |
| 5 | 33243759945 | monorepo diagnostic paths not resolved (**recurrence of #19 from 08-27**) | `9f4bed8` | path resolution |
| 6 | 33244884596 | dynamically read sources dropped | `17a0f13` | path resolution |
| 7 | 33246383946 | trusted repair test could not restore | `d642bdf` | sandbox |
| 8 | 33247360873 | accepted patch never verified | `f0fd17a` | verification |
| 9 | 33248388988 | control path redesigned (`3edff2c`, `e9e38b6`) | — | architecture |
| 10 | 33252323239 | ANSI-coloured Vitest output + `❯` marker broke pnpm workspace source reconstruction | `fca0535` | log parsing |
| 11 | 33254012677 | four schema-valid replies failed stricter local bounds; two failed exact `old`-text copy contract | `d23da3d` | schema |
| 12 | 33256572917 | five replies hit the 8,192-token completion ceiling → invalid JSON | `c7f3125` | provider contract |
| 13 | 33258931783 | six of seven replies selected ranges outside the 3-line source | `1f7a768` | schema |
| 14 | 33261605582 | six invalid ranges; two applied patches failed the trusted test | `9648815` | schema |
| 15 | 33265268595 | three strict-schema failures, one completion-limit terminal | `3e14fc8` | provider contract |
| 16 | 33268037618 | all four branches HTTP 400: endpoint rejected `reasoning_effort: none` | `54def5c` (→ A4) | provider contract |

Cost of the loop (VERIFIED from run 33240626773 footer): ~$0.56 sandbox +
~$0.001 inference per attempt, ~12 minutes of CI per attempt, and the whole
working day.

## What we missed — root causes behind the root causes

1. **No local mirror of CI.** `ci.yml` runs 10 steps; the only local gate was
   `typecheck && lint` at commit time. A1 and A4 (and A3 as a repeat) were
   catchable locally in < 2 minutes.
2. **Pushing on red.** A3 was pushed while A2 was red, carrying the identical
   defect.
3. **Environment parity assumed, not measured.** A2 used a default timeout
   tuned to a fast laptop.
4. **Generated artifacts committed without an early freshness gate.** A4's
   check existed but ran last and spoke in riddles.
5. **Guards written without real fixtures.** B2, B3, B4 and C10 each refused
   an ordinary input. The fix in every case was to capture the real input
   shape as a replay fixture — which is what should have happened *before*
   the guard was written.
6. **Provider contract learned by production trial.** C1, C2, C3, C12, C15,
   C16 are all facts about Token Factory's API (tool schema, `tool_choice`,
   completion ceilings, `reasoning_effort` rejection) discoverable with one
   direct request from a laptop, or from the provider docs via Tavily. Six
   full CI + Sutura cycles were spent discovering them one at a time. The
   provider-contract canary added in `82aabdf` is the right control; it
   needed to exist on 08-27.
7. **Recurrence without a regression fixture.** Monorepo path resolution was
   "fixed" on 08-27 (`#19`) and again on 08-29 (`9f4bed8`). The first fix
   had no fixture built from the real log, so it did not hold.
8. **GitHub used as the debugger.** From run 1 to run 9 no local replay of the
   captured case file preceded the next push. The plan notes show that from
   run 10 onward the team started adding "the exact raw log shape to
   production-path replay before another candidate" — the right discipline,
   adopted nine cycles late.

## Prevention adopted with this retrospective

Repository hygiene (implemented in the same change set):

- `pnpm run ci:local` — runs the exact `ci.yml` step list in the same order.
- `pnpm run verify:bundle` — rebuilds and fails with the file name if
  `packages/action/dist/index.cjs` is stale.
- `.husky/pre-push` — runs `pnpm run ci:fast`, the deterministic gate
  (release contracts, README test, typecheck, lint, build, bundle freshness,
  CLI and Action unit tests; ~25 s locally). It would have stopped A1, A3 and
  A4 before they left the laptop. `test:package` stays in `ci:local` only
  because it requires a clean tree identical to `HEAD`.
- `ci.yml` — `build` and the bundle-freshness diff now run *before*
  `pnpm run test`, so a stale bundle fails in ~1 minute instead of ~11.
- `scripts/test-candidate-install.mjs` — the stale-source error now names the
  differing paths.
- `.claude/rules/ci-parity.md` — never push on red; run the gate before push;
  explicit timeouts for subprocess-spawning tests; rebuild the bundle whenever
  `packages/core` or `packages/action` source changes.

Product discipline (to be planned, not yet implemented):

- Every fail-closed guard in `packages/action` and `packages/core` must carry
  at least one fixture captured from a real CI log or real API response, not a
  hand-written one. Audit the existing guards against this rule.
- No dogfood run may be dispatched until (a) the provider-contract canary is
  green on the exact candidate SHA and (b) the previous `gave-up` case file
  has been replayed locally and passes.
- Every `gave-up` must produce a named replay test before the next candidate
  is pushed (the notes show this was adopted from run 10; make it a gate).
- The single-assertion dogfood fixture must pass 10 of 10 consecutive live
  runs before any harder fixture or any external promotion.
