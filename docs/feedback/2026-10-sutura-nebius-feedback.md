# Sutura feedback for Nebius

Status: local draft. Live-provider verification remains pending authorization.

## Verified local integration behavior

- Sutura isolates dependency preparation from source execution and keeps repair,
  triage, and audit commands network-disabled by contract.
- The ConTree adapter records bounded operation, cancellation, snapshot, and
  branch lineage evidence. Local tests cover cancellation and capacity behavior.
- Token Factory responses are validated against bounded schemas. Model roles
  remain separate from actual model IDs and recorded prices.
- Evaluation traces remove hidden reasoning, credentials, full source, and
  unbounded tool arguments at recorder storage time.

These statements describe repository contracts and local tests. They are not
claims about current service behavior.

## Observed integration problems

- Verify whether the current public API schema provides every client safety
  bound needed by a repair agent. This remains an untested hypothesis.
- Reliable cost comparison requires a single, versioned catalog snapshot. An
  incomplete or internally inconsistent snapshot cannot select production models.
- Provider request, capacity, cancellation, and sandbox resource evidence need
  normalization before it can be compared across a multi-branch repair run.
- GitHub workloads need short-lived credentials, but Sutura has not verified a
  Token Factory GitHub OIDC exchange and does not claim that it exists.

## Requested features

- Publish versioned JavaScript SDK and OpenAPI schemas for ConTree operations,
  cancellation, errors, and capacity fields.
- Expose image deletion, retention, network-policy, cold-start, branch-latency,
  cancellation, and resource metrics through stable typed fields.
- Publish model metadata and prices as a versioned, hashable catalog snapshot.
- Provide consistent request IDs, rate-limit headers, error classes, and retry
  guidance for parallel function-calling workloads.
- Document function-calling and JSON Schema conformance by model.
- Document GitHub OIDC or another short-lived credential flow if supported.
- Document Data Lab redaction, upload, retention, and Zero Data Retention behavior.

## Proposed impact

These features would reduce custom validation code, make cost and latency
evidence reproducible, improve recovery from partial failures, and let a CI
repair system use shorter-lived credentials. Live observations, request IDs,
and measured service results will be added only after an authorized probe.
