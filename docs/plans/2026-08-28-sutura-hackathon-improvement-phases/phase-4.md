# Phase 4: Bounded tool-calling repair agent

Dependencies: Phase 3

Batch status: Sequential

## Goal

Replace one-shot generated repairs with a bounded agent that inspects, edits, and tests inside ConTree.

Keep supplied benchmark candidates on their current independent audit path.

## Current evidence

Super currently returns every candidate in one response (`packages/core/src/engine/repair.ts:335-401`).

The repair path reads bounded source excerpts before generation (`packages/core/src/orchestrate.ts:298-356`).

The current race applies each diff and runs one command (`packages/core/src/engine/repair.ts:425-458`).

Supplied candidates enter through `packages/core/src/heal.ts:265-301`.

## Files

Add:

- `packages/core/src/engine/repair-tools.ts`
- `packages/core/src/engine/repair-tools.test.ts`
- `packages/core/src/engine/repair-agent.ts`
- `packages/core/src/engine/repair-agent.test.ts`
- `packages/core/src/engine/repair-budget.ts`
- `packages/core/src/engine/repair-budget.test.ts`
- `packages/core/src/engine/candidate-validation.ts`
- `packages/core/src/engine/candidate-validation.test.ts`

Modify:

- `packages/core/src/engine/repair.ts`
- `packages/core/src/heal.ts`
- `packages/core/src/config.ts`
- `packages/core/src/domain.ts`
- `packages/core/src/orchestrate.ts`
- `packages/core/src/index.ts`
- `packages/action/src/input.ts`
- `packages/action/src/main.ts`
- `packages/cli/src/heal.ts`
- `action.yml`
- `packages/action/action.yml`
- `README.md`

Update matching tests and rebuild `packages/action/dist/index.cjs`.

## Stable tool contract

### `read_file`

Accept one validated repository-relative path and an optional line window.

Reject sensitive, read-denied, missing, binary, oversized, and symlinked paths.

Protected paths remain readable unless the policy also denies reading them.

### `search_repo`

Accept a literal query and optional allowlisted path prefixes.

Use sandbox-local `git grep -F`. Bound matches, bytes, and elapsed time.

Pass the literal query without shell interpolation.

### `run_test`

Accept only the diagnosed command or a repository policy command.

The model cannot supply an arbitrary shell command.

Resolve each command from a trusted enumerated identifier.

Run the command on a disposable child image.

Keep test output as evidence. Never continue editing from the test child.

### `apply_patch`

Accept structured edits or a complete unified diff.

Run built-in and repository policy checks before execution.

Return a child image, bounded output, and the cumulative diff.

Validate the complete cumulative diff after every accepted patch.

### `inspect_diff`

Return the cumulative diff from the sandbox-local Git baseline.

Include changed files, bytes, and policy findings.

### `submit_candidate`

Require a non-empty cumulative diff and the latest test evidence.

Submission ends the branch. It cannot create a GitHub pull request.

## Default budgets

```text
model turns: 8
tool calls: 24
branches: 4
sandbox operations: 32
elapsed time: 600 seconds
inference cost: $0.25
diff bytes: min(policy maxDiffBytes, 65536)
```

Users can lower budgets. Hard maximums remain in core.

No user setting can increase network access or bypass policy.

All model, tool, branch, operation, time, and cost limits apply globally to one Sutura run.

Reserve the worst-case model cost before each request.

Account for concurrent operations through atomic reservations.

## Agent loop pseudocode

```text
messages = diagnosis + grounding + bounded initial evidence
state = baseline image + empty cumulative diff

while budget remains:
  reply = Super.chat(messages, tools, tool_choice=required)
  validate every tool call
  reject parallel mutating calls
  execute one bounded step in ConTree
  keep the editable image unchanged after read and test tools
  append sanitized tool result

  if tool is submit_candidate:
    return candidate with image, diff, transcript, and evidence

return gave-up with budget evidence
```

Permit parallel read-only calls only after deterministic ordering tests pass.

Reject tool output that exceeds the bounded external message limit.

## Failure handling

Refuse malformed tool arguments without executing them.

Stop a branch after repeated identical invalid calls.

Stop a branch after the same diff and error fingerprint repeat.

Classify provider, sandbox, policy, and budget failures separately in stage evidence.

Do not convert infrastructure failure into a repair refusal.

## Automated success criteria

- Every tool validates arguments before execution.
- The model cannot select arbitrary commands.
- The model cannot read sensitive or read-denied paths.
- Mutating tool calls execute serially.
- Every patch produces a child image and cumulative diff.
- Test side effects never enter the cumulative diff.
- Only `apply_patch` advances the editable image.
- Concurrent reservations cannot exceed global run budgets.
- Repeated states stop without exhausting every budget.
- Budget exhaustion returns `gave-up` with public-safe evidence.
- Supplied Placebo candidates keep the current direct path.
- Existing trap cases retain zero false approvals.
- At least one previously failed repair case passes in recorded tests.
- The complete local gate passes.

## Manual success criteria

- Run one live repair that uses `read_file`, `apply_patch`, `run_test`, and `submit_candidate`.
- Confirm the transcript contains no hidden reasoning.
- Confirm every tool operation maps to one ConTree child image.

## Exit evidence

Publish a versioned comparison against the 6/10 Placebo baseline.

Do not make a new repair-rate claim until the complete live corpus finishes.
