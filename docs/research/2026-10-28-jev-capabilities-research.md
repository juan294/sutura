# Jev capabilities and Sutura's existing decision pipeline

Date: 2026-10-28. Repository: Sutura. Branch: `develop`. Baseline: `969bd68b08c973c3a16f00bb2b67dc19c6300a6d`. Workspace: `/Users/juan/code/sutura`; initially clean. Scope: read-only source and public documentation research, followed by the separately requested [assessment](2026-10-28-jev-opportunities-assessment.md). No implementation or live inference was performed.

## Answer

Sutura already integrates Jev as an optional semantic audit veto. Its current adapter implements Choice and Noul, while current TypeSafe documentation also describes Score and experimental image/Box support. The existing diagnosis, search ranking and developer evidence paths contain other bounded judgments, but they do not currently consume Jev. Documentation establishes possible interfaces, not improved Sutura outcomes.

## Current implementation

| Area | Source observation |
| --- | --- |
| Provider | Direct HTTP client uses `jev-latest`, USD 0.042/M input tokens, free output, and a 32,000-token reservation with September price provenance. Choice and Noul are supported; Score is explicitly omitted (`packages/core/src/llm/typesafe.ts:11-49`). |
| Audit questions | One shared-state call asks a legitimacy Choice and four Nouls about tests-only edits, weakened assertions, suppressed errors and unrelated changes (`packages/core/src/audit/typesafe-audit.ts:43-83`). |
| Decision | Confidence below 0.7 yields uncertain; otherwise green-wash probability at least 0.5 yields refused. Four Noul values are recorded but do not decide status (`packages/core/src/audit/typesafe-audit.ts:107-141`). |
| Authority | Policy, mechanical checks, visible execution, fresh suite and challenges precede adjudication. Nemotron, Astra and Jev are awaited sequentially. Acceptance requires the primary approval and no optional veto (`packages/core/src/verification/runtime.ts:69-126`). |
| Recovery | Missing configuration, oversized context, budget or provider errors yield skipped with a reason. Uncertain/skipped do not veto; the other gates decide (`packages/core/src/audit/typesafe-audit.ts:164-187`, `packages/core/src/audit/veto-voices.ts:19-37`). |
| Visibility | Evidence includes model, status, probability and all four signals. The Markdown check column renders the underlying boolean as PASS/FAIL alongside that evidence (`packages/core/src/audit/typesafe-audit.ts:151-155`, `packages/core/src/report/markdown.ts:78-96`). A non-veto row is therefore not proof that Jev completed an affirmative review. |
| Input bounds | Redacted diagnosis, complete diff, logs, executed command/status and challenge evidence form the state. Oversized whole context is rejected rather than cutting the diff (`packages/core/src/audit/adjudicate.ts:49-100`). |
| Evidence | Resolved model, distributions, usage, latency and request ID enter trace events (`packages/core/src/heal.ts:391-415`); ledger records resolved model (`packages/core/src/llm/typesafe.ts:307-338`). Replay constructs the optional client when recorded exchanges exist (`packages/core/src/replay/replay-orchestrate.ts:133-145`). |
| Classification | Mechanical signatures supply a class and formula-based confidence; a generative classifier returns structured diagnosis. Command and evidence agreement constrain its result (`packages/core/src/diagnose/classify.ts:145-155`, `:224-307`). |
| Model routing | Code selects tiers using purpose, confidence, targets, feedback, context and budget. Audit stays Ultra; routing cannot change authority or consume mandatory audit reserves (`packages/core/src/llm/routing-policy.ts:88-137`). |
| Search | Branch ordering uses policy validity, passing state, changed-file state, normalized output-line count, diff size, files, cost and time. The next frontier keeps the top beam (`packages/core/src/engine/search-score.ts:16-36`, `packages/core/src/engine/fingerprint.ts:26-31`, `packages/core/src/engine/search.ts:267-276`). |

The adopted Jev decision reserves model-routing changes and new measurements for separately evidenced work (`docs/decisions/2026-09-17-calibrated-audit-veto.md:62-75`). Automatic hosted CI routing is a different system: protected source and event identity determine verification amount, and provider/publication authority remains separate (`docs/ci-routing.md:3-17`).

## External facts, retrieved 2026-10-28

TypeSafe's [primitives](https://docs.typesafe.ai/primitives) provide closed-set selection, yes/no probabilities, ordered scores and image localization. These are structured judgments; they do not generate repairs. [State design](https://docs.typesafe.ai/concepts/state) and [building guidance](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) put decision logic in application code.

The [model catalog](https://docs.typesafe.ai/models) lists Jev 1.14.0, released October 14, as the current stable alias target, priced at USD 0.042/M input tokens. Default limits are 64k per request and 32k per question. An opt-in 262k mode is described as slower and less accurate. Aliases can move; returned model IDs identify the answering version. Organization quotas require account-specific inspection.

[Confidence](https://docs.typesafe.ai/confidence) is derived from the answer distribution, not an independent correctness certificate. Noul returns the yes probability without a separate confidence field. Application thresholds require domain evaluation. [Fan-out](https://docs.typesafe.ai/patterns/fan-out) evaluates shared-state questions in parallel; each must contain enough context to stand independently.

[Images](https://docs.typesafe.ai/images) and [Box](https://docs.typesafe.ai/primitives/box) are explicitly experimental and require an opt-in header. The model overview still labels input as text; image-specific documentation describes the exception, not a mature production guarantee. The [jaggedness document](https://docs.typesafe.ai/model-jaggedness/jev-1.13), reviewed October 2, applies specifically to 1.13: literal interpretation, indirection, irrelevant context, adversarial content, option ordering and numerical precision are listed weaknesses. It does not establish their incidence or resolution in 1.14.

## Additional decision and developer surfaces

Reproduction precedes semantic classification (`packages/core/src/heal.ts:1098-1116`), so changing the classifier cannot avoid the initial sandbox work at that insertion point. Flake triage uses observed executions and failure identity, with full-command recovery when focused probes mismatch (`packages/core/src/engine/triage.ts:52-96`, `:185-201`, `:239-295`).

Grounding searches selected classes, adds registry-verified release URLs and has a 403 extraction fallback; the inspected path has no semantic passage-ranking stage (`packages/core/src/diagnose/tavily.ts:460-554`). Recovery hypotheses already have a constrained vocabulary: supplied source/signal indices, three intents and controller-defined probes. Deterministic selection runs where possible; model proposals cannot grant authority (`packages/core/src/diagnose/hypotheses.ts:55-86`, `:165-245`). Their dispositions are visible in recovery summaries (`packages/core/src/report/recovery-summary.ts:4-14`).

Static adoption assessment deliberately avoids credential reads and provider calls (`packages/cli/src/assess.ts:47-48`). It starts with unknown support and unmeasured readiness, and static evidence can establish only candidate support (`packages/core/src/incidents/assess.ts:82-121`, `:204-207`). Existing reports already expose costs, policy/runtime identity and typed recovery actions (`packages/core/src/report/markdown.ts:123-140`, `packages/core/src/report/terminal-recovery.ts:6-19`).

## Existing measurements and limits

The September probe reports 84/88 raw classifications correct. Under the adopted veto policy, 28 of 31 traps were refused, two were uncertain and one was approved; none of 57 legitimate repairs was refused (`docs/research/2026-09-17-typesafe-jev-fit.md:315-337`). Its small synthetic, single-run scope is explicit (`:371-375`). It does not establish current-model calibration. Its later success wording must not override those actual counts.

The retained v0.4.1 release benchmark measured a different commit, `3b6152d9d72beebd7dcbaaa4045c94d640456adb`: 14/18 repairs, 17/19 traps, zero observed false approvals, and Tavily 0/4 versus 2/4 without grounding. Recorded total cost was USD 4.99103270, including USD 4.28525470 sandbox and USD 0.705778 inference; median evaluation was 75.56 seconds (`docs/demo/sutura-v0.4.1-release-benchmark-evidence.md:9-44`). These are retained measurements, not tests run on this research baseline and not a Jev ablation.

## Handoff and coverage

The parent queried local Graphify before tracing source, then verified material findings in source. Independent read-only assignments covered existing Jev integration, the wider decision pipeline, and the complete public documentation index. Raw downloaded documentation remains under `/tmp/sutura-jev-docs`; curated external coverage is recorded in the [source catalog](2026-10-28-jev-source-catalog.md). No private fleet data was sent to TypeSafe. The console browser host was unavailable; account quotas, entitlement and current usage remain unverified. No live inference, deployment, workflow dispatch, tests or product changes occurred. Source/test inspection is not a fresh test pass.

Next-phase work must revalidate HEAD, dirty state, model versions and cited source locations. The authorized deliverable ends at research and assessment. Implementation, revised decision policy and paid comparative experiments require their own accepted scope; existing approval and verification boundaries remain intact.
