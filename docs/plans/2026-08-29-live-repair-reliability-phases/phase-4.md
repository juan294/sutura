# Phase 4: Sixteen-run replay and production-path integration gates

## Goal

Turn the live failure history into a permanent local release gate.

## Files

Add sanitized dogfood log/source/provider fixtures. Extend core orchestration and recorded GitHub action E2E tests. Update release-contract scripts and documentation where needed.

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

## Automated success criteria

- All nine historical model-control terminals and the seven post-redesign live terminals have named regression tests.
- The realistic arithmetic E2E reaches `fixed` and publishes only the addition patch.
- The repair test and `.sutura.json` remain unchanged.
- The repair branch parent is the exact failed SHA and the PR base is the failed branch.
- Redelivery performs no additional model, sandbox, branch, PR, check, or comment mutation.
- The two-depth, Python, provider, sandbox, policy, cancellation, and timeout cases terminate as declared.
- The complete local verification gate passes from a clean worktree.
- Reuse, quality, and efficiency reviews return no findings.

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
