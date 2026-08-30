# First-try repair reliability implementation notes

## Phase 1 exit evidence

- Implementation lineage: `a084bce` (`feat(replay): capture deterministic repair bundles`), plus the Phase 1 review corrections in this commit.
- Core tests: 797 passed, 8 skipped.
- Action tests: 81 passed.
- Core and Action typecheck: passed.
- Core and Action lint: passed.
- Full repository build: passed twice.
- Rebuilt `packages/action/dist/index.cjs` SHA-256 after both builds: `6ccd5e72e5ebdd9bdf23bd3df245094bf11e36f71f224b71c39d823ff92b4a7c`.
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

### Final upload sequencing

- Plan said: Upload the replay bundle while preparing the HTML report.
- Found: Pull-request publication, attempt-comment updates, and terminal check completion occur after report preparation.
- Chose: Upload one best-effort replay bundle only after all outcome mutations and check completion, including the unexpected-failure path.
- Why: The uploaded bundle contains the final requested mutations without changing the product outcome if capture or upload fails.
