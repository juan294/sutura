# Evaluation inventory v1

The frozen 100-case inventory the phase 6 quality evaluation refers to.
Rebuild it with:

```bash
node packages/evaluation/scripts/inventory.mjs --out docs/evaluation/inventory-v1.json
```

| Field | Value |
| --- | --- |
| Cases | 100 (60 development, 20 validation, 20 held out) |
| Root families | 94 |
| Corpus revision | Placebo v0.2 |
| Split hash | `14453c118c71549b84c205fd57ecd167307199b68f05a09a5a860ac98362b6b9` |
| Inventory hash | `ee6954ca1d7d9df49fea97c297aa73da025d8b7ba3d4c697840f155711d9e27c` |

Splits are frozen by root family, so a synthetic mutation can never land in a
different split from the case it derives from. The inventory hash moves when
any fixture content or the corpus revision changes, so a published held-out
number always names the exact corpus it was measured on.

38 corpus cases were added on 2026-09-06 to complete the inventory: 37 of them plus one more, because `repair-dogfood-arithmetic` is a corpus fixture that the benchmark manifest deliberately excludes. Each is
one distinct root defect with its own family, generated from
`packages/placebo/scripts/inventory-cases.mjs` by
`packages/placebo/scripts/generate-inventory-cases.mjs`. Every one carries
`evaluationRevision: inventory-v1`, so the frozen v0.2 default corpus selection
and its committed `corpusHash` are unchanged: only a run that opts into
versioned cases sees them.

The added defects, by language: 19 Python, 16 JavaScript, 3 TypeScript. By
kind: 26 repairable, 8 traps, 3 flakes, 1 upstream migration. They cover
mutable default arguments, integer division, suffix stripping, sort keys,
exclusive ranges, async gather ordering, decimal money arithmetic,
deduplication order, timezone-aware comparison, regex anchoring, lookup
defaults, resource release, internal list aliasing, numeric sort comparators,
shallow-copy mutation, settled-result handling, zero-based months, parse radix,
strict equality, regex `lastIndex`, JSON clone type loss, map key identity,
optional index access, discriminated-union narrowing, percentage rounding
preservation, a config-and-consumer two-file transaction, and an upstream
separator release. The traps cover tautological assertions, expected-failure
markers, widened numeric tolerance, a patched subject under test, non-null
assertions, empty catch blocks, loosened precision and a narrowed input set.

Every added case is validated by the corpus self-check: the clean fixture is
green, the break patch is red, reversing the break restores green, and each
trap's fake fix passes the visible suite while failing its hidden checks.
