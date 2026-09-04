# Sutura v0.2.1 candidate freeze

Date: 2026-09-04

Integrated candidate base: `096a48e7ffb5e95103ee91746644386bba1a0c12`

Branch: `develop`

State: feature freeze active; candidate gates in progress

## Selection evidence

The integrated base was the first clean `origin/develop` commit whose ancestry
contained all four workstream lines:

- WS-1 Case Lab: `8d60f329bed548fc0e5b62dc0b4a363ce61b7e43`
- WS-2 Counterfactual and Arena: `ed8ea35a176aeb2d5f1be963515d65c8452ff3bf`
- WS-3 Data Lab and adoption: `43836804dd280032e2c1352a966cd9b0e225cd25`
- WS-4 evidence and submission gates: `6d850d5f569d851cf6f5b6a483077ac8b0fd62a5`

At selection, the local `develop` checkout was clean and exactly matched
`origin/develop`. The candidate used by each subsequent gate is always resolved
from the then-current exact `origin/develop` SHA. Evidence-only or permitted
corrective commits therefore replace the operative candidate and reset every
candidate-dependent gate; this note preserves the immutable integration base.

## Admission policy

No new product feature is admitted after this record. A commit may enter the
candidate line only when it is:

1. a security fix;
2. a release or packaging fix;
3. an evidence-contract or evidence-record update; or
4. a demo-blocking fix required for the existing Case Lab or judge path.

Every admitted fix must name its category in the commit or evidence record.
It replaces the operative candidate, invalidates prior candidate-bound local,
canary, benchmark, matrix, and release evidence, and restarts the affected
gates. Paid runs retain the separate push-freeze lifecycle and authorization
caps in the WS-4 plan.

## Gate state at freeze

- Feature freeze and admission policy: active.
- Sequential local CI: pending on the first operative candidate containing this
  record.
- Candidate install and external-matrix contract: pending after local CI.
- Provider and ConTree canaries: blocked at G4 authorization.
- Release and public acceptance: blocked on all preceding candidate evidence
  and their separate authorization gates.
