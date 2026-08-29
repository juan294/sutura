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

### Phase 3: Additional compatibility files

- Plan said: Modify the listed core, action, CLI, and report files for repository policy and stage evidence.
- Found: Pull-request base ref and SHA originate in `packages/action/src/octokit.ts`; terminal case files are built in `packages/cli/src/cli.ts`; and Placebo adapters construct and validate `CaseFile` values.
- Chose: Update those files and their matching tests in addition to the Phase 3 file list.
- Why: Exact-base policy binding and the stage-ledger contract cannot remain type-safe or executable if any constructor drops the new evidence.

### Phase 3: Default policy and required-command grammar

- Plan said: Use safe defaults when `.sutura.json` is absent and reject unsafe required commands, but did not define either contract completely.
- Found: Resource comparisons need a named required command, and accepting shell metacharacters would let repository policy create a second command language.
- Chose: Default to `allowedPaths: ["**"]`, protected `.sutura.json`, no denied reads or required commands, 65,536 diff bytes, and eight changed files. Accept only bounded space-separated command text made from alphanumeric characters and `@%_./:=+,-`; reject repeated whitespace and require at least one command when resource thresholds exist.
- Why: The defaults preserve current repositories while policy commands remain a small enumerated input that cannot add shell control operators.

### Phase 4: Worst-case model reservation

- Plan said: Reserve the worst-case model cost before every repair-agent request, but did not specify a request-cost ceiling.
- Found: Super repair turns allow up to 8,192 completion tokens and carry bounded source and tool evidence through an OpenAI-compatible model context.
- Chose: Atomically reserve a request-specific worst case from the serialized request bytes, full tool schema, 8,192 completion tokens, and documented Super prices, with a conservative $0.05 floor. Settle the reservation to the provider-reported actual cost and reject a response whose reported cost exceeds its reservation.
- Why: The reservation covers the configured request envelope at the documented Super prices while the separate $0.25 run budget remains fail-closed under concurrent requests.

### Phase 5: ConTree concurrency and total-work limits

- Plan said: Use Token Factory remaining capacity and ConTree operation limits before expansion, with at most 12 total branches.
- Found: `SUTURA_MAX_OPS` and `ContreeExecutorConfig.maxOps` control concurrent instance work through `p-limit`; they do not cap total operations. The Phase 4 branch default of four would also consume the complete budget at the first search depth.
- Chose: Preserve `maxOps` as concurrency, add a separate public operation-capacity snapshot plus cancellation ID/method, retain the sandbox-operation budget as the total-operation ceiling, and raise the hard lower-only branch maximum to 12. Search has independent 4/2/4/12 settings, and all 12 include initial and expanded branches globally.
- Why: Reusing `maxOps` as a total limit would silently change an existing public contract. Separate limits let the search authorize each expansion from current concurrency capacity without permitting cancellation to create replacement work beyond the original global budgets.

### Phase 5: Direct repair compatibility

- Plan said: Keep the fixed race only as an internal evaluation profile and expose one production search algorithm.
- Found: Direct `healCase` callers and existing offline adapters still supply `raceK` but do not have an action or CLI configuration loader.
- Chose: Production action and CLI paths always pass the adaptive search settings. A direct legacy caller without explicit search settings translates `raceK` only into the initial adaptive width; it still runs beam search and does not select a second algorithm.
- Why: This preserves source compatibility without exposing the old fixed race as a production choice.

### Phase 6: Singular ATIF trajectories

- Plan said: Export a manifest with `cases[]` to one ATIF output path.
- Found: NVIDIA `Trajectory.model_validate_json` validates one root trajectory, not an array or unrelated cases embedded as subagents.
- Chose: Write the requested path for one case. For multiple cases, write stable indexed sibling `.atif.json` files, one per case, after preflighting every path.
- Why: Each file remains independently valid ATIF v1.7, and an output collision cannot create a partial multi-case export unless `--force` is explicit.

### Phase 6: Pinned validator tool

- Plan said: Pin `uv==0.12.7` while the host can have an older `uv`.
- Found: The user-installed `uv` is outside repository control, and replacing it would mutate a global tool.
- Chose: Set `required-version = "==0.12.7"`, commit the exact NeMo Git lock, and provision `uv 0.12.7` in a temporary directory for validation. Keep the project `.venv` ignored.
- Why: The exact validator is reproducible without changing user-global tools or committing an environment.

### Phase 6: Production trace handoff

- Plan said: Modify tracing inside `heal.ts` and the listed model, repair, search, CLI, and Placebo files.
- Found: GitHub Action orchestration creates its stage ledger before it calls `repairFailure`.
- Chose: Create the recorder with that production ledger in `orchestrate.ts` and pass it through every early and repair outcome.
- Why: Attaching the recorder only inside `repairFailure` would omit preparation and reproduction events from production traces.

### Phase 7: Routed reservation and integration files

- Plan said: Route model roles from measured profiles and reserve the worst-case repair request cost before inference.
- Found: The existing repair reservation used the static Super price before the provider resolved a routed model. The listed Phase 7 files also omitted the shared LLM option types, diagnosis and audit callers, and Placebo adapters and harness that construct or validate the affected contracts.
- Chose: Resolve and quote the routed Super model before reserving its worst-case request, pass the bounded routing context through diagnosis, repair, and audit, and update the omitted shared types, adapters, harness, fixtures, and tests. A missing repair quote fails closed; it does not use a static compatibility price.
- Why: A static reservation could understate a selected model's price. Every producer and validator must preserve the same role, actual model, and progressive-triage evidence.

### Phase 7: Live selection gate

- Plan said: Compare four Nemotron candidates, verify prices against the live Token Factory catalog, and publish the selected profile.
- Found: This implementation phase prohibits live model-role ablation and catalog calls. Local data cannot establish current price or production quality.
- Chose: Ship deterministic ablation, hashing, validation, scoring, and selection machinery while retaining `production-baseline-v1`. Require a complete 3-role by 4-model matrix with identical unique case sets and matching prompt, schema, tool, and budget profile IDs. Also require one internally consistent verified catalog snapshot, token-derived cost reconciliation, and a valid result hash before a profile is eligible. Record the live ablation and price verification as pending.
- Why: Incomplete, stale, or internally inconsistent evidence must not change production defaults.

### Phase 7: Progressive triage compatibility

- Plan said: Treat `SUTURA_TRIAGE_N` as a maximum and stop early on strong all-pass or all-failure evidence.
- Found: Placebo and orchestration fixtures encoded the old fixed five-run operation count, while public consumers still need the existing `status`, `reproduced`, and `of` fields.
- Chose: Run strict SPRT checks after batches of two, run an odd final attempt only when needed, preserve the three compatibility fields, and add versioned probability, Wilson interval, stop-reason, and attempt evidence. Publish Placebo operations saved against the fixed-five baseline.
- Why: The new method reduces work without letting a mixed sequence stop early or authorizing an additional unsafe repair attempt.
