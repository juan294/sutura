# Sutura Phase 0 evidence baseline deviations

## Phase 2: Canonical benchmark case set

Plan said: `discoverCases()` represented the 51-case public Placebo v0.2 corpus.

Found: `discoverCases()` returns 52 directories because it also includes `repair-dogfood-arithmetic`, a dedicated reliability fixture. The published v0.2 manifest correctly excludes this fixture and contains 51 cases, but the default harness still ran it and produced 56 evaluations.

Chose: Add `discoverBenchmarkCases()` and make benchmark execution and manifest generation exclude only `repair-dogfood-arithmetic`. Keep `discoverCases()` and corpus self-checks unchanged so the reliability fixture remains tested.

Why: Live evidence must use the already published 51-case manifest and its 55 evaluations. Including the dogfood fixture would change the denominator and contradict the release evidence contract.

## Phase 2: Workflow dispatch ref

Plan said: Dispatch the manual workflow at an exact controller SHA and accept only `subject-sha`, `case-id`, and `controller-id` as workflow inputs.

Found: GitHub workflow dispatch accepts a branch or tag ref, not a raw commit SHA as the durable dispatch contract.

Chose: Dispatch the protected `develop` ref, add `controller-sha` as an exact input, require `GITHUB_SHA` to equal that input, and check out the controller again at the same exact SHA.

Why: This keeps the controller identity exact while using GitHub's supported dispatch interface. The local gate already requires `origin/develop` to equal the controller SHA before dispatch.
