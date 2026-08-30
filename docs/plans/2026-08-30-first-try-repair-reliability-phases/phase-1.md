# Phase 1: Replay bundle capture at the six boundaries

## Goal

Every live Sutura run with `capture-replay: true` uploads a machine-readable
`sutura-replay-<runId>.json` containing the raw (credential-free) inputs and
outputs at all six external boundaries, sufficient to re-run `orchestrate()`
offline.

## Files

Add:

- `packages/core/src/replay/bundle.ts` — `ReplayBundle` type, schema version,
  `ReplayRecorder` class, redaction.
- `packages/core/src/replay/record-fetch.ts` — boundary-specific recording
  wrappers for the Nebius, Tavily, and ConTree transport shapes.
- `packages/core/src/replay/bundle.test.ts`, `record-fetch.test.ts`.
- `packages/core/src/replay/record-executor.ts` and test — logical `Executor`
  decorator for import, snapshot, run, run-many, capacity, and cancellation.
- `packages/action/src/replay-github.ts` — recording `GitHubApi` decorator.
- `packages/action/src/replay-github.test.ts`.
- `packages/action/src/replay-repository.ts` — recording `RepositoryPort`
  decorator for reads and the requested `publishFix` mutation.
- `packages/action/src/replay-repository.test.ts`.

Modify:

- `packages/core/src/index.ts` — export the replay module.
- `packages/core/src/orchestrate.ts:189-204` (`OrchestrationContext`) — add
  optional `replay?: ReplayRecorder`; `prepareReport` (`:455-467`) uploads the
  bundle when present.
- `packages/core/src/orchestrate.ts` `GitHubOrchestrationPort` — add
  `uploadReplayBundle(name, json)`.
- `packages/action/src/github.ts:480-500` — generalize `uploadCaseFile` into
  `uploadTextArtifact(name, content, extension)`; keep `uploadCaseFile` as a
  thin wrapper; add `uploadReplayBundle`.
- `packages/action/src/input.ts:10-16`, `:112-118` — `captureReplay: boolean`
  from input `capture-replay` via the existing `booleanInput`.
- `packages/action/action.yml` and root `action.yml` — declare
  `capture-replay` (default `'false'`); `metadata.test.ts` already asserts
  the two files stay equivalent.
- `packages/action/src/main.ts:36-70` — when `action.captureReplay`, construct
  one `ReplayRecorder` and pass recording `fetch`/`GitHubApi` wrappers to
  `createTokenFactoryClient`, `TavilyClient`, `ContreeExecutor`, and
  `GitHubAdapter`.
- `.github/workflows/sutura.yml` — add `capture-replay: true`;
  `packages/action/src/workflow.test.ts` asserts it.
- `packages/action/src/orchestration.e2e.test.ts` — one new storyline
  assertion: with a recorder, `RecordedArtifactApi` receives two uploads.
- `packages/action/dist/index.cjs` — rebuild.

## Implementation

1. Define the bundle:

   ```ts
   // packages/core/src/replay/bundle.ts
   export const REPLAY_BUNDLE_SCHEMA_VERSION = 'sutura-replay-v1' as const;

   export type RecordedBody =
     | { kind: 'text'; value: string }
     | { kind: 'binary'; bytes: number; sha256: string }
     | { kind: 'truncated'; bytes: number; sha256: string }
     | { kind: 'empty' };

   export interface RecordedHttpExchange {
     boundary: 'nebius' | 'tavily' | 'contree';
     sequence: number;                 // 1-based, per bundle
     request: { method: string; url: string; headers: Record<string, string>; body: RecordedBody };
     response: { status: number; headers: Record<string, string>; body: RecordedBody }
             | { transportError: string };
     latencyMs: number;
   }

   export interface RecordedGitHubCall {
     sequence: number;
     method: keyof GitHubApi;          // 'getWorkflowRun' | 'downloadJobLogs' | ...
     args: unknown[];                  // JSON-safe
     result: unknown | { error: string };
   }

   export interface RecordedRepositoryCall {
     sequence: number;
     method: 'readPolicyAtSha' | 'checkoutHead' | 'readSourceExcerpts' | 'publishFix';
     args: unknown[];
     result: unknown | { error: string };
   }

   export interface RecordedExecutorCall {
     sequence: number;
     method: 'importImage' | 'snapshot' | 'run' | 'runMany' | 'operationCapacity' | 'cancel';
     args: unknown[];
     result: unknown | { error: string };
   }

   export interface ReplayOrchestrationConfig {
     triageN: number;
     raceK: number;
     repairBudgets?: RepairBudgetOverrides;
     search?: SearchLimits;
     runtimeId?: RuntimeId;
     imageRef?: string;
     routingProfileId: string;
     models: Readonly<Record<ModelTier, string>>;
     maxOps: number;
   }

   export interface ReplayBundle {
     schemaVersion: typeof REPLAY_BUNDLE_SCHEMA_VERSION;
     runId: string;
     repo: string;
     actionSha: string;                // GITHUB_SHA of the Sutura run
     capturedAt: string;               // ISO
     github: RecordedGitHubCall[];
     repository: RecordedRepositoryCall[];
     executor: RecordedExecutorCall[];
     configuration: ReplayOrchestrationConfig;
     http: RecordedHttpExchange[];
     completeness: {
       complete: boolean;
       overflowedBoundaries: string[];
       pendingBoundaries: string[];
     };
     outcome?: CaseFile['outcome'];    // filled before upload
   }
   ```

2. `ReplayRecorder` receives the secret values that must never be persisted:

   ```ts
   export class ReplayRecorder {
     constructor(readonly runId: string, readonly repo: string, readonly actionSha: string, configuration: ReplayOrchestrationConfig, secrets?: readonly string[]);
     recordHttp(exchange: Omit<RecordedHttpExchange, 'sequence'>): void;
     recordGitHub(call: Omit<RecordedGitHubCall, 'sequence'>): void;
     recordRepository(call: Omit<RecordedRepositoryCall, 'sequence'>): void;
     recordExecutor(call: Omit<RecordedExecutorCall, 'sequence'>): void;
     finish(outcome: CaseFile['outcome']): ReplayBundle;   // applies redactBundle
   }
   ```

   Bounds: at most 512 HTTP exchanges and 256 GitHub or repository calls. A
   bounded-body union stores text up to 1 MiB or `{ truncated: true, bytes,
   sha256 }`; binary or stream bodies record length/hash metadata. Truncation
   happens before redaction and recording never throws or fails a repair.
   Crossing a count/body bound marks the applicable boundary overflowed and
   `complete: false`. Boundaries that were not exercised are listed in
   `pendingBoundaries` and also keep `complete: false`; a replay consumer can
   never mistake a partial recording for a complete recording. Sequence
   numbers are reserved when a call starts, not when its asynchronous response
   finishes.

3. Redaction (`redactBundle`): request and response records include headers;
   strip `authorization`, `x-api-key`, `cookie`,
   `set-cookie` headers on both request and response; run every string
   through `redactExternalText` from
   `packages/core/src/security/external-text.ts`; replace the API key value if
   it appears anywhere in a body (the recorder receives the key values to
   scrub, never stores them).

4. Recording transport wrappers (`record-fetch.ts`): implement separate
   `recordingNebiusFetch`, `recordingTavilyFetch`, and `recordingContreeFetch`
   adapters over the exact boundary types. Nebius and Tavily capture raw
   response bytes once, then implement `json()`/`text()` over the captured
   bytes so malformed JSON and non-2xx bodies remain replayable. ConTree
   records safe HTTP metadata and logical
   executor operations; stream bodies are represented by length/hash metadata.
   If any request or response body cannot be captured, the recorder marks that
   boundary overflowed/incomplete instead of substituting `null` as complete.

5. Recording `GitHubApi` decorator (`replay-github.ts`):

   ```ts
   export function recordingGitHubApi(api: GitHubApi, recorder: ReplayRecorder): GitHubApi
   // Proxy every method: await result; recorder.recordGitHub({method, args, result}); return result.
   // On throw: record { error: message } then rethrow.
   ```

   Read methods are recorded with full results (`downloadJobLogs` bodies are
   the raw job log). Mutating methods (`createRef`, `createPullRequest`,
   `createCheckRun`, comments, `updateCheckRun`) are recorded with args and
   returned ids so replay can assert the same mutations were requested.

6. `recordingRepositoryPort` records `readPolicyAtSha`, `checkoutHead`,
   `readSourceExcerpts`, and `publishFix` in call order while returning the
   wrapped port's exact result. After `checkoutHead`, it records a bounded,
   path-safe snapshot of policy and runtime-evidence files needed by
   `detectRuntimeAtPath`; replay materializes this snapshot instead of the
   ephemeral checkout path. Symlinks, sensitive paths, and files outside the
   recorded root are rejected; entry and byte caps match runtime detection.
   Later repository-call arguments use a stable recorded checkout id, not the
   ephemeral absolute path, so replay can map it to a materialized temp root.

7. `recordingExecutor` records the logical `Executor` method, JSON-safe
   arguments, result or error, and call sequence. This is the canonical
   sandbox replay stream; ConTree HTTP remains diagnostic evidence only.

8. `orchestrate.ts`: keep HTML creation in `prepareReport`, then perform every
   outcome mutation (`publishFix`, PR creation, attempt update, and check
   completion) before one final best-effort
   `github.uploadReplayBundle(\`sutura-replay-${run.runId}.json\`, JSON.stringify(ctx.replay.finish(caseFile.outcome)))`.
   Capture or upload failure emits a warning but cannot change a valid product
   outcome. The failure-safe path also uploads after unexpected-check
   completion with `outcome: 'infra-stop'`. This ordering ensures the uploaded
   bundle contains the final requested mutations and each recorded run still
   produces exactly one HTML artifact plus one replay artifact.

9. `main.ts`: build wrappers only when `action.captureReplay`, populate the
   JSON-safe orchestration configuration from the validated action config,
   and wrap the repository and executor before they enter orchestration:

   ```ts
   const recorder = action.captureReplay
     ? new ReplayRecorder(action.runId, `${owner}/${repo}`, process.env.GITHUB_SHA ?? '')
     : undefined;
   const nebius = createTokenFactoryClient({...}, recorder ? { fetch: recordingNebiusFetch(recorder, globalThis.fetch) } : {});
   ```

   Same for `TavilyClient` and `ContreeExecutor.fetch`; the adapter receives
   `recorder ? recordingGitHubApi(api, recorder) : api`.

10. Rebuild the bundle; commit `dist/index.cjs` with the change.

## Automated success criteria

- `bundle.test.ts`: a recorder with an injected key `'nb-secret'` and a body
  containing `Authorization: Bearer nb-secret` finishes to a bundle where
  neither string appears; header names are lower-cased and the four sensitive
  headers are absent; bounds produce `{truncated: true}` without throwing.
- `record-fetch.test.ts`: the wrapped fetch returns a response whose `json()`
  equals the inner response's `json()`; a rejected inner fetch is recorded
  as `transportError` and rethrown; sequence numbers are contiguous across
  boundaries.
- `replay-github.test.ts`: all `GitHubApi` methods are proxied (a test iterates
  `Object.keys` of the recorded stub and asserts one call per method).
- `input.test.ts`: `capture-replay` accepts only `true`/`false`, defaults false.
- `metadata.test.ts` and `workflow.test.ts` pass with the new input and the
  `capture-replay: true` line.
- `orchestration.e2e.test.ts`: the `fixed` and `gave-up` storylines with a
  recorder upload exactly two artifacts named
  `sutura-case-file-77001.html` and `sutura-replay-77001.json`; the JSON parses
  to schema `sutura-replay-v1` with GitHub, Repository, HTTP, and logical
  Executor streams populated, `completeness.complete === true`, and `outcome`
  equal to the storyline outcome; without a recorder exactly one artifact is
  uploaded and every mutation count is unchanged.
- `packages/action/src/bundle.test.ts` still passes on the rebuilt bundle.

## Manual success criteria

None. (The first real bundle is produced in Phase 5; Phase 2 proves the
format against historical GitHub captures.)

## Exit evidence

Record in the notes file: the commit SHA, the e2e artifact-count assertion,
and the rebuilt `dist/index.cjs` SHA-256.
