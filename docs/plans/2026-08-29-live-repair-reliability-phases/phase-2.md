# Phase 2: Controller-owned repair attempt

## Goal

Remove production workflow control from model-selected tool calls.

## Files

Refactor the repair-agent and structured repair modules, repair tools, LLM schema types, trace types, exports, and matching tests. Keep the current interactive agent behind an internal evaluation-only entry point if its existing benchmark contract needs it.

## Implementation

1. Define one strict repair proposal schema with candidate ID, concise rationale, and complete replacement text for one controller-selected source excerpt. Do not expose a path, source identifier, start line, or end line in provider output.
2. Send diagnosis, bounded source closure, trusted command identity, and optional parent feedback to one Super request.
   Use a 16,384-token low-effort completion envelope and include the compact JSON shape in the prompt because reasoning shares the provider completion limit.
3. Do not expose production control tools to that request.
4. Select one policy-admissible source target of at most 1,000 code points in the controller. Preserve complete target-centered source lines and omit a partial line that cannot fit. Derive the exact path, old bytes, inclusive line range, and unified diff in the controller. The model supplies only the complete new excerpt text. This bound keeps a maximally JSON-escaped strict reply below half the 16,384-token completion envelope.
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
- Provider-schema bounds and local-parser bounds are identical, and neither layer accepts model-selected target metadata.
- Model text cannot cause a search, arbitrary command, direct submission, or policy change.
- Repeated identical source lines cannot create target ambiguity because Sutura selects the complete excerpt before inference.
- An empty replacement deletes only the selected excerpt; multiline replacements preserve LF, CRLF, and final-newline state from controller-owned source.
- One valid dogfood proposal produces the correct patch, automatically runs the trusted test, and creates a held candidate.
- A patch failure, test failure, provider failure, invalid schema, policy refusal, timeout, cancellation, and budget exhaustion return typed terminal evidence.
- A provider completion-length terminal is preserved explicitly and cannot be mislabeled as malformed JSON.
- Completion exhaustion is a non-retryable search terminal: cancel unfinished siblings, stop later branches, and keep a valid same-batch candidate if one completed.
- Provider output cannot select a stack-trace line, path, test file, or another source target.
- Every admitted source target is reachable when its complete attempt fits the configured budgets.
- A source excerpt larger than the full-replacement limit stops before inference.
- A truncated partial final line stops before inference, while a distant observed line remains inside its bounded complete-line window.
- No candidate exists without passing trusted-test evidence from its patched image.
- Exact cost, model-turn, action, sandbox-operation, and elapsed-time accounting is asserted.
- Trace events prove the state order for pass and fail paths.

## Exit evidence

One local test must fail if an accepted patch is not immediately followed by the diagnosed trusted test.
