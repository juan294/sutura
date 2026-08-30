# Phase 3a: Guard tests — GitHub adapter, repository, orchestration `[batch-eligible]`

## Goal

Every guard in `packages/action/src/github.ts`, `octokit.ts`,
`repository.ts`, `packages/core/src/orchestrate.ts`, and `heal.ts` is reached
by a test, and every input-boundary guard among them is driven by a captured
fixture.

Baseline (VERIFIED 2026-08-30): github.ts 4/29 reached, octokit.ts 0/1,
repository.ts + source-window.ts 6/23, orchestrate.ts + heal.ts 4/23.
Target: 76/76.

## Files

Modify tests only (plus captured fixtures and exports):

- `packages/action/src/github.test.ts` — replace the `api()` stub defaults
  (`:7`) with a loader over captured bundles; add one `it` per unreached guard.
- `packages/action/src/octokit.test.ts` — new; drives `createGitHubApi` with
  a fake Octokit whose `downloadJobLogsForWorkflowRun` returns string,
  `ArrayBuffer`, `Uint8Array`, and an unsupported object.
- `packages/action/src/repository.test.ts` — add path-safety and policy-read
  bound cases using a real temp checkout built from a captured bundle's
  recorded `readSourceExcerpts` paths.
- `packages/core/src/orchestrate.test.ts` — add `validateRun` metadata cases,
  runtime-conflict cases, audited-candidate identity cases.
- `packages/core/src/heal.test.ts` — add the seven unreached guards.
- `packages/core/src/source-window.test.ts` — the one unreached guard.
- Captured fixtures: `packages/action/src/__fixtures__/captured/<runId>/…`
  (from Phase 2) plus manifest updates.

No production `.ts` changes except making a currently private helper
`export` where a guard is otherwise unreachable (record each in the notes).

## Implementation

1. Enumerate the exact guard list from
   `grep -nE "throw new " packages/action/src/{github,octokit,repository}.ts packages/core/src/{orchestrate,heal,source-window}.ts`
   and write it into the phase notes as the checklist.

2. For each unreached guard in `github.ts` (`:143`, `:145`, `:170`, `:175`,
   `:183`, `:221`, `:228`, `:238`, `:259`, `:262`, `:268`, `:276`, `:300`,
   `:319`, `:346`, `:363`, `:376`, `:398`, `:429`, `:462`, `:465`, `:470`,
   `:482`, `:485`, `:493`): start from a captured bundle's recorded
   `getWorkflowRun` / `listJobsForWorkflowRun` / `downloadJobLogs` results and
   mutate exactly the field the guard checks. Example:

   ```ts
   it('fails closed when the workflow run event is not one Sutura accepts (B2, run 33169026068)', async () => {
     const bundle = await capturedBundle('33169026068');
     const run = recordedResult(bundle, 'getWorkflowRun');
     const adapter = adapterOver({ ...bundle, github: replaceResult(bundle, 'getWorkflowRun', { ...run, event: 'schedule' }) });
     await expect(adapter.getFailingRun('33169026068')).rejects.toThrow('Workflow run metadata does not match the action event');
   });
   ```

   Shadowed guards (`:268` behind `:265`, `:300`) need inputs that satisfy the
   earlier check: same-repo PR with an invalid `headRef` for `:268`; a
   recorded run whose `pullRequests` is empty and whose `getRefSha` path is
   taken but returns no base for `:300` — if `:300` is proven structurally
   unreachable, delete the guard and document it instead of leaving dead
   fail-closed code.

3. `orchestrate.ts:509`: replay the captured A3 bundle (`33239848825`) with
   the failed-step log sliced to its last 200 lines exactly as
   `failedStepLog` did before `58b4443` (`git show 58b4443^:packages/action/src/github.ts`)
   and assert the guard; then assert the current adapter retains the command
   line. Both assertions in one named test `replays live crash B4`.

4. `orchestrate.ts:529` and `heal.ts:1242` (runtime conflict): captured A2
   bundle with `.sutura.json` `runtime: node` and a `runtimeId: 'python'`
   context.

5. `orchestrate.ts:643`/`:645` (audited candidate identity): drive
   `orchestrate` with a `ScriptedLlm` whose ultra verdict approves and a
   `raceK` result whose `selectedCandidate` is missing / duplicated.

6. `heal.ts:167` (stage evidence bound): an `InMemoryExecutor` script that
   emits `MAX_STAGE_EVIDENCE_ENTRIES + 1` operations.

7. `octokit.test.ts`: the four `responseText` shapes; the `'unsupported
   format'` case uses `{}`.

8. `repository.ts` guards: build a temp git checkout from the captured
   dogfood-16 bundle's recorded source paths; add a symlink, a path with
   `..`, a `.git` component, an oversized policy file, and a policy that is a
   directory. Use `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0=false`
   per the existing local-gate note.

## Automated success criteria

- `pnpm run guards:verify --scope action,orchestration` (Phase 3c adds the
  script; until it lands, the phase's own checklist test
  `packages/action/src/guards-3a.test.ts` asserts each listed `file:line`
  message string is thrown by at least one test in the phase, by grepping the
  vitest JSON reporter output for the message) reports 76/76.
- Every new test in `github.test.ts`, `octokit.test.ts`, `repository.test.ts`,
  and the B-class tests in `orchestrate.test.ts` imports from
  `__fixtures__/captured/` (checked by `scripts/captured-fixtures.test.mjs`).
- The three B-class regression tests from Phase 2 remain green.
- Action and core suites pass; `pnpm run ci:fast` passes.

## Manual success criteria

None.

## Exit evidence

Record the guard checklist with a test name beside every line, and any guard
deleted as structurally unreachable with its justification.
