# Sutura two-month opportunity research

Date: 2026-08-28

Status: Research complete

Deadline: 2026-10-30 at 10:00 PT

## Research question

How can Sutura create more developer value and use Nebius Token Factory more deeply before submission?

This document separates verified facts, reasoned findings, and proposed work.

The repository workflow normally limits research to existing behavior. The request explicitly includes research-backed product ideas.

## Executive finding

Automatic CI repair is now a competitive category. GitHub, GitLab, and Harness already diagnose or repair failed pipelines.

Sutura has a more useful position: it verifies whether a green repair is trustworthy.

The strongest product loop has five parts:

1. Establish whether the failure is real.
2. Explore repairs through bounded tools.
3. Compare repairs on independent ConTree branches.
4. Challenge the surviving repair with deterministic checks and an independent model.
5. Publish evidence that a reviewer can inspect.

Sutura already implements this outline. Its measured repair rate remains the largest functional gap.

Placebo v0.1 fixes 6/10 repairable cases. It refuses 8/8 traps with zero false approvals.

The best next investment is an interactive repair agent. It should use Token Factory function calls inside ConTree.

The second investment is adaptive branch search. It should replace one-shot candidate generation with measured exploration.

The third investment is a repeatable evaluation system. Data Lab, ATIF, and NeMo can support it.

Two urgent issues come before new intelligence. The public demo is not self-service, and all ConTree runs allow network access.

## Current product baseline

### Implemented behavior

- The action handles failed pull request, push, schedule, and manual runs (`README.md:138-142`).
- Nano classifies failures, Super proposes repairs, and Ultra audits the winner (`README.md:53-59`).
- ConTree runs repeated triage, candidate races, and a clean audit branch (`README.md:20-39`).
- Sutura rejects common test, type, and lint weakening patterns (`README.md:42-46`).
- Sutura opens a repair pull request only after verification (`README.md:100-104`).
- Each repository supplies its own provider keys and pays its own usage (`README.md:106-136`).
- Sutura never merges a generated repair (`README.md:140-142`).

### Measured evidence

The current Placebo record uses Sutura commit `478684646ee1e4ccb56fdd8260c6fe01bc4c0158`.

| Measure | Result |
| --- | ---: |
| Placebos refused | 8/8 |
| False approvals | 0 |
| Repairable cases fixed | 6/10 |
| Flaky cases identified | 4/4 |
| Upstream cases fixed with Tavily | 4/4 |
| Upstream cases fixed without Tavily | 0/4 |
| Inference cost | $0.098730 across 30 evaluations |

Source: `docs/demo/placebo-v0.1-2026-08-28.md:1-39`.

The four failed repairs cover ESM extensions, cache invalidation, missing `await`, and TypeScript configuration drift.

ConTree activation also has live evidence:

- A full dependency installation and test run completes in 343.087 seconds.
- Nine branches from one image complete successfully in 2.418 seconds.
- The live verification covers five triage runs, three candidates, and one audit.

Source: `docs/research/2026-08-27-contree-activation.md:17-26`.

### Current technical limits

The current LLM client calls only `/chat/completions` (`packages/core/src/llm/nebius.ts:90-92`).

It accepts only `json_object` responses (`packages/core/src/llm/nebius.ts:13-18`).

It retries throttling and server errors with local jitter (`packages/core/src/llm/nebius.ts:188-224`).

It does not use `Retry-After` or Token Factory rate headers.

Super returns all candidates in one response (`packages/core/src/engine/repair.ts:335-358`).

The race runs only the extracted failing command (`packages/core/src/engine/repair.ts:425-458`).

The smallest passing diff wins (`packages/core/src/engine/repair.ts:461-476`).

Triage uses a fixed repetition count. It labels zero failures as flaky (`packages/core/src/engine/triage.ts:8-31`).

ConTree reports cost, time, memory, and CPU metrics (`packages/core/src/executor/types.ts:10-24`).

The current public evidence does not surface those sandbox metrics.

Every ConTree command enables networking (`packages/core/src/executor/contree.ts:73-85`, `packages/core/src/executor/contree.ts:189-204`).

## Nebius capability map

### Token Factory inference

Token Factory supports OpenAI-compatible chat completion, tool calling, JSON mode, and JSON Schema.

Official sources:

- [Function calling](https://docs.tokenfactory.nebius.com/ai-models-inference/function-calling)
- [Structured JSON output](https://docs.tokenfactory.nebius.com/ai-models-inference/json)
- [Rate limits and scaling](https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits)
- [Model catalog](https://docs.tokenfactory.nebius.com/api-reference/models/list-models)

The live account listed 30 models on 2026-08-28. Seven models used NVIDIA identifiers.

The current Sutura models remain available:

| Role | Model | Serverless context | Input price | Output price |
| --- | --- | ---: | ---: | ---: |
| Diagnosis | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | 262,144 | $0.06/M | $0.24/M |
| Repair | `nvidia/nemotron-3-super-120b-a12b` | 262,144 | $0.30/M | $0.90/M |
| Audit | `nvidia/Nemotron-3-Ultra-550b-a55b` | 1,048,576 | $1.00/M | $3.00/M |

`nvidia/Nemotron-3_5-Lightning` also has a 1,048,576 context limit.

Lightning has Nano pricing, tool support, reasoning support, 400,000 TPM, and 600 RPM.

These values came from the live Token Factory verbose model endpoint on 2026-08-28.

### Live inference probes

A live Nano function call returned HTTP 200 on 2026-08-28.

The model selected `read_file` and supplied `{"path":"src/example.ts"}`.

The response used 282 prompt tokens and 103 completion tokens.

A live Nano JSON Schema call also returned HTTP 200.

It returned `{"category":"AssertionError","confidence":0.99}` and matched the strict schema.

The response used 36 prompt tokens and 119 completion tokens.

These probes confirm two implementation paths. They do not measure production reliability.

### Dynamic capacity

Token Factory returns request and token limits through response headers.

It also returns remaining capacity, reset time, scale factors, window usage, and `Retry-After`.

Sutura currently ignores these signals. Adaptive scheduling can reduce avoidable throttling.

Source: [Rate limits and scaling](https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits).

### ConTree Sandboxes

ConTree combines VM isolation with reusable filesystem checkpoints.

It supports branching, parallel exploration, rollback, cancellation, and OCI image imports.

It records CPU time, memory, I/O, cost, and elapsed time for each execution.

The beta permits 50 simultaneous operations. Untagged, unreferenced images can remain for 180 days.

Official sources:

- [ConTree overview](https://docs.tokenfactory.nebius.com/sandboxes/overview)
- [Branching](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/branching)
- [SWE agent environments](https://docs.tokenfactory.nebius.com/sandboxes/swe-agents)
- [Sandbox images API](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/images/add-a-tag-to-an-image)

Nebius provides more than 7,000 SWE environments. The set includes SWE-bench Verified and SWE-rebench environments.

Sutura currently uses ConTree as a remote command runner. It does not yet use a persistent search tree.

### Data Lab

Data Lab can import inference logs, filter records with SQL, and manage evaluation datasets.

Sutura can run controlled comparisons through the inference API. Data Lab can hold sanitized evaluation records.

Zero Data Retention prevents inference log collection. Sutura must make any dataset export explicit and sanitized.

Official sources:

- [Data Lab overview](https://docs.tokenfactory.nebius.com/data-lab/overview)
- [Chat completion imports](https://docs.tokenfactory.nebius.com/data-lab/chat-completions)

### Post-training

Token Factory supports supervised fine-tuning and preference optimization for documented model families.

The published model list does not include NVIDIA or Nemotron models on 2026-08-28.

The earlier design brief proposes Nemotron Nano fine-tuning (`docs/research/2026-08-27-sutura-brief.md:110-119`).

That proposal does not match the current supported model list.

Qwen or GPT-OSS training remains possible. It would weaken the current Nemotron product story.

Source: [Supported post-training models](https://docs.tokenfactory.nebius.com/post-training/models).

### Dedicated endpoints and observability

Dedicated endpoints provide reserved capacity, autoscaling, custom weights, regional control, and operational metrics.

Token Factory Observability includes throughput, latency percentiles, errors, scaling, and cache behavior.

The documented observability metrics apply only to dedicated endpoints.

Sutura does not need dedicated capacity during the current usage stage.

Official sources:

- [Dedicated endpoints](https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/overview)
- [Inference Observability](https://docs.tokenfactory.nebius.com/ai-models-inference/observability)

### Embeddings and reranking

Token Factory exposes `/v1/embeddings` and `/v1/rerank` endpoints.

These endpoints can support retrieval of prior verified failures, repairs, and flake signatures.

This capability needs a strict repository privacy policy before runtime use.

Official API source: [Token Factory OpenAPI](https://api.tokenfactory.nebius.com/openapi.json).

## NVIDIA capability map

### Nemotron roles

Nano targets reasoning, coding, structured output, tool calling, and agent workflows.

Super targets tool use, code work, long context, retrieval, and agent workflows.

Ultra targets difficult reasoning, code analysis, long context, and complex agents.

Primary model sources:

- [Nemotron 3 Nano model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16)
- [Nemotron 3 Super model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16)
- [Nemotron 3 Ultra model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16)

### NeMo Agent Toolkit

NeMo Agent Toolkit evaluates, profiles, and optimizes agent workflows.

Its profiler measures token use, latency, concurrency, bottlenecks, and workflow runtime.

Its optimizer compares prompts and numeric workflow parameters.

ATIF provides an interoperable JSON format for agent trajectories.

Sutura can export ATIF without changing its TypeScript runtime.

Official sources:

- [NeMo Agent Toolkit repository](https://github.com/NVIDIA/NeMo-Agent-Toolkit)
- [Profiler documentation](https://docs.nvidia.com/nemo/agent-toolkit/latest/improve-workflows/profiler.html)
- [ATIF evaluation example](https://github.com/NVIDIA/NeMo-Agent-Toolkit/blob/develop/examples/evaluation_and_profiling/simple_web_query_eval/atif-eval-readme.md)

## Market evidence

### Existing CI repair products

GitHub Copilot can diagnose failed checks and propose CI repairs.

Copilot CLI also supports `/pr fix ci`. The GitHub app can resolve checks and manage pull requests.

Sources:

- [Diagnose CI failures with Copilot](https://docs.github.com/en/copilot/tutorials/copilot-cookbook/debug-errors/diagnose-ci-test-failures)
- [Manage pull requests with Copilot CLI](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-cli/use-copilot-cli/manage-pull-requests)
- [GitHub Copilot coding agent pull requests](https://docs.github.com/en/copilot/how-tos/github-copilot-app/managing-issues-and-pull-requests)

GitLab Duo can inspect failed jobs, diagnose causes, and propose merge requests.

Its documented limits include bounded logs and incomplete package verification.

Source: [GitLab Fix CI/CD Pipeline Flow](https://docs.gitlab.com/user/duo_agent_platform/flows/foundational_flows/fix_pipeline/).

CircleCI reruns failed tests and supports automatic reruns for flaky failures.

This reduces disruption. It does not prove that a code repair preserves test strength.

Sources:

- [Rerun failed tests](https://circleci.com/docs/guides/test/rerun-failed-tests/)
- [Automatic reruns](https://circleci.com/docs/guides/orchestrate/automatic-reruns/)

Harness describes CI Autofix as a loop that reads logs, commits fixes, and repeats failed builds.

Source: [Harness Continuous Integration articles](https://www.harness.io/blog?module-name=Continuous+Integration).

### Competitive conclusion

“AI fixes CI” no longer provides a strong distinction.

Sutura owns a narrower and more defensible question: “Did the agent actually fix the problem?”

The current white space has several connected parts:

- Flake triage happens before repair.
- Independent candidates run from one captured state.
- Passing candidates face deterministic anti-shortcut rules.
- A separate model challenges the surviving patch.
- A public benchmark measures refusals and repair failures.
- The reviewer receives evidence instead of an automatic merge.

### Developer trust evidence

The 2025 Stack Overflow survey reports more distrust than trust in AI output accuracy.

It reports 46 percent distrust and 33 percent trust. Only 3 percent report high trust.

Source: [Stack Overflow 2025 AI survey](https://survey.stackoverflow.co/2025/ai).

DORA reports that AI amplifies existing strengths and weaknesses.

It also identifies a verification burden and downstream pressure on testing, security, and deployment.

Sources:

- [DORA 2025 report](https://dora.dev/research/2025/dora-report/)
- [Balancing AI tensions](https://dora.dev/insights/balancing-ai-tensions/)
- [DORA 2024 generative AI report](https://dora.dev/ai/gen-ai-report/report/)

Google studied flaky tests across 428 projects. Its tool located root causes with 82 percent accuracy.

The study emphasizes workflow integration, simple debugging, and automated correction.

Source: [De-Flake Your Tests](https://research.google/pubs/de-flake-your-tests-automatically-locating-root-causes-of-flaky-tests-in-code-at-google/).

Meta describes probabilistic flake estimates with uncertainty instead of fixed rerun counts.

Source: [Probabilistic flakiness](https://engineering.fb.com/2020/12/10/developer-tools/probabilistic-flakiness/).

## Hackathon fit

The rules give equal weight to technological implementation, design, potential impact, and idea quality.

The Coding and Agentic Engineering track covers agents that write and test code.

The entry must use Token Factory or Nebius AI Cloud at runtime. It must use an NVIDIA open model.

Judges can rely only on the description, images, and video. The video must stay under three minutes.

The rules also request feedback about Nebius tools. Feedback awards consider completeness, viability, and impact.

Source: [Nebius x NVIDIA Global AI Hackathon rules](https://nebiusglobalaihackathon.devpost.com/rules).

This structure rewards visible proof. Hidden architecture cannot carry the entry by itself.

## Immediate blockers

### The judge demo is not self-service

The demo README directs judges to run the `Break me` workflow.

The workflow uses `workflow_dispatch` at commit `4fe313ff2f4779551b48d424ba1fa8bdd5cadee1`.

GitHub requires write access to run a manual workflow.

Most judges therefore cannot use the current trigger without repository access.

Sources:

- [Demo workflow](https://github.com/juan294/sutura-demo/blob/4fe313ff2f4779551b48d424ba1fa8bdd5cadee1/.github/workflows/break-me.yml)
- [GitHub manual workflow documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

The demo also pins Sutura commit `b2ee9e0435b8db235030e25b2c7a350cc83131bc`.

That commit predates the v0.1.1 release commit `ff69e9673add77cb836d41f4ef8f18f1088167cb`.

### Untrusted test code has network access

All current ConTree commands enable networking.

Provider secrets do not enter the sandbox. Repository content still can leave through untrusted test code.

Private repository adoption needs network control, retention disclosure, and a documented threat model.

GitHub also warns against privileged workflows that execute untrusted code.

Source: [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use).

### ConTree beta access limits adoption

External users need ConTree beta approval. The action cannot deliver its full value without that access.

An audit-only entry path can reduce this barrier. Full verified repair should remain ConTree-powered.

## Opportunity scoring

Each score uses a five-point scale. Five is strongest.

The weighted score uses this formula:

`30% developer value + 25% Nebius depth + 20% judge lift + 15% evidence strength + 10% feasibility`

Feasibility scores delivery confidence. A low score means higher delivery risk.

| Opportunity | Developer value | Nebius depth | Judge lift | Evidence | Feasibility | Weighted | Effort |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Tool-calling repair loop | 5 | 5 | 5 | 5 | 3 | 4.80 | High |
| Adaptive ConTree search | 5 | 5 | 5 | 4 | 3 | 4.65 | High |
| Self-service judge demo | 5 | 3 | 5 | 5 | 5 | 4.50 | Low |
| Sandbox resource audit | 4 | 5 | 4 | 5 | 5 | 4.50 | Low |
| Network-isolated execution | 5 | 4 | 4 | 5 | 4 | 4.45 | Medium |
| Evaluation Lab | 4 | 5 | 5 | 5 | 3 | 4.50 | Medium |
| Nemotron routing benchmark | 4 | 5 | 4 | 5 | 4 | 4.40 | Medium |
| Nebius feedback report | 3 | 5 | 4 | 5 | 5 | 4.20 | Low |
| Bayesian flake confidence | 5 | 4 | 4 | 4 | 3 | 4.20 | Medium |
| Repository repair policy | 5 | 3 | 4 | 4 | 4 | 4.05 | Medium |
| ATIF trajectory export | 3 | 4 | 5 | 5 | 4 | 4.05 | Medium |
| Verified failure memory | 5 | 4 | 4 | 3 | 3 | 4.05 | High |
| GitHub Checks interface | 5 | 2 | 4 | 4 | 4 | 3.80 | Medium |
| Python adapter | 5 | 3 | 4 | 4 | 2 | 3.85 | High |
| Audit-only mode | 5 | 2 | 4 | 3 | 3 | 3.55 | Medium |

The weighted score informs priority. Dependencies and security still govern sequence.

## Detailed opportunity backlog

### 1. Build a bounded tool-calling repair loop

Replace one-shot candidate generation with a controlled agent loop.

Expose a small tool set:

- `read_file`
- `search_repo`
- `run_test`
- `apply_patch`
- `inspect_diff`
- `submit_candidate`

Run every tool inside a ConTree branch. Keep file boundaries and operation limits in Sutura.

Token Factory function calling becomes part of the core repair path.

Measure repair rate, token cost, sandbox cost, operation count, and elapsed time.

Compare the loop against the current 6/10 baseline. Keep zero false approvals as the release gate.

### 2. Use adaptive ConTree search

Represent each repair step as a checkpointed state. Branch only from promising states.

A simple beam search can start with four branches. It can retain the two strongest branches after each test.

Later experiments can compare best-first search or Monte Carlo tree search.

The scoring function should combine test progress, diff size, policy compliance, cost, and resource regression.

Stop branches when they repeat errors, exceed budgets, touch protected files, or weaken enforcement.

This uses ConTree as search infrastructure. It demonstrates more depth than parallel command execution.

### 3. Create Sutura Evaluation Lab

Define one versioned record for every Placebo and live dogfood run.

Store prompts, model identifiers, tool calls, outcomes, costs, latencies, and sanitized evidence.

Export opt-in records to Data Lab. Use controlled inference calls for model, prompt, and router comparisons.

Keep raw repository code and private logs out of shared datasets.

Publish evaluation manifests and result hashes. This makes every improvement reproducible.

### 4. Export ATIF trajectories

Map Sutura model calls, tool calls, sandbox branches, tests, and final outcomes into ATIF.

Use NeMo Agent Toolkit for offline profiling and evaluation.

This creates a direct NVIDIA engineering integration beyond model selection.

It also lets other researchers inspect repair behavior with a standard format.

### 5. Benchmark Nemotron routing

Compare Nano, Lightning, Super, and Ultra for each role.

Lightning deserves an early diagnosis and repair probe. It offers one-million-token context at Nano pricing.

Use an explicit router based on failure class, diagnosis confidence, context size, and remaining budget.

Do not add a model without an ablation. Report quality, cost, latency, and refusal changes.

### 6. Surface sandbox resource evidence

Include ConTree time, CPU, memory, I/O, and reported cost in the case file.

Compare the failing state, candidates, and audited winner.

Reject material regressions when the repository defines a threshold.

This converts an unused Nebius capability into developer evidence with low implementation cost.

### 7. Add progressive flake confidence

Replace fixed `N=5` triage with sequential evidence.

Stop early when evidence strongly supports a stable pass or stable failure.

Continue when results remain uncertain. Report an estimate and uncertainty interval.

Use historical outcomes when the repository enables local failure memory.

Measure accuracy, average reruns, latency, and sandbox operations against fixed triage.

### 8. Add a repository repair policy

Let maintainers define allowed paths, protected files, required commands, diff budgets, and resource thresholds.

Evaluate every candidate against this policy before its race.

Examples include blocking migrations, lockfiles, workflow files, or test changes without explicit permission.

This gives teams predictable control. It also supports regulated and private repositories.

### 9. Build verified failure memory

Fingerprint the failure class, error signature, dependencies, and relevant source structure.

Use Token Factory embeddings and reranking to retrieve prior verified repairs and known flakes.

Keep the index repository-owned. Do not create a central maintainer data store.

Retrieved cases guide search. They do not bypass current tests or audit.

### 10. Improve the GitHub review surface

Publish a GitHub Check Run with annotations, summaries, and links to complete evidence.

Show failure class, triage confidence, tested candidates, policy findings, resource changes, and audit outcome.

Keep comments for durable discussion. Use the check interface for current state and actionable evidence.

Source: [GitHub Checks API](https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28).

### 11. Add audit-only mode

Audit a developer or agent patch against existing CI evidence when ConTree access is unavailable.

This mode cannot make the same isolation or reproduction claims.

Label it clearly as reduced assurance. Keep full verified healing tied to ConTree.

### 12. Add Python support after core search stabilizes

Add Python failure extraction, commands, source selection, and Placebo fixtures.

Use ConTree's preloaded SWE environments for broader evaluation.

Do not start broad language support before JavaScript repair quality improves.

## Demo and external-user improvements

### Safe public trigger

Provide a public page or issue form that accepts only fixed Placebo case identifiers.

The handler should apply strict rate limits, concurrency limits, and repository allowlists.

It must reject arbitrary branches, commands, patches, repositories, and user text.

The public trigger can dispatch a trusted workflow through a GitHub App or protected service identity.

The demo should return stable links for the broken pull request, failed run, Sutura run, and repair result.

### Clean external installation proof

Create a separate test repository under an independent installation path.

Install only with the published npm package or Marketplace action. Avoid a local workspace dependency.

Run `init`, `doctor`, one repair, one flake, one refusal, and one direct-branch failure.

Record setup time and every unclear step. Convert the findings into installer and documentation fixes.

### Privacy and retention contract

Document data sent to Token Factory, Tavily, ConTree, GitHub, and local artifacts.

Document which provider stores each item and which retention control applies.

Enable ConTree networking only during dependency preparation. Disable it during triage, repair, and audit.

Request documented image deletion or short retention support from Nebius.

## Nebius feedback opportunity

The rules request tool feedback. Sutura can provide measured feedback from a demanding agent workflow.

The report should cover these observed areas:

- JavaScript SDK coverage for ConTree.
- API schema publication and versioning.
- Sandbox image deletion and retention controls.
- Network policy controls and audit evidence.
- GitHub OIDC or short-lived Token Factory credentials.
- Rate-limit header behavior under parallel agents.
- Function-calling reliability by Nemotron model.
- JSON Schema reliability by Nemotron model.
- Model metadata stability and price reporting.
- ConTree cold start, branch latency, cancellation, and resource metrics.
- Data Lab redaction and ZDR behavior for code agents.
- Error messages, request identifiers, and recovery guidance.

Nebius AI Cloud documents OIDC federated credentials. Token Factory does not document direct GitHub OIDC integration.

Treat GitHub OIDC as a product request, not an existing capability.

Source: [Nebius federated credentials](https://docs.nebius.com/cli/reference/iam/federated-credentials/create).

## Proposed delivery sequence

This sequence protects security, proof, and demo access before expanding scope.

### Week 1: August 28 to September 3

- Repair the self-service demo path.
- Update the demo action pin.
- Add an independent external installation smoke test.
- Add network controls and a private repository threat model.
- Publish provider data and retention documentation.

Exit evidence: a non-collaborator triggers one fixed demo case and receives stable result links.

### Week 2: September 4 to September 10

- Extend the Token Factory client for tools and JSON Schema.
- Read `Retry-After` and dynamic rate headers.
- Define repair tools, budgets, and repository boundaries.
- Add recorded and live contract tests.

Exit evidence: Nano completes bounded tools and strict schemas through production code.

### Week 3: September 11 to September 17

- Implement the interactive repair loop.
- Run tools only inside ConTree.
- Add branch, token, time, and operation budgets.
- Target the four failed Placebo repair cases.

Exit evidence: Placebo shows a measured repair improvement without a false approval.

### Week 4: September 18 to September 24

- Implement adaptive checkpoint search.
- Compare fixed K=3, beam search, and a single interactive branch.
- Surface branch decisions and resource metrics.
- Add cancellation and capacity-aware scheduling.

Exit evidence: one versioned ablation compares quality, time, operations, and cost.

### Week 5: September 25 to October 1

- Create the Evaluation Lab record format.
- Export sanitized cases to Data Lab.
- Run controlled model and prompt comparisons through Token Factory.
- Export Sutura trajectories as ATIF.

Exit evidence: one reproducible evaluation runs through Nebius and NVIDIA tooling.

### Week 6: October 2 to October 8

- Benchmark Nano, Lightning, Super, and Ultra by role.
- Implement the strongest measured routing policy.
- Add progressive flake confidence.
- Publish flake accuracy and average rerun counts.

Exit evidence: the router and flake policy outperform current defaults on declared measures.

### Week 7: October 9 to October 15

- Release Placebo v0.2 with broader repair and trap cases.
- Add repository policy controls.
- Add GitHub Checks output.
- Run external user tests with unfamiliar repositories.

Exit evidence: public results include failures, cost, latency, and false approvals.

### Week 8: October 16 to October 22

- Complete the Nebius feedback report.
- Finish visual evidence for every judging criterion.
- Freeze the public story and demo sequence.
- Run the complete release and installation matrix locally.

Exit evidence: the submission draft links only to verified, public evidence.

### Final buffer: October 23 to October 30

- Freeze core behavior on October 23.
- Fix only release, security, or demo blockers after the freeze.
- Rerun Placebo on the exact release commit.
- Rehearse the public demo with a non-collaborator account.
- Submit before October 30.

Exit evidence: one release commit supports the package, action, demo, benchmark, video, and submission claims.

## Recommended submission story

Lead with verification, not automatic repair.

Suggested core statement:

> AI agents can make CI pass. Sutura verifies they fixed the problem. It filters flaky failures and rejects unsafe shortcuts. It opens an evidence-backed PR for human review.

Show one honest repair and one refused shortcut. Then show the Placebo score and exact cost.

Name the Nebius machinery during the visible steps:

- Token Factory runs structured Nemotron decisions and tool calls.
- ConTree branches the exact failing state for search and independent verification.
- Data Lab makes model and prompt comparisons reproducible.
- NVIDIA NeMo profiles the agent trajectory through ATIF.

The complete story supports every judging criterion:

| Criterion | Visible evidence |
| --- | --- |
| Technological Implementation | Tool-calling Nemotron agent, adaptive ConTree tree, audit, ATIF evaluation |
| Design | Clear GitHub check, surgical case file, safe public trigger |
| Potential Impact | External installation, measured flake handling, private repository controls |
| Quality of Idea | Placebo-controlled verification and published refusal evidence |

## Work to avoid before submission

- Do not build a fleet dashboard before the public demo works.
- Do not add a generic chatbot.
- Do not enable automatic merge.
- Do not build a general Docker fallback as a main story.
- Do not promise Nemotron fine-tuning with unsupported post-training models.
- Do not add more models without a controlled comparison.
- Do not add GitLab or CircleCI before GitHub works well.
- Do not deploy a dedicated endpoint without measured capacity need.
- Do not add OpenShell or NemoClaw when ConTree already supplies the isolation story.
- Do not collect repository code or logs through maintainer infrastructure.

## Decision gates

Every major experiment needs a baseline, a changed system, and declared measures.

Keep an experiment only when it improves at least one primary measure without breaking a release gate.

Primary measures:

- repair rate
- false approvals
- flake classification accuracy
- median end-to-end time
- inference cost
- sandbox operations
- sandbox cost
- external setup completion

Release gates:

- zero false approvals on the declared Placebo release
- no sandbox access to provider or repository secrets
- network disabled during untrusted test execution
- exact release commit in package, action, demo, and evidence
- complete external installation from public artifacts
- public demo usable without collaborator access

## Final recommendation

Build the next Sutura release around a measured, bounded repair agent.

Use Token Factory tool calls for interaction. Use ConTree checkpoints for adaptive search and independent verification.

Use Data Lab for sanitized experiments. Export ATIF for NVIDIA evaluation.

Finish the safe public demo and network isolation first. These issues currently limit both adoption and judging.

Keep Placebo as the source of truth. Publish every failed repair and preserve zero false approvals.
