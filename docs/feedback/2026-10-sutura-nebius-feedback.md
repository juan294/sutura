# Sutura feedback for Nebius and NVIDIA

Written 2026-10-07 for the Nebius x NVIDIA Global AI Hackathon submission. Each
observation names the retained run, record, or test it comes from. Statements about
service behavior are dated: they describe what we saw on that day, not the current
state of the service.

## What we used each service for

| Service | What Sutura uses it for | Evidence |
| --- | --- | --- |
| Nebius Token Factory, NVIDIA Nemotron 3 Nano 30B | Diagnoses the failed CI run from bounded evidence | `DEFAULT_MODELS` in [`config.ts`](../../packages/core/src/config.ts#L10); the recorded v0.3.9 benchmark |
| Token Factory, Nemotron 3 Super 120B | Proposes bounded repairs for a source excerpt the controller selects | same |
| Token Factory, Nemotron 3 Ultra 550B | Audits the cleanly rerun candidate for shortcuts that static checks miss | same |
| Nebius ConTree sandboxes | Prepares dependencies once, snapshots the filesystem, and branches isolated triage, search, and audit sandboxes with the network off | [v0.3.9 benchmark evidence](../demo/sutura-v0.3.9-release-benchmark-evidence.md) |
| Nebius Data Lab | Prepared only: a sanitized 110-row dataset and an upload request exist, but we have not uploaded or run a batch, so we have no service feedback beyond the documentation request below | [Data Lab evidence](../datalab/README.md) |
| NVIDIA ATIF and NeMo Agent Toolkit | Sutura exports sanitized agent trajectories in the ATIF shape and validates them offline with the toolkit; it is not the live orchestrator | [ATIF report](../evaluation/nemo-atif-report.json) |

## What worked well

- **One endpoint, three model sizes.** Token Factory's OpenAI-compatible endpoint let us
  give Nano, Super, and Ultra separate jobs and record the requested role next to the
  actual model ID and price for every call. Across the 55 evaluations in the v0.3.9
  release benchmark, recorded inference cost was USD 0.645343. Total recorded cost,
  including ConTree sandboxes, was USD 4.92427699.
- **End-to-end result with all three roles.** On the v0.3.9 release commit, Sutura fixed
  14 of 18 repairable cases, recognized 10 of 10 flaky cases, and approved no deceptive
  patch. [Every failure is listed](../demo/sutura-v0.3.9-release-benchmark-evidence.md).
  This is the pipeline's result, not a measure of any one model.
- **ConTree branching fits repair search.** One prepared snapshot fed independent
  reproduction, repair, and audit branches, which is the isolation the product depends
  on. The v0.3.9 benchmark ran all 51 cases in about three hours with no `infra-stop`.
- **Request IDs.** Stored traces keep bounded provider request IDs, which let us line up
  a failed call with a retained run.

## Onboarding: zero to hello world

- **Token Factory: under 15 minutes** from a new account to a working Nemotron call.
  The one snag was model naming. On 2026-08-27 the console listed
  `Nemotron-3.5-Lightning` while the API ID is `nvidia/Nemotron-3_5-Lightning`, and the
  hyphenated name returned HTTP 404 with "model does not exist". Showing the exact API
  ID beside each console model name would remove that snag.
- **ConTree: access approved the same day** we requested beta access, and the SDK was
  easy to set up.

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

## Observed live integration problems

- Token Factory `response_format: json_schema` dropped characters from model output.
  The provider canary passed on 2026-09-15 and failed from 2026-09-16 on the same code.
  With the canary's exact request, the output lost the escape backslash
  (`{n  return left + right;n}` instead of newline escapes) at temperature 0 and 1, and
  lost its line breaks with `strict: false`. Ultra and Nano returned single-line output.
  `json_object` and no `response_format` returned correct output, and the Nebius status
  page listed no incident. Until we moved to `json_object` with local validation, every
  live repair on Nemotron produced corrupted replacements. Raw request and response
  bodies are in the [drift record](../demo/nebius-json-schema-drift-2026-09-16.md). We
  rechecked on 2026-10-07 with the same request: it still reproduces, with the
  `json_schema` output on one line and `json_object` correct (one sample each, request
  IDs in the record).
- ConTree import of a pinned `ghcr.io/astral-sh/uv` image digest returned HTTP
  404. The affected Python cases stopped as infrastructure outcomes
  before source execution. Follow-up probes showed that ConTree accepted a
  versioned Docker Hub tag while OCI digest imports through the tested paths
  failed. The repository therefore verifies the tag's resolved platform digest
  before use. The retained account is in the
  [v0.2.1 remediation record](../plans/2026-09-01-sutura-v0.2.1-evidence-remediation.md).
- In the 2026-09-30 release benchmark, a ConTree operation-status request
  (`GET …/sandboxes/v1/operations/…`) returned HTTP 500 during sandbox preparation, and
  one Nemotron Nano diagnosis request failed before any sandbox work. Both cases ended as
  `infra-stop`. The ConTree operation had started, so its true cost was unknown and we
  settled the reservation at an upper-bound estimate of USD 0.180792. Sutura's own
  classifier discarded the Nano error text, so we cannot say what the provider returned.
  The [v0.3.4 evidence](../demo/sutura-v0.3.4-release-benchmark-evidence.md) records both.
- Tavily returned HTTP 403 on the `upstream-retry-release` search after the
  preceding upstream cases returned citations with the same candidate and
  credential. Sutura surfaced `infra-stop` and did not treat an ungrounded
  repair as success. The run identity and paired no-Tavily outcome are recorded
  in the [WS-4 research](../research/2026-09-04-sutura-ws4-evidence-submission.md).
- Live Nemotron Super calls returned invalid JSON and schema-incompatible
  repair proposals. Some responses were truncated at the provider completion
  boundary; others contained fields outside the controller-owned replacement
  contract. Sutura rejected those responses before sandbox mutation and added
  deterministic replay coverage from the retained runs.
- The coding-agent request initially omitted the model-card-recommended
  `force_nonempty_content` chat-template argument. Sutura now sends
  `force_nonempty_content: true` with thinking disabled and verifies the exact
  request through replay and provider-canary contracts. The change and its
  fallback boundary are recorded in the
  [search-recovery plan](../plans/2026-09-03-sutura-search-recovery.md).
- A small number of Super calls entered degenerate completion-limit loops and
  consumed the configured completion envelope without producing a usable
  replacement. The first stop rule ended the whole adaptive search even when
  sibling branches held applied patches. The controller now keeps that terminal
  local to the runaway branch unless completion limits outnumber productive
  proposals, as documented in the
  [branch-local completion record](../plans/2026-09-04-sutura-completion-limit-branch-local.md).

## Requested features

- Publish versioned JavaScript SDK and OpenAPI schemas for ConTree operations,
  cancellation, errors, and capacity fields.
- Let a client query the cost of a ConTree operation that failed or whose status request
  errored, so an interrupted run can settle its spend exactly instead of estimating it.
- Expose image deletion, retention, network-policy, cold-start, branch-latency,
  cancellation, and resource metrics through stable typed fields.
- Publish model metadata and prices as a versioned, hashable catalog snapshot, and show
  the API model ID next to each model name in the console.
- Provide consistent request IDs, rate-limit headers, error classes, and retry
  guidance for parallel function-calling workloads.
- Document function-calling and JSON Schema conformance by model, including how
  `response_format: json_schema` treats string escapes, and announce changes to it.
- Document GitHub OIDC or another short-lived credential flow if supported.
- Document Data Lab redaction, upload, retention, and Zero Data Retention behavior.
- Provide a versioned public compatibility matrix for ConTree image references,
  including registry, tag, OCI index digest, and platform manifest behavior.

## Proposed impact

These features would reduce custom validation code, make cost and latency
evidence reproducible, improve recovery from partial failures, and let a CI
repair system use shorter-lived credentials. The observations above are
retained failures, not estimates of general service reliability. The requests
are proposed product improvements rather than claims about undocumented
capabilities.

## Would we build with them again

- **Token Factory and the Nemotron models: yes.** One OpenAI-compatible endpoint with
  Nano, Super, and Ultra let us assign roles by model size, and the recorded inference
  cost of a 51-case benchmark stayed under one US dollar. The problems we hit were
  fixable on our side and are listed above with their evidence.
- **ConTree: yes.** Snapshot-and-branch sandboxes are the core of how Sutura verifies a
  repair. We would build on it again and ask mainly for typed errors, cost visibility on
  failed operations, and stable image-reference behavior.
