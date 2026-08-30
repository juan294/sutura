# Phase 5: Live 10/10 streak and the gave-up loop

Supersedes `docs/plans/2026-08-29-live-repair-reliability-phases/phase-5.md`.

## Goal

Ten consecutive `fixed` outcomes on the canonical single-assertion fixture,
on one unchanged `packages/` tree, each with a green repair PR — recorded in
the ledger and reflected as `dogfood: passed` in release evidence. Any
`gave-up` on the way is converted into a committed captured fixture and a
named replay test before the next candidate.

## Preconditions

- Phases 3a, 3b, 3c, and 4 are merged and pushed to `develop`;
  `guards:verify` is dynamic `N/N`; `ci:local` and exact-SHA push CI are green.
- Execution stops here until the user gives the one-time live-spend
  authorization for the canary and one reserved-headroom streak attempt.
- `docs/demo/thumbnail/` remains untracked and untouched.

## Implementation

1. Push the exact candidate `develop` SHA; wait for CI `success`
   (`gh run watch`).
2. Dispatch the canary workflow on that SHA:
   `gh workflow run provider-contract-canary.yml --ref develop`; wait; the
   `provider-contract-canary` artifact must exist and bind to the SHA.
3. `pnpm run dogfood gate` — all conditions PASS.
4. `pnpm run dogfood streak --sha <sha> --authorize --cap-usd 10
   --initial-reserve-usd 1.50`.
5. On the first non-`fixed`:
   a. the script has stored `sutura-replay-<ci>.json` under
      `packages/action/src/__fixtures__/captured/<ci>/`; commit it with a
      manifest entry (`kind: 'dogfood-gave-up'`);
   b. write a test named `replays live run <suturaRunId>: <terminal class>`
      in the module that owns the terminal, loading the captured bundle
      through `replayBundle` and asserting the recorded outcome and the
      exact terminal message;
   c. if the bundle contains `contree` exchanges, also promote it to the
      ConTree captured fixture set and switch the pending ConTree guard tests
      from Phase 3b onto it (this closes the last `pending` boundary);
   d. diagnose from the replay locally — the fix must make the replay test
      pass with the recorded provider responses unchanged, or the test must
      assert a new provider request shape that the canary then proves live;
   e. run the complete local gate (`ci:fast`, `guards:verify`,
      `test:captured-fixtures`, `ci:local`, `/simplify`);
   f. push one candidate; return to step 1. The ledger keeps the failed
      entry; the streak restarts at attempt 1 on the new tree hash.
6. On streak completion: promote the scratch ledger to
   `docs/demo/dogfood-ledger.json`, regenerate the `.md`, and run the
   documented release-evidence status mode to show `dogfood: passed`; commit
   both canonical files once.
7. Preserve every remote `dogfood/streak-*` and `sutura/fix-*` branch.
8. Remove task-owned local worktrees; local `develop` equals
   `origin/develop`.

## Automated success criteria

- Ledger: 10 trailing entries with `outcome: 'fixed'`, one shared
  `packagesTreeHash`, ten distinct `ciRunId`/`suturaRunId`/`prUrl` values,
  total USD ≤ 10.00 for the streak.
- For each entry: repair commit parent equals the dogfood SHA; the diff
  touches only `packages/core/src/dogfood-add.ts`; the repair PR CI run is
  `success`.
- `scripts/release-evidence.mjs` reports `dogfood: passed` for the final
  `develop` SHA.
- Every `gave-up` ledger entry has a committed captured bundle and a test
  whose name contains its `suturaRunId`; `test:captured-fixtures` and
  `guards:verify` pass with zero `pending` boundaries.
- At least one bundle from the streak contains `nebius`, `tavily` (if
  grounding ran), and `contree` exchanges, and `sutura replay --bundle` on it
  reproduces `fixed` offline with the same candidate diff hash.

## Manual success criteria

- The user authorizes the streak once before step 4 and is told the total
  cost and streak length at the end (or at the halt).
- The user confirms remote branch preservation is acceptable for public
  evidence.

## Exit evidence

Report: candidate `develop` SHA, CI run URL, canary run URL, and for each of
the ten attempts the dogfood SHA, intentional CI URL, Sutura run URL, repair
PR URL, repair commit SHA, repair PR CI URL, sandbox USD, inference USD; the
ledger `resultHash`; the number of gave-ups encountered and the replay test
name created for each.

## Execution notes

- Provider-contract canary run `33312570131` on candidate
  `5e70a8bf1093173acd6142078b3015c4a25183b5` reached Nebius and failed before
  inference with HTTP 422, `Invalid parameter: extra_body`.
- The plan and prior replay assertions used OpenAI SDK notation for
  `extra_body`. Sutura sends raw JSON with `fetch`, so the corrected v2 wire
  contract sends `chat_template_kwargs` at the top level and omits both
  `extra_body` and `reasoning_effort`. A regression test names the failed
  canary run.
- Provider-contract canary run `33314221139` on candidate
  `f6af25a2bd1de124e40786d98c79860658858466` accepted the corrected request,
  completed inference, and returned the canonical repair, but omitted the
  optional `completion_tokens_details` object. The corrected v3 contract
  accepts an omitted breakdown as zero reasoning tokens while it still fails
  on an explicit nonzero value or a returned `<think>` prefix. A regression
  test names this canary run.
- Provider-contract canary run `33315587765` on candidate
  `aa43711daa5e8209f3983f3a55474e69dc99bb44` produced the exact expected
  applied diff and passed the trusted test, but the provider's raw replacement
  used a newline form that was not byte-identical to the source fixture. The
  repair engine intentionally normalizes line endings and the final newline.
  The corrected v4 contract hashes the canonical applied replacement after
  the exact diff check. A semantically different repair still fails that
  exact diff check. A regression test names this canary run.
- A linked-worktree push of candidate `5e96c741345b8152563503dbbc6fc36391d98198`
  exposed repository-local `GIT_DIR` and `GIT_WORK_TREE` variables to the
  pre-push test process. The foreign-repository fixture in `checks.test.ts`
  then targeted Sutura's shared Git directory, set the fixture identity, and
  created fixture commit `a531f696` on the local candidate branch. The hook
  now clears only the variables reported by `git rev-parse --local-env-vars`
  before it runs tests; the fixture also clears those variables itself and
  uses per-command identity flags instead of persistent Git configuration. A
  regression test executes the real hook with sentinel values for every local
  Git variable.
- The first streak start on candidate `3a17bccdd51365265d39e2a5eade4ac4f4432042`
  stopped before dispatch and before provider spend because the command wrapper
  trimmed the final newline from the fixture blob returned by `git show`.
  `break.diff` therefore did not apply to the otherwise matching source. The
  dogfood runner now requests untrimmed Git text when it materializes the two
  fixture files, and the real-path regression test requires that option.
- Dogfood CI run `33321106629` on candidate
  `e197173762ae98639afdc46a47801ef72544c5a6` failed only at the intended test
  command, before Sutura and before provider spend. GitHub's job API names an
  unnamed run step `Run pnpm run test`, while the validator and its mock used
  `pnpm run test`. The validator now requires the exact live API name, and the
  former mock-only name is rejected.
- The same CI run had already triggered Sutura run `33321172589`. It completed
  as `gave-up` after seven search nodes. The run spent USD 0.825674 on ConTree
  and USD 0.013137 on inference, for USD 0.838811 total. No repair PR was
  created. The check-run identity, HTML artifact, and replay artifact all bind
  to CI run `33321106629` and dogfood commit
  `1951701b95fd559335af3d3a7502e271c02befa2`.
- That first real replay exposed three capture-contract defects. A repository
  policy that fixes `runtime: node` did not suppress the 500-path runtime scan;
  the checkout error fallback was not schema-valid; and completeness required
  a Tavily exchange even when grounding was not applicable. Replay now records
  a schema-valid logical checkout on capture failure, skips runtime discovery
  when the captured policy fixes it, and treats Tavily as optional. Hash-only
  ConTree upload bodies are accepted because deterministic replay uses the
  recorded logical Executor stream, not diagnostic ConTree HTTP bodies.
- The recovered complete fixture is
  `packages/action/src/__fixtures__/captured/33321106629/bundle.json`. The named
  test `replays live run 33321172589: source-limit gave-up with seven search
  nodes` reproduces the terminal offline. The raw artifact hash remains in the
  scratch ledger; the recovered replay fixture has its own manifest hash.
- Replay showed that the final failure path arrived after eight earlier Vitest
  reporter paths had filled the source limit. New Action captures record the
  `latest` source-reference strategy. It gives line-bearing recent failures
  priority and reserves four of the eight source slots for dependency closure,
  so `packages/core/src/dogfood-add.test.ts` reaches
  `packages/core/src/dogfood-add.ts`. Bundles without the strategy keep the
  legacy `first` rule and remain deterministic.
- The consolidated local gate found that `guards-3a.test.ts` and
  `guards-3b.test.ts` still hard-coded interim file-and-line inventories.
  Phase 3c already replaced those inventories with the run-time AST and v8
  `guards:verify` gate. Both obsolete tests were deleted as Phase 3c required;
  guard coverage is no longer invalidated by unrelated line movement.
