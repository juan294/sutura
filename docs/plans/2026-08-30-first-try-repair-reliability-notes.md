# First-try repair reliability implementation notes

## Phase 1 exit evidence

- Implementation lineage: `a084bce`, `44863f2`, `67a7e14`, and hardening commit `55cbe8a`.
- Core tests: 805 passed, 8 skipped.
- Action tests: 82 passed.
- Core and Action typecheck: passed.
- Core and Action lint: passed.
- Full repository build: passed twice.
- Rebuilt `packages/action/dist/index.cjs` SHA-256 after both builds: `f871911d922b7549dad8e10ff895f56a824347ba90109b0e990fef044c5222a0`.
- E2E artifact contract: the `fixed` and `gave-up` storylines assert exactly `sutura-case-file-77001.html` plus `sutura-replay-77001.json`. The replay assertion checks the final outcome, populated GitHub, Repository, logical Executor, and HTTP streams, and `completeness.complete === true`. A run without replay capture still uploads exactly one artifact.
- `git diff --check`: passed.

## Phase 2 exit evidence

- Implementation lineage: capture commits `c026b69` and `c91ff2b`; replay runtime and CLI commits `9948465` and `e1bc839`; contract and simplify corrections through `cf278fd`.
- Historical corpus: 26 unique GitHub/log partial bundles, all with local capture provenance bound to `c026b69`; manifest SHA-256 `49a0fba717ad3f71551439c489da633ad389109e83bb21ffb1e3e8b128f6d50a`.
- B-class regression tests:
  - `replays A1 push metadata as a direct run while the pre-fix guard rejects it`
  - `replays A3 with the current command retention and reproduces pre-fix slicing`
  - `replays captured A3 pre-fix log slicing and stops before diagnosis`
- Real complete replay coverage: `replays every recorded boundary through the real offline orchestration path` and CLI test `replays a complete bundle offline and prints matching CaseFile JSON` exercise the generated complete bundle without external I/O.
- Actual command: `node packages/cli/dist/bin.js replay --bundle packages/action/src/__fixtures__/captured/33239848825/bundle.json --format json`.
- Actual result: exit 1 with `bundle is partial; complete provider, repository, and sandbox recordings are required` before network or sandbox construction, as required for a historical partial bundle.
- Final verification: Core 872 passed and 8 skipped; Action 83 passed; CLI 93 passed; captured fixtures 25 passed; release contracts 52 passed; typecheck, lint, build, `verify:bundle`, `git diff --check`, and a clean archive checkout passed.

## Phase 3a exit evidence

- Scanner handoff: the Phase 3c TypeScript AST scanner derived 78 Phase 3a guards on base `5d94e0a`. Four structurally unreachable guards were deleted with the proofs below, so the current run-time-derived target is 74/74.
- Core GitHub adapter checklist:
  - `packages/core/src/github/adapter.ts:25,27` — `rejects invalid workflow run id` and `rejects an unsafe integer workflow run id`.
  - `:52,57` — `rejects failed-step logs with no/invalid/reversed timestamp bounds`.
  - `:65` — `rejects a failed step with no timestamped log lines in its bounds`.
  - `:97` — `rejects an invalid repository identifier`.
  - `:104` — `rejects a requested run that differs from the captured Action event`.
  - `:112` — `rejects captured workflow metadata that changes identity`.
  - `:124,129,132,135,138,143` — the six `rejects captured pull-request metadata` cases.
  - `:155,160` — `rejects an invalid direct-run branch` and `rejects a direct branch that moved after the captured run`.
  - `:185` — `rejects a captured run with no failed-step logs`.
  - `:200` — `rejects multiple matching Sutura checks`.
  - `:209` — `rejects workflow metadata that changes before the atomic claim`.
  - `:218` — `wraps a non-422 atomic-claim failure`.
  - `:236` — `rejects an invalid created check id`.
  - `:265` — `rejects a completion target that differs from the atomic claim`.
  - `:291,293` — the invalid fix/base branch and invalid base SHA cases in `rejects ... before creating a pull request`.
  - `:297` — `rejects a fix branch that is not based on the captured failing SHA`.
  - `:318,320` — `requires an artifact port` and `rejects invalid case-file artifact name`.
- Action boundary checklist:
  - `packages/action/src/github.ts:38,40` — `rejects invalid Action run id` and `rejects an unsafe integer Action run id`.
  - `packages/action/src/github.ts:61` — `rejects an artifact upload with a missing/zero/unsafe id`.
  - `packages/action/src/octokit.ts:18` — `rejects an unsupported captured-log response shape`; the same test file also verifies captured logs in string, `ArrayBuffer`, and `Uint8Array` form.
  - `packages/action/src/repository.ts:95` — `rejects invalid bounds before reading a captured source path`.
  - `:113,117` — the unsafe top-level path and forbidden-segment tables.
  - `:132,134,139` — directory, oversized, and changed-during-read policy tests.
  - `:149` — `requires a non-empty GitHub token`.
  - `:172,175,178` — invalid repository/SHA, head ref, and PR number cases.
  - `:202` — `fails closed when no validated ref resolves to the exact SHA`.
  - `:214,218,226` — source request count, checkout containment, and line-number tests.
  - `:235` — `rejects traversal and every symlink component`.
  - `:272` — `rejects a referenced line beyond the end of a fully scanned file`.
  - `:303` — `policy is read only from the exact commit and symlinks fail closed`.
  - `:319,324,335` — invalid fix input, mismatched checkout HEAD, and mismatched fix parent tests.
- Orchestration and healing checklist:
  - `packages/core/src/orchestrate.ts:225,228,235,238,241,244,247` — the captured `rejects captured run metadata` table.
  - `:369,372,395` — source file limit, extra response, and structurally unsafe excerpt tests.
  - `:511,515` — missing and ambiguous audited-candidate identity tests through `resolveAuditedCandidate`.
  - `:546` — `replays live crash B4`; the pre-fix slice loses the command and the current adapter retains it.
  - `:552` — the existing repeated-attempt and claimed-crash tests.
  - `:566,575` — captured A2 runtime-conflict and unverified-Python-image tests.
  - `packages/core/src/heal.ts:167,227` — bounded stage evidence and missing routing quote tests.
  - `:1221,1224` — non-empty context and failure-command tables.
  - `:1242,1247` — runtime conflict and verified Python digest tests.
  - `packages/core/src/source-window.ts:46` — `rejects a referenced line beyond the available source window`.
- Historical boundary statement: B2 remains the captured A1 push regression, B4 is the captured A3 log-slicing regression, and repository guard inputs use captured log paths plus local temporary filesystem construction. No historical bundle is described as having a repository capture.
- Verification: Core 928 passed and 8 skipped; Action 116 passed; captured fixture contracts 25 passed; repository typecheck and lint passed; `ci:fast` passed with 52 release contracts, 3 README tests, a fresh build, bundle identity verification, 116 Action tests, and 93 CLI tests; `git diff --check` passed.

## Deviations

### Phase 3a historical repository input source

- Plan said: Build repository guard fixtures from the dogfood-16 bundle's recorded `readSourceExcerpts` paths.
- Found: The approved historical corpus is intentionally GitHub/log-only and every historical bundle has an empty repository stream.
- Chose: Parse the source path from the captured dogfood-16 job log, then create the symlink, traversal, `.git`, limit, and policy inputs only in local temporary directories.
- Why: This keeps historical evidence within its authorized boundary and does not falsely describe locally constructed repository inputs as captured repository calls.

### Phase 3a structurally unreachable guards

- `packages/core/src/github/adapter.ts` base availability: every valid PR path assigns `baseSha` and `baseRef` together; every fallback direct-run path also assigns both together.
- `packages/action/src/repository.ts` source escape: every path component is checked with `lstat` and symlinks are rejected before `realpath`, so the resolved path cannot leave the real checkout root.
- `packages/action/src/repository.ts` policy escape: the policy has one fixed filename under the real checkout root and its terminal symlink is rejected before `realpath`.
- `packages/core/src/heal.ts` missing race result: `race()` rejects a cardinality mismatch and returns one result per approved candidate; every non-approved candidate is inserted into `refusedCandidates` before the merge.
- Chose: Delete these four guards. Keep the policy changed-during-read guard by extracting the bounded policy read into a directly tested helper.
- Why: The run-time guard target must contain reachable fail-closed decisions, not branches whose negated invariants were already established by earlier code.

### Phase 3a GitHub adapter path correction

- Plan said: Enumerate and test the GitHub adapter guards in `packages/action/src/github.ts`.
- Found: Phase 2 moved the transport-neutral adapter and its guards to `packages/core/src/github/adapter.ts`; the Action file now contains only its artifact-wrapper guards.
- Chose: Derive and test guards from both current files, with the Core adapter in the Phase 3a action scope.
- Why: Guard coverage must follow the production implementation that owns each fail-closed decision after the approved Phase 2 architecture change.

### Local capture source validation

- Plan said: Validate every manifest `source` as a public GitHub run URL, while the manifest type also allowed a capture commit SHA for local captures.
- Found: The 26 historical bundles were captured locally through read-only `gh api`; labeling them as workflow captures would give false provenance, and a fixture commit cannot refer to its own SHA.
- Chose: Commit the capture tool first, label every fixture `capturedBy: 'local'`, and bind `source` to capture-tool commit `c026b69`; validate workflow URLs only for workflow captures and exact commit SHAs for local captures.
- Why: The two-commit sequence gives honest, immutable, non-self-referential provenance.

### Logical Executor recording

- Plan said: Record the three provider HTTP transports, GitHub API calls, and repository calls.
- Found: ConTree HTTP does not describe the logical sandbox operations that deterministic replay must reproduce.
- Chose: Add a Core-owned `Executor` decorator that records import, snapshot, run, run-many, capacity, and cancellation calls in call-start order.
- Why: The logical Executor stream is the canonical sandbox replay boundary; ConTree HTTP remains diagnostic evidence.

### Deterministic orchestration configuration

- Plan said: Capture external boundary inputs and outputs.
- Found: Boundary records alone do not preserve triage, race, budget, search, runtime, image, model-routing, or operation-limit choices.
- Chose: Store the validated orchestration configuration in each replay bundle.
- Why: Offline replay must use the same controller inputs as the captured run.

### Checkout runtime snapshot

- Plan said: Record repository calls and their results.
- Found: `checkoutHead` returns an ephemeral path, while runtime detection later reads files at that path.
- Chose: Record a bounded, path-safe runtime-evidence snapshot and replace later checkout arguments with a stable recorded checkout ID.
- Why: Replay can materialize the same runtime inputs without depending on the original runner filesystem.

### Explicit completeness

- Plan said: Bound recorded calls and bodies.
- Found: Silent call limits, truncation, capture failures, and unfinished asynchronous calls could produce a bundle that looked complete.
- Chose: Record `complete`, `overflowedBoundaries`, and `pendingBoundaries`; reserve sequence numbers at call start; preserve raw JSON-failure bytes; and mark any unavailable body evidence incomplete.
- Why: A replay consumer must distinguish complete evidence from partial capture.

### Capture sanitation and exact body evidence

- Plan said: Store bounded, redacted replay evidence without changing provider response behavior.
- Found: Deep final redaction could corrupt large raw bodies; non-UTF-8 bytes could retain credentials; generic JSON conversion could silently lose keys or structure; and cloned provider responses added an unbounded duplicate allocation.
- Chose: Sanitize metadata, configuration, and records once; mark structural loss on its boundary; store unsafe non-UTF-8 evidence as hash-only truncation; recognize only the exact capture-truncation shape; and consume each provider response once while rebuilding its JSON/text methods from the captured bytes.
- Why: Complete bundles must be credential-safe, byte-exact within the body limit, and explicit about every lossy transformation.

### Cancellable ConTree request capture

- Plan said: Record the ConTree HTTP request and response without affecting the transport result.
- Found: A rejected transport could wait forever for a tee branch whose request stream never completed.
- Chose: Cancel unfinished request capture on transport rejection, record immediately available bodies or null partial evidence, mark the HTTP boundary incomplete, and rethrow the original error promptly.
- Why: Best-effort replay capture must never delay or replace the product transport failure.

### Shared dependency snapshot primitives deferred

- Plan said: Capture the bounded checkout evidence that runtime detection needs.
- Found: Runtime dependency validation, ConTree workspace snapshots, and replay evidence capture use different path sets, byte limits, error types, and security semantics.
- Chose: Keep the Phase 1 replay reader and canonical path set local to the repository recorder.
- Why: Extracting one shared abstraction would change established runtime and ConTree contracts; the replay materializer can define the common contract in Phase 2.

### Final upload sequencing

- Plan said: Upload the replay bundle while preparing the HTML report.
- Found: Pull-request publication, attempt-comment updates, and terminal check completion occur after report preparation.
- Chose: Upload one best-effort replay bundle only after all outcome mutations and check completion, including the unexpected-failure path.
- Why: The uploaded bundle contains the final requested mutations without changing the product outcome if capture or upload fails.
