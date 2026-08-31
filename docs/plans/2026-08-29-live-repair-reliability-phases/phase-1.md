# Phase 1: Bounded repair source closure

## Goal

Build the smallest safe dependency closure needed for a repair proposal before adaptive search starts.

## Files

Add a core source-context module and matching tests. Modify orchestration source extraction, the repository port only where required, Node and Python runtime adapters, exports, and matching action repository tests.

## Implementation

1. Keep failed-log references and failure-class fallback files as the roots.
2. Parse only statically recognizable local dependencies from accepted excerpts.
3. For Node, support relative `import`, `export ... from`, dynamic `import()`, and `require()` specifiers. Resolve explicit extensions, ESM `.js` to tracked TypeScript variants, and bounded `index` variants.
4. For Python, support bounded relative imports and same-package module references without importing or executing repository code.
5. Normalize every candidate path with the existing safe repository path grammar.
6. Request candidates through the exact-checkout repository port. Accept only returned paths that were requested, policy-allowed, regular, non-symlinked, inside the checkout, and within the existing per-file and total-file limits.
7. Expand breadth-first to depth two and stop at the existing eight-file maximum.
8. Exclude sensitive, denied, ambiguous, missing, oversized, binary, and credential-shaped editable sources.
9. Preserve deterministic order: root evidence order, then normalized dependency path order.
10. Record bounded source-closure evidence in the trace without recording source content.

## Automated success criteria

- The arithmetic dogfood test resolves `./dogfood-add.js` to `packages/core/src/dogfood-add.ts`.
- ANSI-colored Vitest reporter lines retain their pnpm workspace and resolve the exact test path before dependency closure.
- Direct TypeScript, TSX, MTS, CTS, JavaScript, and index variants resolve deterministically.
- Monorepo root prefixes remain exact.
- Python relative modules resolve without execution.
- Cycles do not duplicate files or exceed depth or file limits.
- Traversal, absolute paths, ambiguous variants, policy denial, symlinks, sensitive paths, binary files, oversized files, and redacted editable content do not enter the closure.
- Existing source extraction behavior remains compatible.
- Targeted core and action tests pass.

## Exit evidence

Commit the dogfood source pair as a test fixture and prove the repair prompt receives both files before its first Super call.
