# Sutura hackathon improvement plan notes

## Deviations

### Additional executor contract files

- Plan said: Modify the listed executor, orchestration, model-boundary, documentation, and matching test files.
- Found: `packages/core/src/executor/live-setup.ts` performs the opt-in live Git installation, and `packages/core/src/index.ts` exports the public executor contract. Action and CLI integration tests also depend on executor call order.
- Chose: Update `live-setup.ts`, the package-root exports, and matching core, CLI, and action tests. Rebuild the checked-in action bundle.
- Why: A disabled-by-default network field makes the live installer fail unless it opts in. New public snapshot types must be available from the package root. Runtime and integration fixtures must exercise the two-stage contract.

### Live tooling network boundary

- Plan said: Only dependency preparation sends `networking.enabled=true`.
- Found: The opt-in live ConTree test helper installs Git with `apt-get`, which also requires networking. Production orchestration does not call this helper and instead verifies Git inside the imported base before installation.
- Chose: Keep the helper explicit with `network: "enabled"` and document it as live test activation outside the source-preparation flow.
- Why: Hiding the network requirement would make the live helper misleading. The runtime contract still has one network-enabled stage, and the live test remains gated by `SUTURA_LIVE=1` and provider authorization.

### GitHub report boundary

- Plan said: Apply shared redaction before every Token Factory or Tavily request. The cross-phase rule also covers every Sutura-owned external message.
- Found: GitHub reports contain model-derived diagnosis, citations, rationale, audit reasoning, and the exact candidate diff. Rewriting the selected diff at report time could make evidence differ from the patch that was tested and published.
- Chose: Redact or reject all repository-derived text before model and Tavily requests, including retry messages, and preserve the exact tested candidate at the GitHub evidence boundary.
- Why: Actual source secrets cannot enter candidate generation through an editable excerpt that matches the redactor. Preserving the tested diff keeps publication evidence exact. GitHub output remains governed by repository access and artifact retention.

### External package registry boundary

- Plan said: Document GitHub, Token Factory, Tavily, and ConTree data flows.
- Found: Manifest-only dependency preparation also sends package coordinates and lockfile resolution data to public package registries.
- Chose: Add package registries to the data-boundary contract and refuse credential-bearing private registry configuration.
- Why: This is an external data flow and must be visible to private-repository maintainers.

### Phase 2: Token Factory protocol foundation

- Plan said: Parse Token Factory capacity headers and use `Retry-After` within one bounded retry deadline, but did not specify header names or numeric bounds.
- Found: The Token Factory rate-limit documentation names the OpenAI-compatible `x-ratelimit-remaining-*`, `x-ratelimit-reset-*`, `x-ratelimit-dynamic-scale-*`, `x-ratelimit-dynamic-period-usage-*`, and `Retry-After` headers. It defines `Retry-After` as seconds. It does not define client-side sanitization ceilings or a total retry deadline.
- Chose: Parse only unsigned decimal seconds, not HTTP dates or exponent notation. Limit `Retry-After` to 30 seconds and all retries to one 30-second deadline. Limit reset values to 86,400 seconds, scale values to 100, usage values to 100 percent, remaining counts to safe integers, and `x-request-id` to 1-128 characters from `[A-Za-z0-9._:-]`. Invalid values become `null` and never control a wait.
- Why: These limits accept the documented Token Factory values while malformed or excessive headers cannot cause an unbounded wait.

- Plan said: Validate tool call IDs, names, argument strings, and array bounds, but did not specify exact limits.
- Found: OpenAI-compatible function names use 1-64 alphanumeric, underscore, or hyphen characters, and tool definitions permit up to 128 functions. The response contract does not provide a smaller tool-call bound.
- Chose: Accept at most 128 tool calls; accept IDs with 1-128 alphanumeric, underscore, or hyphen characters; accept function names with 1-64 of those characters; and accept at most 1,000,000 argument characters that parse as a JSON object.
- Why: The limits match the documented request scale, reject malformed response shapes, and cap parser work before the repair agent receives data.

- Plan said: Return parsed tool calls beside optional text and keep existing text-only callers compatible.
- Found: Existing callers require `text: string` and are outside the Phase 2 file boundary.
- Chose: Keep `text` as a string and return an empty string for a valid tool-only response. Preserve provider `content: null` in `raw` and return parsed calls in `toolCalls`.
- Why: This preserves all text-only caller types while retaining the exact provider content state for tool-aware callers.
