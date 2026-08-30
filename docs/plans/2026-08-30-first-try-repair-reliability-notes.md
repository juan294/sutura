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

### Canonical dogfood fixture ordering

- Plan said: Store `return left - right;` in the fixture while also requiring `break.diff` to turn the fixture red and `repair.diff` to turn it green.
- Found: The Placebo corpus contract starts every fixture green, then applies `break.diff` and verifies that `repair.diff` restores the green state.
- Chose: Store `return left + right;` in the fixture, copy it into the dogfood worktree, and apply `break.diff` before committing the intentional failure.
- Why: The live dogfood commit still contains the required subtraction, while the canonical corpus remains self-checking and reproducible.

### Clean-checkout dogfood command

- Plan said: Run `node scripts/dogfood.mjs` directly from the package script.
- Found: The gate imports the Core provider-contract version, while `packages/core/dist/` is ignored and absent from a clean checkout.
- Chose: Build `@sutura/core` before starting the dogfood script.
- Why: The documented gate must work from a clean exact-SHA checkout without relying on stale local build output.

## Phase 4 exit evidence

- Canonical case: `repair-dogfood-arithmetic`; content hash `7a96845fc1a9d0bed0b6d7266dd1f46c37b0ad50b2b079b48eb66d05e619c59a`; 52-case corpus hash `14a7540f082966e1884aeb884603dae50e2b3246592581868efd5d63e85e898b`.
- Fixture proof: the full Placebo corpus self-check passed 20/20 harness tests, installs the nested workspace offline, accepts the clean addition, rejects the broken subtraction, and accepts the canonical repair.
- Ledger schema: `sutura-dogfood-ledger-v1`; initial entries `[]`; result hash `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.
- Release-contract tests: 65 passed. The final dogfood and capture correction suite passed 32/32. Repository typecheck, lint, build, and `git diff --check`: passed.
- Final review corrections: enforce the hard USD 10 cap and minimum USD 1.50 initial reserve; restart attempt numbering at 1 for a new candidate; refuse reuse after a non-fixed outcome; parse exact `gh run view --log` prefixes from captured run `33269188958`; and promote the exact complete `gave-up` replay bytes with all streams and the recorded outcome intact.
- Simplification corrections: reject attempt 11 before the gate or any remote action, and inspect each completed Sutura run's artifacts only once during correlation polling.
- Current `develop` gate output is recorded after the verified Phase 1-4 candidate is merged and pushed, because the gate intentionally requires local `HEAD === origin/develop`.
