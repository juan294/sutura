# Phase 2: Controller-owned repair attempt

## Goal

Remove production workflow control from model-selected tool calls.

## Files

Refactor the repair-agent and structured repair modules, repair tools, LLM schema types, trace types, exports, and matching tests. Keep the current interactive agent behind an internal evaluation-only entry point if its existing benchmark contract needs it.

## Implementation

1. Define one strict repair proposal schema with candidate ID, concise rationale, and non-empty exact structured edits.
2. Send diagnosis, bounded source closure, trusted command identity, and optional parent feedback to one Super request.
3. Do not expose production control tools to that request.
4. Validate and convert edits with the existing exact-source diff builder.
5. Start every attempt from the clean prepared baseline image.
6. Controller sequence:

```text
reserve complete attempt
request one structured proposal
validate proposal and policy
apply patch in ConTree
run diagnosed trusted test in ConTree
if pass: create held candidate
if fail: return checkpoint with complete diff and bounded test evidence
```

7. Never ask the model whether to test or submit.
8. Keep patch validation, no-network execution, timeouts, redaction, trace sanitation, cancellation, and cost reservation fail-closed.
9. Record explicit controller-state trace events and the exact proposal ID and diff hash, never source content or hidden reasoning.
10. Keep invalid provider output local to one branch so another admitted branch can run.

## Automated success criteria

- The production Super request has a strict response schema and no control tools.
- Model text cannot cause a search, arbitrary command, direct submission, or policy change.
- One valid dogfood proposal produces the correct patch, automatically runs the trusted test, and creates a held candidate.
- A patch failure, test failure, provider failure, invalid schema, policy refusal, timeout, cancellation, and budget exhaustion return typed terminal evidence.
- No candidate exists without passing trusted-test evidence from its patched image.
- Exact cost, model-turn, action, sandbox-operation, and elapsed-time accounting is asserted.
- Trace events prove the state order for pass and fail paths.

## Exit evidence

One local test must fail if an accepted patch is not immediately followed by the diagnosed trusted test.
