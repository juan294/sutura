# Phase 4: Thirteen-run replay and production-path integration gates

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
3. Prove each class is rejected at its boundary or structurally impossible in the production path.
4. Add a recorded direct `workflow_dispatch` GitHub action E2E with realistic failed logs, exact checkout source closure, Nano diagnosis, Super repair proposal, ConTree patch/test, Ultra audit, fix branch, PR, check, comment, and artifact.
5. Add a two-depth failed-first-proposal storyline.
6. Add Node and Python production-path cases plus provider, sandbox, policy, cancellation, and timeout terminals.
7. Assert no credentials, full source, hidden reasoning, or unbounded tool output enters the case file or ATIF trace.
8. Add the production-path replay command to release contracts.

## Automated success criteria

- All nine historical model-control terminals and the four post-redesign live terminals have named regression tests.
- The realistic arithmetic E2E reaches `fixed` and publishes only the addition patch.
- The repair test and `.sutura.json` remain unchanged.
- The repair branch parent is the exact failed SHA and the PR base is the failed branch.
- Redelivery performs no additional model, sandbox, branch, PR, check, or comment mutation.
- The two-depth, Python, provider, sandbox, policy, cancellation, and timeout cases terminate as declared.
- The complete local verification gate passes from a clean worktree.
- Reuse, quality, and efficiency reviews return no findings.

## Exit evidence

Recorded in `docs/plans/2026-08-29-live-repair-reliability-notes.md`: 956 repository tests passed, 8 live tests skipped, all exact-path and range replays passed, and the reuse, quality, and efficiency reviews were clean.
