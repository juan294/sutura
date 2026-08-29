# Phase 4: Sixteen-run replay and production-path integration gates

## Goal

Turn the live failure history into a permanent local release gate.

## Files

Add sanitized dogfood log/source/provider fixtures. Extend core orchestration and recorded GitHub action E2E tests. Add a non-mutating exact-model provider canary. Update release-contract scripts and documentation where needed.

## Implementation

1. Add the exact arithmetic defect and bounded failed-log shape as a reusable fixture.
2. Encode the nine historical terminal classes:
   - unsupported provider request field;
   - unsupported tool-choice form;
   - split shared model budget;
   - unresolved monorepo source;
   - unresolved ESM-to-TypeScript source;
   - stale or absent dynamic editable source;
   - trusted-test timeout or missing evidence;
   - accepted patch followed by exploration;
   - search-only model-turn exhaustion.
   - ANSI-colored Vitest reporter output that previously lost its pnpm workspace source path.
   - provider-schema output rejected by stricter local bounds.
   - exact old-source copying that failed before patch application.
   - Super completion-token exhaustion before a valid proposal.
   - a provider-schema-valid line range outside the selected source excerpt.
   - provider acceptance of target fields that contradict the detailed response schema, plus accepted but incorrect anchored patches.
   - strict three-field replies that consume excessive reasoning tokens, fail schema validation, produce rejected patches, or reach the 16,384-token limit.
   - a live Super endpoint that rejects `reasoning_effort: none` before inference and requires model-specific chat-template control.
3. Prove each class is rejected at its boundary or structurally impossible in the production path.
4. Add a recorded direct `workflow_dispatch` GitHub action E2E with realistic failed logs, exact checkout source closure, Nano diagnosis, Super repair proposal, ConTree patch/test, Ultra audit, fix branch, PR, check, comment, and artifact.
5. Add a two-depth failed-first-proposal storyline.
6. Add Node and Python production-path cases plus provider, sandbox, policy, cancellation, and timeout terminals.
7. Assert no credentials, full source, hidden reasoning, or unbounded tool output enters the case file or ATIF trace.
8. Add the production-path replay command to release contracts.
9. Put the Token Factory endpoint, prices, models, routing profile, and credential normalization behind one production client factory used by Action, CLI, and the canary.
10. Add a manual, read-only canary that calls the exact production Super model through the production serializer. Require the expected one-field arithmetic replacement, provider-reported model identity, normal finish reason, non-zero token usage, explicit zero reasoning tokens, and no hidden-thought prefix.
11. Reject unverified Super overrides until a new exact provider contract ships.
12. Add an opt-in strict Action outcome gate. Enable it in Sutura's own workflow so `gave-up`, `refused`, `infra-stop`, `flaky-no-patch`, and `already-attempted` cannot produce a green acceptance run.

## Automated success criteria

- All nine historical model-control terminals and the seven post-redesign live terminals have named regression tests.
- The realistic arithmetic E2E reaches `fixed` and publishes only the addition patch.
- The repair test and `.sutura.json` remain unchanged.
- The repair branch parent is the exact failed SHA and the PR base is the failed branch.
- Redelivery performs no additional model, sandbox, branch, PR, check, or comment mutation.
- The two-depth, Python, provider, sandbox, policy, cancellation, and timeout cases terminate as declared.
- The complete local verification gate passes from a clean worktree.
- Reuse, quality, and efficiency reviews return no findings.
- The standalone canary cannot create branches, pull requests, or other repository mutations.
- The canary and production paths use one Token Factory client factory and one serialized HTTP boundary.
- Sutura's own workflow fails unless the product outcome is `fixed`, including on redelivery.

## Previous exit evidence

The controller-selected replacement revision passed its complete local gate:

- Core: 740 passed, 8 skipped
- Action: 70 passed
- Evaluation: 5 passed
- CLI: 81 passed
- Placebo: 70 passed in 863 seconds
- Repository total: 966 passed, 8 skipped
- Typecheck: passed for all five buildable workspace packages
- Lint: passed for all five buildable workspace packages
- Build and Action bundle rebuild: passed
- Reuse review: clean
- Quality review: clean
- Efficiency review: clean
- `git diff --check`: passed

## Current exit evidence

The one-field, reasoning-disabled proposal revision passed its complete local gate:

- Core: 745 passed, 8 skipped
- Action: 70 passed
- Evaluation: 5 passed
- CLI: 81 passed
- Placebo: 70 passed in 1,314 seconds
- Repository total: 971 passed, 8 skipped
- Typecheck: passed for all five buildable workspace packages
- Lint: passed for all five buildable workspace packages
- Build and Action bundle rebuild: passed
- Reuse review: clean
- Quality review: clean
- Efficiency review: clean
- `git diff --check`: passed

Live proof 16 invalidated this exit gate because the selected endpoint rejected the generic reasoning-off value. Repeat the complete gate with the typed model chat-template control before Phase 5.

## Provider-contract canary revision

The local revision now includes:

- one canonical Token Factory client factory for Action, CLI, live tests, serialized replays, and the standalone canary;
- an exact Super canary with no Git or GitHub mutation authority;
- named serialized HTTP replays for live runs 1 through 16;
- provider-response model, hidden-thought, reasoning-detail, finish-reason, usage, schema, and replacement checks;
- strict self-hosting acceptance that cannot count `already-attempted` or any non-`fixed` product result as success.

The local implementation tree passed the complete pre-commit gate:

- Core: 775 passed, 8 skipped
- Action: 74 passed
- Evaluation: 5 passed
- CLI: 81 passed
- Placebo: 70 passed in 890 seconds
- Repository total: 1,005 passed, 8 skipped
- Typecheck and lint: passed for all five buildable workspace packages
- Build and Action bundle rebuild: passed
- README setup tests: 3 passed
- README isolated setup verification: passed
- Vendored runtime verification and offline `darwin-arm64` smoke: passed
- Release contracts: 26 passed
- Reuse review: clean after the shared client-factory revision
- Quality review: clean after the strict-outcome and provider-response metadata revisions
- Efficiency review: clean
- `git diff --check`: passed

The CLI unit suite now injects its benchmark boundary instead of running a second complete Placebo corpus. The canonical full-corpus integration remains in the harness suite, which removes a filesystem-sensitive timeout without reducing integration coverage.

Candidate package verification passed from a clean commit and bound the installed Action to the same exact branch tip. The live canary and Phase 5 remain pending and require separate remote authorization.
