<!-- contract:allow-emoji -->
<!-- The Vitest reporter glyph U+276F is quoted verbatim: the log-parsing finding depends on the exact byte. -->
# Phase 2: Historical capture, bundle contract, `sutura replay`, captured-fixture manifest

## Goal

Turn each unique historical CI run into a partial captured fixture for GitHub
and log-parsing boundary tests, make complete bundles replayable offline
through the real orchestrator, and make "captured, not
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
- `packages/core/src/github/types.ts`, `adapter.ts`, and tests — the existing
  transport-neutral GitHub orchestration adapter moved from Action so live and
  replay use one implementation.
- `packages/action/src/replay-github.ts` — add `replayingGitHubApi(bundle)`.
- `packages/cli/src/replay.ts`, `replay.test.ts`.
- `packages/action/src/__fixtures__/captured/<runId>/bundle.json` for every
  historical run (GitHub half only), plus one
  `packages/action/src/__fixtures__/captured/manifest.json`.
- `packages/core/src/__fixtures__/captured/manifest.json` (provider, Tavily,
  and sandbox halves land here in Phase 5 after authorization).

Modify:

- `packages/action/src/github.ts` — retain the Action artifact implementation
  and re-export the Core adapter/types; no duplicated validation or sequencing.
- `packages/action/src/checks.ts`, `evidence.ts`, `octokit.ts` — move pure
  check/adapter logic needed by Core or update imports; keep `@actions/*` and
  temp-file artifact work in Action only.

- `packages/cli/src/args.ts:6-16` — add
  `sutura replay --bundle <file> --format json [--runtime <auto|node|python>]`
  to `USAGE`; add `parseReplay`; extend the `Arguments` union.
- `packages/cli/src/cli.ts:100-150` — dispatch `replay` like `audit`.
- `packages/core/src/engine/repair-provider-replay.test.ts` and
  `packages/core/src/orchestrate.test.ts:552,1079,1152` — each "replays live run
  N" test reads its GitHub half (job log, run metadata) from the captured
  fixture for that run ID instead of the inline literal; the provider reply
  stays inline until a provider capture exists in Phase 5.
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
     workflowRunId: string;               // captured GitHub workflow run
     targetRunId: string;                 // CI run supplied to Sutura
     suturaRunId?: string;                // associated Sutura workflow
     kind: 'ci-failure' | 'ci-success' | 'provider-capture' | 'tavily-capture'
         | 'sandbox-capture' | 'dogfood-gave-up';
     headSha: string;                     // exact 40-hex commit the run executed
     capturedAt: string;                  // ISO-8601 UTC
     source: string;                      // https://github.com/juan294/sutura/actions/runs/<runId>
                                          // or the capture commit SHA when capturedBy === 'local'
     capturedBy: 'workflow' | 'local';
     bundleSha256: string;                // sha256 of bundle.json bytes
     boundaries: Array<'github' | 'nebius' | 'tavily' | 'contree' | 'repository' | 'executor'>;
     notes: string;                       // e.g. 'A3: bundle.test.ts hook timeout; Sutura crashed: no observed failing command'
   }

   export interface CapturedFixturesManifest {
     schemaVersion: typeof CAPTURED_FIXTURES_SCHEMA_VERSION;
     entries: CapturedFixtureEntry[];
   }
   ```

   For `capturedBy: 'workflow'`, `source` must satisfy `publicGitHubUrl`
   (`scripts/evidence-contract.mjs:43`). For `capturedBy: 'local'`, `source`
   must satisfy `exactSha` and identify the committed capture script used for
   the run. `headSha` must satisfy `exactSha`; `bundleSha256` must equal the
   SHA-256 of the file bytes.

2. Add run-time-validated bundle and manifest parsers. Reject unknown schema
   versions, malformed records, missing outcomes for complete bundles,
   overflowed captures presented as complete, and files above 16 MiB before
   full parsing. Put typed canonical JSON in Core and reuse the same ordering
   contract as `scripts/evidence-contract.mjs`.

3. `capture-run.mjs`: for a CI run ID, call `gh api` for
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
   `bundle.json` and append a manifest entry. When a historical branch no
   longer exists, derive the logical ref result from immutable workflow-run
   `head_sha` and record that derivation in `notes`; never claim it was a
   present-day raw ref response.

4. Capture the 26 unique triggering CI runs represented by the A, B, and C
   evidence in `docs/research/2026-08-29-ci-failure-retrospective.md`.
   `workflowRunId`, `targetRunId`, and optional `suturaRunId` are separate
   manifest fields so B crashes do not duplicate their triggering CI bundle.
   Commit the real GitHub payloads and raw logs, including ANSI escapes and
   pnpm workspace prefixes.

5. `replayFetch(bundle, boundary)`: returns a boundary-specific fetch-shaped function that
   pops the next recorded exchange for that boundary, asserts the request
   `method`, `url`, and canonical-JSON `body` equal the recorded request (fail
   closed with `ReplayMismatchError` naming the sequence number and the first
   differing JSON path), and returns the recorded response. Transport errors
   replay as rejections.

6. `RecordedExecutor implements Executor`: built from the logical executor exchanges;
   maps each `run`/`snapshot`/`import` call to the recorded operation by
   sequence and returns the recorded terminal (exit, stdout, stderr, metrics).
   Reuses `InMemoryExecutor` (`packages/core/src/executor/memory.ts:42`)
   semantics for image ids. Where a bundle has no `contree` exchanges (all
   historical captures), boundary-level tests accept injected dependencies.
   The public `sutura replay` command fails closed with "bundle is partial;
   complete provider, repository, and sandbox recordings are required".

7. Before replay wiring, move the existing GitHub orchestration adapter and
   pure check helpers into Core. It depends on a transport-neutral `GitHubApi`
   and `TextArtifactPort.upload(name, content, extension)`. The Action
   `ActionTextArtifactPort` alone writes a temp file and calls
   `@actions/artifact`; Action re-exports the Core adapter/types so existing
   call sites remain stable. Adapter behavior and existing tests must remain
   byte-for-byte equivalent at the public contract.

8. `replayingGitHubApi(bundle)`: returns a `GitHubApi` whose read methods
   return recorded results in order and whose mutating methods record the
   requested mutation into an in-memory list and return the recorded ids.

9. `replayBundle(bundle, { executor?, artifact? })`: requires a complete
   bundle and constructs
   `GitHubAdapter` over `replayingGitHubApi`, a `RepositoryPort` that serves
   the recorded Phase 1 repository calls and materializes the bounded replay
   checkout needed by runtime detection, `createTokenFactoryClient`
   with `replayFetch(bundle,'nebius')`, `TavilyClient` with
   `replayFetch(bundle,'tavily')`, and runs `orchestrate()`. Returns
   `{ caseFile, mutations }`.

10. `sutura replay`: parse args; read bundle (≤ 16 MiB); validate schema;
   run `replayBundle`; print `JSON.stringify(caseFile)`; exit 1 if
   `caseFile.outcome !== bundle.outcome` with a message naming both.

11. Contract test `captured-fixtures.test.mjs`:
   - every manifest entry's file exists, hash matches, `source` is a public
     GitHub run URL for `juan294/sutura` when captured by workflow or an exact
     capture-script commit SHA when captured locally, and `headSha` is exact;
   - every file under `__fixtures__/captured/` is listed in a manifest;
   - no captured file matches `/Bearer\s+\S+|\bnb-[A-Za-z0-9]{8,}|\bghp_|\bgithub_pat_|\bsk-[A-Za-z0-9]{8,}/u`;
   - for each boundary test file (list enumerated in the script:
     `packages/action/src/github.test.ts`, `octokit.test.ts`,
     `repository.test.ts`, `packages/core/src/llm/nebius.test.ts`, `json.test.ts`,
     `executor/contree.test.ts`, `diagnose/tavily.test.ts`,
     `runtime/detect.test.ts`, `runtime/python.test.ts`,
     `orchestrate.test.ts`), the file imports from `__fixtures__/captured/`
     at least once where an authorized capture exists. Provider, Tavily, and
     ConTree entries remain explicit pending boundaries through Phase 4 and
     must reach zero in Phase 5.

## Automated success criteria

- `capture-run.test.mjs`: with an injected `gh api` returning the fixture
  payloads, the script writes a bundle whose `github` call order equals the
  adapter's resolution order and a manifest entry with a correct hash.
- All 26 unique historical CI captures exist, validate, and contain the real ANSI
  Vitest line for the 08-29 dogfood runs (`[31m❯[39m`) and the
  raw `Hook timed out in 10000ms` text for A2/A3.
- `replay-fetch.test.ts`: a request that differs from the recording by one
  JSON field fails with the field path; matching requests return the recorded
  body; sequence exhaustion fails closed.
- A boundary-level regression over captured run `33239848825` (A3) terminates
  with `OrchestrationError('Failed-step logs do not contain an observed failing command')`
  when its recorded failed-step log is sliced to the pre-`58b4443` shape, and
  the current adapter retains the command line. It does not enter diagnosis.
- The A2 runtime regression is deferred to the exact-commit repository fixture
  in Phase 3c; a GitHub-only historical partial bundle is not used as policy or
  runtime evidence.
- The captured bundle for `33169026068` (A1) replayed on the pre-`0d3b087`
  `ALLOWED_RUN_EVENTS` logic reproduces `github.ts:238`; on current code it
  resolves the direct run (B2 regression).
- `sutura replay --bundle <partial A3 bundle>` fails closed before network or
  sandbox work. A complete captured bundle exits 0 and prints a `CaseFile`
  whose outcome equals the bundle's recorded outcome; with a tampered outcome
  it exits 1.
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
