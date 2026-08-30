<!-- contract:allow-emoji -->
<!-- The Vitest reporter glyph U+276F is quoted verbatim: the log-parsing finding depends on the exact byte. -->
# Phase 2: Historical capture, bundle contract, `sutura replay`, captured-fixture manifest

## Goal

Turn every historical red run into a captured fixture, make any bundle
replayable offline through the real orchestrator, and make "captured, not
hand-written" a machine-checked property of boundary tests.

## Files

Add:

- `scripts/capture-run.mjs` — `node scripts/capture-run.mjs <ci-run-id> [--sutura-run <id>] --out <dir>`.
- `scripts/capture-run.test.mjs` — node:test, injected `gh api` function.
- `scripts/captured-fixtures.test.mjs` — the contract test; wired into
  `test:release-contracts` and a new `test:captured-fixtures` script.
- `packages/core/src/replay/replay-executor.ts` — `RecordedExecutor`.
- `packages/core/src/replay/replay-fetch.ts` — `replayFetch(bundle, boundary)`.
- `packages/core/src/replay/replay-orchestrate.ts` — `replayBundle(bundle, deps)`.
- `packages/core/src/replay/*.test.ts`.
- `packages/action/src/replay-github.ts` — add `replayingGitHubApi(bundle)`.
- `packages/cli/src/replay.ts`, `replay.test.ts`.
- `packages/action/src/__fixtures__/captured/<runId>/bundle.json` for every
  historical run (GitHub half only), plus one
  `packages/action/src/__fixtures__/captured/manifest.json`.
- `packages/core/src/__fixtures__/captured/manifest.json` (provider and
  sandbox halves land here in Phases 3b and 5).

Modify:

- `packages/cli/src/args.ts:6-16` — add
  `sutura replay --bundle <file> --format json [--runtime <auto|node|python>]`
  to `USAGE`; add `parseReplay`; extend the `Arguments` union.
- `packages/cli/src/cli.ts:100-150` — dispatch `replay` like `audit`.
- `packages/core/src/engine/repair-provider-replay.test.ts` and
  `packages/core/src/orchestrate.test.ts:552,1079,1152` — each "replays live run
  N" test reads its GitHub half (job log, run metadata) from the captured
  fixture for that run ID instead of the inline literal; the provider reply
  stays inline until a provider capture exists (Phase 3b / Phase 5).
- `scripts/provider-contract-canary.test.mjs:33-47` — the 1..16 coverage
  assertion additionally requires each test to reference a captured run ID
  present in the manifest.
- `package.json` — `test:captured-fixtures`, and add
  `scripts/capture-run.test.mjs` + `scripts/captured-fixtures.test.mjs` to
  `test:release-contracts`.
- `README.md` — document `sutura replay` and the capture script.

## Implementation

1. Manifest format (`__fixtures__/captured/manifest.json`), typed in
   `packages/core/src/replay/manifest.ts` and validated by the contract test:

   ```ts
   export const CAPTURED_FIXTURES_SCHEMA_VERSION = 'sutura-captured-fixtures-v1' as const;

   export interface CapturedFixtureEntry {
     runId: string;                       // GitHub CI run id, e.g. '33239848825'
     kind: 'ci-failure' | 'ci-success' | 'provider-capture' | 'tavily-capture'
         | 'sandbox-capture' | 'dogfood-gave-up';
     headSha: string;                     // exact 40-hex commit the run executed
     capturedAt: string;                  // ISO-8601 UTC
     source: string;                      // https://github.com/juan294/sutura/actions/runs/<runId>
                                          // or the capture commit SHA when capturedBy === 'local'
     capturedBy: 'workflow' | 'local';
     bundleSha256: string;                // sha256 of bundle.json bytes
     boundaries: Array<'github' | 'nebius' | 'tavily' | 'contree' | 'repository'>;
     notes: string;                       // e.g. 'A3: bundle.test.ts hook timeout; Sutura crashed: no observed failing command'
   }

   export interface CapturedFixturesManifest {
     schemaVersion: typeof CAPTURED_FIXTURES_SCHEMA_VERSION;
     entries: CapturedFixtureEntry[];
   }
   ```

   `source` must satisfy `publicGitHubUrl` (`scripts/evidence-contract.mjs:43`);
   `headSha` must satisfy `exactSha`; `bundleSha256` must equal the SHA-256 of
   the file bytes.

2. `capture-run.mjs`: for a CI run ID, call `gh api` for
   `actions/runs/<id>`, `actions/runs/<id>/jobs?filter=latest&per_page=100`,
   and `actions/jobs/<jobId>/logs` for each failed job, and
   `repos/…/pulls?head=` / `commits/<sha>/pulls` to mirror what
   `GitHubAdapter.getFailingRun` would have asked. Emit a `ReplayBundle` whose
   `github` array contains those calls in the order `getFailingRun` performs
   them (`github.ts` resolution order: `getWorkflowRun`, then
   `listPullRequestsForCommit`/`getPullRequest` or `getRefSha`, then
   `listJobsForWorkflowRun`, then `downloadJobLogs` per failed job). If
   `--sutura-run` is given and that run has a `sutura-replay-<id>.json`
   artifact, download it and merge its `http` array instead. Write
   `bundle.json` and append a manifest entry.

3. Capture the 29 historical runs listed in
   `docs/research/2026-08-29-ci-failure-retrospective.md` (A1–A4, B1–B4 via
   their triggering CI runs, C 08-27 ×5, C 08-29 ×16) plus the one success
   `33118205130`. Commit them. These are real GitHub payloads and raw logs
   including ANSI escapes and the pnpm workspace prefixes.

4. `replayFetch(bundle, boundary)`: returns a `fetch`-shaped function that
   pops the next recorded exchange for that boundary, asserts the request
   `method`, `url`, and canonical-JSON `body` equal the recorded request (fail
   closed with `ReplayMismatchError` naming the sequence number and the first
   differing JSON path), and returns the recorded response. Transport errors
   replay as rejections.

5. `RecordedExecutor implements Executor`: built from the `contree` exchanges;
   maps each `run`/`snapshot`/`import` call to the recorded operation by
   sequence and returns the recorded terminal (exit, stdout, stderr, metrics).
   Reuses `InMemoryExecutor` (`packages/core/src/executor/memory.ts:42`)
   semantics for image ids. Where a bundle has no `contree` exchanges (all
   historical captures), `replayBundle` accepts an injected `Executor`
   (tests pass an `InMemoryExecutor` script), and `sutura replay` fails closed
   with "bundle has no sandbox recording; supply --executor-script".

6. `replayingGitHubApi(bundle)`: returns a `GitHubApi` whose read methods
   return recorded results in order and whose mutating methods record the
   requested mutation into an in-memory list and return the recorded ids.

7. `replayBundle(bundle, { executor?, artifact? })`: constructs
   `GitHubAdapter` over `replayingGitHubApi`, a `RepositoryPort` that serves
   source excerpts from the recorded `readSourceExcerpts` results (recorded in
   Phase 1 as GitHub-boundary-adjacent calls: add `RepositoryPort` recording
   to the recorder, `packages/action/src/repository.ts`), `createTokenFactoryClient`
   with `replayFetch(bundle,'nebius')`, `TavilyClient` with
   `replayFetch(bundle,'tavily')`, and runs `orchestrate()`. Returns
   `{ caseFile, mutations }`.

8. `sutura replay`: parse args; read bundle (≤ 16 MiB); validate schema;
   run `replayBundle`; print `JSON.stringify(caseFile)`; exit 1 if
   `caseFile.outcome !== bundle.outcome` with a message naming both.

9. Contract test `captured-fixtures.test.mjs`:
   - every manifest entry's file exists, hash matches, `source` is a public
     GitHub run URL for `juan294/sutura`, `headSha` is exact;
   - every file under `__fixtures__/captured/` is listed in a manifest;
   - no captured file matches `/Bearer\s+\S+|\bnb-[A-Za-z0-9]{8,}|\bghp_|\bgithub_pat_|\bsk-[A-Za-z0-9]{8,}/u`;
   - for each boundary test file (list enumerated in the script:
     `packages/action/src/github.test.ts`, `octokit.test.ts`,
     `repository.test.ts`, `packages/core/src/llm/nebius.test.ts`, `json.test.ts`,
     `executor/contree.test.ts`, `diagnose/tavily.test.ts`,
     `runtime/detect.test.ts`, `runtime/python.test.ts`,
     `orchestrate.test.ts`), the file imports from `__fixtures__/captured/`
     at least once (Phase 3 makes this true; until then the test lists the
     files it will require and skips with an explicit pending count that must
     reach zero by the end of Phase 3c).

## Automated success criteria

- `capture-run.test.mjs`: with an injected `gh api` returning the fixture
  payloads, the script writes a bundle whose `github` call order equals the
  adapter's resolution order and a manifest entry with a correct hash.
- All 30 historical captures exist, validate, and contain the real ANSI
  Vitest line for the 08-29 dogfood runs (`[31m❯[39m`) and the
  raw `Hook timed out in 10000ms` text for A2/A3.
- `replay-fetch.test.ts`: a request that differs from the recording by one
  JSON field fails with the field path; matching requests return the recorded
  body; sequence exhaustion fails closed.
- `replay-orchestrate.test.ts`: the captured bundle for `33239848825` (A3)
  replayed through `replayBundle` terminates with
  `OrchestrationError('Failed-step logs do not contain an observed failing command')`
  at the pre-fix Action behavior when the recorded log is truncated the way
  `github.ts:182-189` truncated it before `58b4443`, and reaches diagnosis on
  the current code. (This is the first captured-fixture guard test and the
  proof that B4 is now a permanent regression case.)
- The captured bundle for `33238191746` (A2) replayed on current code
  terminates with `RuntimeDetectionError` only when `.sutura.json` is removed
  from the recorded policy read, and proceeds when present (B3 regression).
- The captured bundle for `33169026068` (A1) replayed on the pre-`0d3b087`
  `ALLOWED_RUN_EVENTS` logic reproduces `github.ts:238`; on current code it
  resolves the direct run (B2 regression).
- `sutura replay --bundle <A3 bundle>` exits 0 and prints a `CaseFile` whose
  outcome equals the bundle's recorded outcome; with a tampered outcome it
  exits 1.
- `cli` `args.test.ts`: `replay` parses; unknown flags rejected; `--bundle`
  required.
- The 1..16 replay coverage assertion passes with run IDs bound to manifest
  entries.
- `test:captured-fixtures` passes; `test:release-contracts` count increases
  by the two new node:test files.

## Manual success criteria

None.

## Exit evidence

Record: number of captured bundles committed, the three B-class regression
tests' names, and the `sutura replay` command output for one bundle.
