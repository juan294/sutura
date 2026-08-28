# Phase 3: Repository policy and stage evidence

Dependencies: Phases 1 and 2

Batch status: Sequential

## Goal

Give maintainers explicit repair controls and preserve complete sandbox evidence through every stage.

## Current evidence

Built-in patch policy lives in `packages/core/src/engine/patch-rules.ts:70-102`.

The repository port has no policy reader (`packages/core/src/orchestrate.ts:131-149`).

ConTree maps CPU, memory, time, and cost (`packages/core/src/executor/contree.ts:488-502`).

Triage, race, and audit currently discard those metrics.

`CaseFile` has no sandbox evidence or repository policy fields (`packages/core/src/domain.ts:82-91`).

## Files

Modify:

- `packages/core/src/domain.ts`
- `packages/core/src/config.ts`
- `packages/core/src/orchestrate.ts`
- `packages/core/src/heal.ts`
- `packages/core/src/engine/patch-rules.ts`
- `packages/core/src/engine/triage.ts`
- `packages/core/src/engine/repair.ts`
- `packages/core/src/audit/audit.ts`
- `packages/core/src/report/format.ts`
- `packages/core/src/report/markdown.ts`
- `packages/core/src/report/casefile.ts`
- `packages/action/src/repository.ts`
- `packages/action/src/github.ts`
- `packages/cli/src/heal.ts`
- `packages/action/src/evidence.ts`
- `packages/core/src/index.ts`

Add:

- `packages/core/src/policy/schema.ts`
- `packages/core/src/policy/load.ts`
- `packages/core/src/policy/evaluate.ts`
- matching test files

Update domain tests, fixtures, report snapshots, action evidence tests, healing tests, and orchestration tests.

## Policy contract

Use this initial shape:

```json
{
  "version": 1,
  "allowedPaths": ["src/**", "packages/**"],
  "protectedPaths": [".github/**", "migrations/**"],
  "deniedReadPaths": ["secrets/**"],
  "maxDiffBytes": 65536,
  "maxChangedFiles": 8,
  "requiredCommands": ["pnpm test"],
  "resourceLimits": {
    "elapsedTimePercent": 20,
    "maxRssPercent": 20
  }
}
```

Use safe defaults when `.sutura.json` is absent.

Treat the policy file as protected by default.

Reject unknown keys, unsafe commands, invalid globs, invalid numbers, and unsupported versions.

Use an internal ASCII path glob grammar without a new dependency.

`*` and `?` match within one segment. `**` is valid only as a complete segment.

Reject braces, extglobs, negation, backslashes, empty segments, dot segments, and parent segments.

Protected paths block writes. Denied read paths block source inspection.

## Evidence contract

Add a stage ledger to `CaseFile`:

```text
stages[] = {
  stage,
  attempt,
  nodeId,
  parentNodeId,
  exitCode,
  metrics,
  network,
  note
}
```

Bound the entry count and every public string.

Add aggregate helpers for elapsed time, CPU, memory peak, sandbox cost, and operation count.

Do not include provider credentials, raw commands, full logs, or internal image URLs.

Keep ConTree image identifiers only in runtime search state.

## Implementation

### 1. Load policy safely

For pull requests, read `.sutura.json` from the verified base SHA through the repository port.

For direct protected-branch runs, read policy from the exact failing SHA.

Extend pull request and failing workflow records with the base ref and base SHA.

Verify the base SHA through GitHub and bind the policy SHA in evidence.

Use bounded reads, realpath containment, and no symlink traversal.

Validate before Token Factory, Tavily, or ConTree spending.

### 2. Enforce policy

Apply built-in patch rules first. Apply repository policy second.

Refuse protected paths, disallowed paths, excessive files, and excessive bytes before a candidate runs.

Run every required command from the audited winner image.

Reject resource regressions beyond configured thresholds.

Run each threshold command on the unpatched prepared image and audited candidate image.

Compare paired metrics from the same command only.

Apply percentage thresholds only when both values exist and the baseline exceeds zero.

When a configured metric is missing or has a zero baseline, fail closed with explicit evidence.

A policy cannot permit a built-in unsafe change.

### 3. Preserve stage evidence

Capture preparation, reproduction, triage, candidate, search, and audit results.

Propagate evidence through every terminal outcome, including infrastructure stops.

Render concise totals in comments and complete stage details in the HTML artifact.

## Automated success criteria

- Invalid policy stops before Token Factory, Tavily, or ConTree calls.
- A symlinked policy stops safely.
- Pull request policy comes from the verified base SHA.
- Evidence binds the base ref, base SHA, and policy SHA.
- A candidate cannot change `.sutura.json`.
- Protected and disallowed path changes never execute.
- Denied read paths never reach agent tools or external messages.
- Diff and changed-file limits apply before execution.
- Required commands run on the audited winner image.
- Resource threshold failures produce `refused`.
- Missing configured resource metrics fail closed.
- Public evidence contains stable node IDs, not provider image IDs.
- Every terminal outcome contains bounded stage evidence.
- Reports escape every policy and evidence field.
- Existing Placebo v0.1 retains zero false approvals.
- The complete local gate passes.

## Manual success criteria

- Review a fixed, refused, flaky, and infrastructure case file.
- Confirm each report separates inference cost from sandbox cost.
- Confirm the displayed stage lineage matches the live ConTree operation sequence.

## Exit evidence

Commit updated serialized fixtures and report snapshots.

Record one live case with time, CPU, memory, operation count, and sandbox cost where available.
