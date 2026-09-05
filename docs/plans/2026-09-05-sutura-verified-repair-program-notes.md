# Verified repair program implementation deviations

Plan: `2026-09-05-sutura-verified-repair-program`.

## Deviations

### Phase 1: preserve the frozen benchmark selection

Plan said to add a versioned pagination case and version expanded scoring semantics. Found that the existing benchmark manifest hashes a fixed 51-case selection. Chose to include versioned cases through an explicit corpus-loader selection while retaining the legacy default; self-check includes the expanded selection. This preserves historical hashes and prevents the new oracle from silently changing the old denominator. Phase 6 owns the separately versioned expanded evaluation scores.

### Phase 1: unknown terminal identities

Plan said every new result binds snapshot, diff and image digest. Found that early terminal outcomes may have no candidate or snapshot, and the executor's imported image identifier is not a verified digest. Chose explicit null values for these unknown identities on nonaccepted terminal evidence; accepted evidence requires all three exact identities. This avoids fabricated provenance while preserving strict acceptance requirements. The later provider preflight must establish an actual image digest before provider-backed v1 acceptance.
