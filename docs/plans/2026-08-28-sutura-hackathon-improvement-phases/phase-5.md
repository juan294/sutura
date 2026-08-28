# Phase 5: Adaptive ConTree checkpoint search

Dependencies: Phase 4

Batch status: Sequential

## Goal

Use ConTree checkpoints as an adaptive repair tree instead of a fixed one-layer candidate race.

## Current evidence

Every ConTree run returns a child image (`packages/core/src/executor/contree.ts:215-237`).

`runMany` starts independent children from one parent (`packages/core/src/executor/contree.ts:207-213`).

The in-memory executor records deterministic lineage (`packages/core/src/executor/memory.ts:37-89`).

The current selector chooses the smallest passing diff (`packages/core/src/engine/repair.ts:461-476`).

## Files

Add:

- `packages/core/src/engine/search.ts`
- `packages/core/src/engine/search.test.ts`
- `packages/core/src/engine/search-score.ts`
- `packages/core/src/engine/search-score.test.ts`
- `packages/core/src/engine/fingerprint.ts`
- `packages/core/src/engine/fingerprint.test.ts`

Modify:

- `packages/core/src/executor/types.ts`
- `packages/core/src/executor/contree.ts`
- `packages/core/src/executor/memory.ts`
- `packages/core/src/domain.ts`
- `packages/core/src/engine/repair-agent.ts`
- `packages/core/src/engine/repair.ts`
- `packages/core/src/heal.ts`
- `packages/core/src/config.ts`
- `packages/core/src/orchestrate.ts`
- `packages/core/src/report/format.ts`
- `packages/core/src/report/markdown.ts`
- `packages/core/src/report/casefile.ts`
- `packages/core/src/index.ts`
- action and CLI configuration surfaces

Update matching tests and rebuild the action bundle.

## Initial algorithm

Use beam search with these defaults:

```text
initial branches: 4
beam width: 2
maximum depth: 4
maximum total branches: 12
```

Respect the lower value from phase budgets and repository policy.

Do not implement Monte Carlo tree search in this phase.

## Search node

```text
SearchNode {
  id
  parentId
  depth
  imageId
  cumulativeDiff
  errorFingerprint
  testEvidence
  policyEvidence
  stageEvidence
  transcriptReference
  terminalReason
}
```

Use stable generated node IDs. Do not expose ConTree credentials or internal URLs.

## Deterministic score

Apply priorities in this order:

1. Prune policy violations and invalid diffs.
2. Prefer a passing diagnosed command.
3. Prefer fewer remaining failure signatures.
4. Prefer smaller diffs and fewer changed files.
5. Prefer lower sandbox cost and elapsed time.
6. Use stable node ID as the final tie-breaker.

Do not ask an LLM to score its own repair branch.

## Search pseudocode

```text
frontier = create initial agent branches from one baseline image
visited = empty fingerprint set

for depth from 1 through maximumDepth:
  expand each frontier node within concurrency and capacity limits
  validate every returned child
  prune policy failures, repeated states, and exhausted budgets
  return all passing submitted candidates when present
  frontier = best beamWidth children by deterministic score

return gave-up with complete branch evidence
```

Use Token Factory remaining capacity and ConTree operation limits before expansion.

Authorize each expansion from its current immutable Token Factory capacity snapshot.

Add executor cancellation identifiers and a bounded cancellation method.

Record cancellation requests, terminal results, and completion races in stage evidence.

Cancellation never authorizes a replacement beyond the original global budgets.

## Compatibility

Keep the old fixed race behind an internal evaluation profile.

Do not expose two production algorithms after the evaluation selects a winner.

The final candidate still passes the existing clean audit in `packages/core/src/audit/audit.ts:53-127`.

## Automated success criteria

- Every child has one valid parent.
- The same inputs produce the same pruning and ordering.
- Repeated diff and error fingerprints stop expansion.
- Search never exceeds depth, branch, operation, time, or cost budgets.
- Policy failures never receive additional model or sandbox work.
- A passing candidate still receives an independent clean audit.
- Cancellation preserves terminal evidence.
- Cancellation and natural completion resolve exactly once.
- In-memory tests cover branches, pruning, ties, exhaustion, and cancellation.
- Placebo retains zero false approvals.
- The complete local gate passes.

## Manual success criteria

- Run one live case with at least two search depths.
- Confirm child image lineage matches the published case file.
- Confirm the operation count remains within the configured ConTree limit.

## Exit evidence

Publish one ablation comparing fixed K=3, one interactive branch, and beam search.

Report fix rate, false approvals, median time, inference cost, sandbox cost, and operations.
