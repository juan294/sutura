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

## Deviations

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

## Phase 3c exit evidence

- The TypeScript-AST scanner derives guard locations from `throw new`,
  `process.exit(...)`, and `core.setFailed(...)`. It excludes tests, test
  support, rethrows, and an explicitly marked `guards-verify: not-a-guard`.
- Batch-branch scan counts at base `5d94e0a` were 78 Action and orchestration
  guards, 121 provider guards, and 234 Phase 3c guards. The one proven
  unreachable Phase 3c guard was deleted, so the final Phase 3c scope is
  `guards: 233/233`.
- The exact Phase 3c checklist is generated on every run with
  `pnpm run guards:verify -- --scope phase-3c --scan-only --list`; the scoped
  coverage gate verifies the same derived set with
  `pnpm run guards:verify -- --scope phase-3c`.
- The final scoped coverage run completed in 18.29 seconds: Core 884 passed
  and 8 skipped; Action 85 passed. This is below the 90-second limit.
- The original eight uncovered locations closed as follows:
  - `packages/action/src/main.ts`: missing ConTree configuration, malformed
    `GITHUB_RUN_ID`, and terminal `setFailed` use the side-effect-free
    `runAction` dependency seam.
  - `packages/core/src/replay/canonical-json.ts`: a Symbol reaches the
    non-JSON-serializable terminal.
  - `packages/core/src/replay/replay-fetch.ts`: non-replayable binary evidence
    is rejected.
  - `packages/core/src/replay/validate.ts`: an unknown recorded-body shape is
    rejected.
  - `packages/core/src/runtime/python.ts`: an empty checkout reaches the
    missing-lock terminal.
  - `packages/core/src/engine/triage.ts`: the post-loop throw was deleted as
    structurally unreachable.
- The dogfood-16 runtime fixture is bound to target run `33268037618` and exact
  head `7488afea0c123f3ef84354301c6a1d90e4f9cfb0`. Its `.sutura.json` and three
  directory listings came from that local Git object. Tests use both the
  configured runtime and captured path evidence.
- Additional notable inputs cover a second reservation with `modelTurns: 1`,
  a 65,537-byte diff, runtime directory replacement and realpath escape,
  Python file replacement and UTF-16 input, and each missing Ultra reply
  field.
- Scanner tests, focused Core and Action tests, release contracts, typecheck,
  and lint passed. The committed Action entry point calls `runAction`, while
  importing `main.ts` in tests has no side effect.

### Phase 3c structurally unreachable guard

- Deleted: `packages/core/src/engine/triage.ts` post-loop throw, formerly line
  81.
- Proof: each iteration appends exactly `min(2, N - exitCodes.length)` results.
  When the final batch reaches `N`, `evaluateFlakeConfidence(exitCodes, N)` is
  at its maximum and cannot return `continue`; the function returns the
  completed verdict inside the loop.

### Phase 3c batch deviation

- The plan's final `guards: N/N` is an integration criterion because Phases
  3a, 3b, and 3c use separate batch branches.
- This branch therefore runs the same dynamic scanner and coverage mapper with
  `--scope phase-3c`. After integration, the unscoped CI command re-derives
  and verifies the combined total. No count is hard-coded in the scanner or
  CI workflow.
