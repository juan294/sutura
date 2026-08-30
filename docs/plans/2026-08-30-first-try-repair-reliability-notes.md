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

## Deviations

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
