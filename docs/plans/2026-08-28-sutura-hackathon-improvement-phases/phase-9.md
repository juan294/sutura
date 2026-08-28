# Phase 9: Placebo v0.2 benchmark expansion

Dependencies: Phase 7

Batch status: `[batch-eligible]` with Phase 8

## Goal

Expand public verification evidence without changing Sutura production code.

## Current evidence

Placebo v0.1 defines trap, repairable, flaky, and upstream cases (`packages/placebo/src/types.ts:3-26`).

Corpus discovery validates each metadata file (`packages/placebo/src/corpus.ts:29-54`).

The self-check verifies clean, broken, restored, flaky, and fake-fix states (`packages/placebo/src/corpus.ts:168-221`).

The current published result covers 26 fixtures and 30 evaluations.

## Files

Modify only:

- `packages/placebo/**`
- provisional corpus manifests under `docs/demo/`

Do not modify core, action, CLI, root workflows, or shared documentation in this phase.

## Corpus additions

Add repair cases for these current failures:

- ESM extension resolution
- cache invalidation
- missing `await`
- TypeScript configuration drift

Keep the existing failed cases. Add adjacent variants instead of replacing difficult fixtures.

Add trap coverage for:

- conditional assertion deletion
- snapshot acceptance without review
- widened test glob exclusion
- removed error propagation
- timeout inflation without cause repair
- mocked dependency replacement
- workflow check removal
- policy file modification

Add flaky coverage for timing, port, order, filesystem, and simulated network assumptions.

Use a deterministic local network simulator. Placebo never requires outbound network access.

All fixtures must stay deterministic through controlled attempt inputs.

## Metadata version

Set the provisional corpus version to `0.2-rc1`.

Phase 10 adds Python cases and finalizes version `0.2`.

Add these required metadata fields:

```text
riskClass
language
failureFingerprint
expectedChecks
source
```

Use public-safe source descriptions. Do not include private fleet content.

## Hidden-test contract

Support optional hidden verification files in the local scorer.

Do not copy hidden files into the agent-visible case directory.

Run hidden verification only after the adapter returns a candidate.

Apply the returned diff to a new clean fixture copy before hidden verification.

Never run hidden checks inside an agent-mutated directory.

Record only the hidden result and test-set hash.

## Scoring

Add these measures:

- false approval count
- repair rate by difficulty and failure class
- flake accuracy by pattern
- hidden-test preservation
- median inference cost
- median sandbox operations
- median elapsed time
- budget exhaustion count

Keep every unsuccessful case in the denominator.

## Automated success criteria

- Every clean fixture passes.
- Every broken fixture fails as declared.
- Every reverse patch restores green.
- Every trap fake fix makes visible CI pass.
- Hidden verification detects the intended shortcut.
- Every flaky fixture matches its declared deterministic sequence.
- Corpus discovery order and result hashes are stable.
- Old v0.1 fixture identities remain traceable.
- Control adapters produce expected scores.
- Placebo package tests and offline runtime smoke pass.
- The complete local gate passes.

## Manual success criteria

- Review every new trap as a plausible CI shortcut.
- Review every repair case for one clear intended cause.
- Confirm public fixture text contains no private repository information.

## Exit evidence

Commit the provisional `0.2-rc1` corpus manifest and its SHA-256 hash.

Limit this phase to corpus manifests and offline control results.

Create final live result files in Phase 11 after Python coverage completes.
