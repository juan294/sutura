# Phase 3: Search budgets, feedback, and exact winner identity

## Goal

Make adaptive search executable under default budgets and bind one winner through audit and publication.

## Files

Modify repair search admission, expansion context, search evidence, case-file identity, audit handoff, publication selection, reports, fixtures, action bundle, and matching tests.

## Implementation

1. Replace magic budget divisors with named minimum costs from the controller-owned attempt contract.
2. Admit an expansion only when the complete attempt fits remaining model, action, sandbox, elapsed, inference, branch, provider, and ConTree capacity.
3. Allow the default profile to run multiple independent initial proposals.
4. Pass a failed parent candidate’s complete diff, bounded test output, and failure fingerprint as feedback to its child.
5. Generate every child as a complete replacement proposal against the original source context and apply it to the clean baseline image.
6. Preserve search lineage, deterministic scoring, repeated-state pruning, bounded concurrency, and sibling cancellation.
7. Add the selected candidate ID and SHA-256 diff hash to the terminal case file and audit evidence.
8. Publish only the candidate whose ID and diff hash were audited. Remove publication-time reselection.
9. Fail closed if the candidate is missing, duplicated, changed, or does not match the exact failed SHA.

## Automated success criteria

- Default budgets admit at least four complete one-turn initial attempts.
- A budget with capacity for only a partial path admits zero expansions.
- Invalid and failed siblings do not consume another branch’s reserved capacity.
- A two-depth replacement fixes a first-depth failing proposal from the clean baseline.
- Repeated replacement candidates are pruned deterministically.
- A passing sibling cancels unfinished work and cannot create replacement work beyond the original budget.
- Audit and publication candidate ID and diff hash match exactly.
- A smaller unaudited held diff cannot replace the audited winner.
- All search terminal results and failure kinds have explicit tests.

## Exit evidence

Commit one two-depth test with complete lineage, budgets, trace, audit identity, and final published diff assertions.
