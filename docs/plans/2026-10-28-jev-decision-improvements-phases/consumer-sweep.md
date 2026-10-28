# Consumer sweep and implementation coverage

Parent: [plan](../2026-10-28-jev-decision-improvements.md). Source baseline unchanged. This curated inventory is a coverage checklist, not a bulk-edit instruction.

# Jev plan: foundation and audit consumer sweep

Baseline develop 969bd68b08c973c3a16f00bb2b67dc19c6300a6d. Read-only planning; source inspected, tests not run. Three accepted research documents are untracked. No implementation or provider call.

## Concrete contract constraints

- Preserve `AuditVerdict.approved` and `checks[].passed` as control booleans (`packages/core/src/domain.ts:96-104`). Add optional structured audit presentation/provenance metadata; do not replace booleans or parse prose to infer authority. `CaseFile.audit` remains optional (`:161-191`); reduced-assurance `AuditFile.audit` remains required (`:194-203`). Legacy metadata absence must show legacy/not-recorded rather than assert a completed Jev judgment.
- Five renderers own the boolean display: report/markdown.ts:78-96, report/casefile.ts:168-194, report/audit-markdown.ts:4-7, report/audit-casefile.ts:4-5, case-lab/src/render.ts:289-299. `case-lab/src/result.ts:344-352` validates check fields before rendering and must validate any new optional metadata. Rejection selection at render.ts:271-286 must continue to use `passed`, not display status.
- Both runtime verification and reduced-assurance audit call Jev: verification/runtime.ts:103-126 and audit-only.ts:140-182. Veto row composition is centralized in audit/veto-voices.ts:25-37. Keep no-key/error/uncertain optional behavior, Nemotron approval requirement, and reduced-assurance warning.
- Current `TypeSafeDecision` carries resolved model but no requested-model/question-policy provenance (llm/typesafe.ts:65-73). The custom client supports Noul/Choice only (:36-63); use minimal additive types for enabled roles rather than adding experimental Box. Validate finite probabilities, exact expected option keys and distribution before new policy use. Optional metadata permits old deterministic fixtures to stay historical.
- Current model alias is `jev-latest` (llm/typesafe.ts:13), while captured replay requires exact request matching (`replay/replay-fetch.ts:146-155`). Changing the default model/questions without a replay compatibility selector WILL invalidate old exchanges. Retain legacy request/question policy for recordings without new metadata; select explicit version from new replay configuration for new recordings. Never rewrite recorded HTTP or historic benchmark fixtures. No migration is needed if optional configuration absence selects legacy behavior.
- New shared configuration must be included in bundle schema, validation, recording and replay construction. `replay/validate.ts:400-416` admits only known budget keys but tolerates missing entries. Do not let new defaults enable a new live role during old replay. Boundary remains `typesafe` (`replay/bundle.ts:68`), with shared HTTP cursor order preserved.
- Current budgets default to USD .02 for audit independently of inference and second opinion (`engine/repair-budget.ts:16-25`). The recovery allowance forwards audit reserve/settlement (`diagnose/hypotheses-budget.ts:39,219-220`). New semantic roles need separate reservations and snapshot evidence, not hidden audit spending. Changes flow through config, action inputs, both action manifests, CLI, Case Lab dispatch, recording and budget tests. Keep prior limits when no new option supplied.
- Audit traces include requested model on request and resolved model, answers, usage, latency, cost and request ID on response (`heal.ts:391-415`). Add question/policy version without exposing raw state. HTTP recorder already redacts authorization; retain replay support rather than replacing with an SDK by default.
- Standalone TypeSafe client has bounded retries but no total fetch timeout; runtime supplies remaining deadline wrapper (`verification/runtime.ts:113-119`). Foundation timeout behavior must cover standalone audit-only and live client, distinguish failure from answer, propagate cancellation, and test retry exhaustion without live calls.

## Existing executable anchors / required extensions

- `llm/typesafe.test.ts`: sends state/model/questions, resolved-model ledger, request ID, 429/5xx retry, 4xx no retry, exhausted transport error, wrong answer type, missing usage. Extend strict option/distribution validation and deadline/retry cancellation tests.
- `audit/typesafe-audit.test.ts`: threshold boundaries; absent key; transport/parse errors; exhausted cap; oversized context; reservation settlement. Add version/provenance and atomic-signal advisory tests; preserve existing veto policy until independently qualified.
- `verification/runtime.test.ts`: `fails the gate when Nemotron and Astra approve but the calibrated audit refuses`; `passes the gate with the calibrated audit's numbers when Jev is uncertain`; skipped key; primary refusal; fresh-suite failure. Ensure all remain invariant under metadata additions.
- `audit-only.test.ts`: `uses Nano twice and Ultra once and returns reduced assurance`, `filters repository policy denied context before every model boundary`; add explicit optional-status/deadline coverage.
- `report/audit-report.test.ts`: current `renders the unconfigured second-opinion row as a skipped PASS` is an explicit display oracle to change for presentation only. Update both snapshots deliberately, while booleans remain unchanged.
- `report/report.test.ts`: stable Markdown/HTML, nested CaseFile validation, escaping; `case-lab/src/render.test.ts`: all outcome sections, rejection reasons, escaping, missing case file; `case-lab/src/result.test.ts` (if present) covers validator; add skipped/uncertain/refused/completed/legacy-not-recorded matrix across five renderers.
- `replay/replay-orchestrate.test.ts`: replays optional OpenAI and TypeSafe exchanges, and absent exchanges. `replay/record-fetch.test.ts`: strips Authorization. Add old bundle unchanged replay and new versioned config replay. Existing captured fixture and release contracts must keep historic bytes.

## Sweep commands

```sh
rg -l --hidden 'typesafe|TypeSafe|TYPESAFE' .github scripts packages action.yml --glob '!**/dist/**'
```
Matched 59 files.

```sh
rg -l '\.audit\b|AuditVerdict|AuditCheck' packages scripts --glob '!**/dist/**'
```
Matched 40 files.

```sh
rg -l 'check\.passed|audit\.checks' packages/core/src/report packages/case-lab/src packages/action/src packages/cli/src
```
Matched 10 files.

## Every matched file and phase disposition

F = Phase 1 foundation compatibility/config/client/trace/replay; A = Phase 1 audit metadata and presentation; X = inspected/excluded from mutation, with reason. This exhaustive union is a coverage checklist, not permission to edit every file.

| File | Coverage |
| --- | --- |
| `.github/workflows/placebo-live-case.yml` | F review only; existing hosted workflow/secret routing preserved; no hosted activation |
| `action.yml` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/action/action.yml` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/action/src/__fixtures__/captured/33321106629/bundle.json` | F/A compatibility regression; preserve historical captured bytes; regenerate only report snapshots for intentional display changes |
| `packages/action/src/input.test.ts` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/action/src/input.ts` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/action/src/main.test.ts` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/action/src/main.ts` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/action/src/verify-execution.ts` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/case-lab/README.md` | F/A public optional-role and evidence documentation |
| `packages/case-lab/demo/case-lab.yml` | F review only; existing hosted workflow/secret routing preserved; no hosted activation |
| `packages/case-lab/src/__fixtures__/live-36975022285-python-repair-fixed-case-file.json` | F/A compatibility regression; preserve historical captured bytes; regenerate only report snapshots for intentional display changes |
| `packages/case-lab/src/acceptance.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/case-lab/src/cli.ts` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/case-lab/src/dispatcher.test.ts` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/case-lab/src/dispatcher.ts` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/case-lab/src/render.test.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/case-lab/src/render.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/case-lab/src/replay.test.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/case-lab/src/result.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/case-lab/src/site.test.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/cli/src/adoption.ts` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/cli/src/cli.ts` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/cli/src/doctor.ts` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/cli/src/heal.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/cli/src/setup.test.ts` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/cli/src/setup.ts` | Phase 1 compatibility regression; hosted inputs/setup/dispatch remain unchanged; CLI heal wiring alone exposes new local options |
| `packages/core/src/__fixtures__/case-lab/live-37099513192-python-repair-replay.json` | F/A compatibility regression; preserve historical captured bytes; regenerate only report snapshots for intentional display changes |
| `packages/core/src/audit-only.test.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/audit-only.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/audit/audit.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/audit/repository-policy.test.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/audit/repository-policy.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/audit/typesafe-audit.test.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/audit/typesafe-audit.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/audit/veto-voices.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/config.test.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/config.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/counterfactual/evaluate.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/core/src/counterfactual/types.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/core/src/diagnose/hypotheses-budget.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/diagnose/hypotheses.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/core/src/diagnose/recovery.test.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/core/src/domain.test.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/domain.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/engine/repair-budget.test.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/engine/repair-budget.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/engine/reproduction-repair.subprocess.test.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/core/src/engine/verification-allowance.test.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/core/src/heal.test.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/heal.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/index.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/llm/__fixtures__/typesafe-jev-audit-approved.json` | F/A compatibility regression; preserve historical captured bytes; regenerate only report snapshots for intentional display changes |
| `packages/core/src/llm/__fixtures__/typesafe-jev-audit-refused.json` | F/A compatibility regression; preserve historical captured bytes; regenerate only report snapshots for intentional display changes |
| `packages/core/src/llm/typesafe.live.test.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/llm/typesafe.test.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/llm/typesafe.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/orchestrate.test.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/core/src/orchestrate.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/replay/bundle.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/replay/complete-audit-bundle.test-helper.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/replay/manifest.test.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/replay/record-fetch.test.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/replay/record-fetch.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/replay/replay-fetch.test.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/replay/replay-fetch.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/replay/replay-orchestrate.test.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/replay/replay-orchestrate.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/replay/validate.test.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/report/audit-casefile.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/report/audit-markdown.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/report/audit-report.test.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/report/casefile.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/report/markdown.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/report/report.test.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/verification/external.ts` | F; client/config/budget/trace/replay compatibility; audit passthrough preserved |
| `packages/core/src/verification/runtime.test.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/core/src/verification/runtime.ts` | A; additive metadata, preserved authority booleans, presentation/validation tests |
| `packages/placebo/scripts/generate-v02-manifests.mjs` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/placebo/src/adapters.test.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/placebo/src/adapters.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/placebo/src/baseline.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/placebo/src/harness.test.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/placebo/src/recovery-integration.test.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `packages/placebo/src/score.ts` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |
| `scripts/captured-fixtures.test.mjs` | Phase 1 compatibility regression; Phase 2 evaluation wiring only where needed; preserve historical evidence and no live run |
| `scripts/placebo-live.mjs` | Phase 1 compatibility regression; Phase 2 evaluation wiring only where needed; preserve historical evidence and no live run |
| `scripts/release-workflow.test.mjs` | Phase 1 compatibility regression; Phase 2 evaluation wiring only where needed; preserve historical evidence and no live run |
| `scripts/verified-program-evidence.mjs` | X mutation: generic audit consumer/control or unrelated check uses unchanged booleans; full regression coverage retains contract |

## Additional known writers outside string matches

Report snapshot writers are Vitest (`packages/core/src/report/__snapshots__/audit-report.test.ts.snap`, `report.test.ts.snap`); update only intentional display output. Fixture JSON files in `packages/core/src/report/fixtures/` are legacy evidence and need not be migrated. The recorded client helper `packages/core/src/replay/complete-audit-bundle.test-helper.ts` owns synthetic new recordings and must exercise both legacy/default and new explicit question-policy configuration. `scripts/placebo-live.mjs` constructs clients and records live artifacts; update options only as required, never execute from planning. Archived September probe code is historical and excluded from behavioral edits; it is not the new model evaluation oracle.

# Jev planning seams and consumer sweep

Read-only planning, 2026-10-28. HEAD revalidated as `969bd68b08c973c3a16f00bb2b67dc19c6300a6d`. Working tree contains only parent's three research artifacts. Read plan skill, its pseudocode and handoff references, and accepted assessment completely. The attempted `references/plan-contract.md` does not exist and is not referenced by the skill; no required contract is missing. No implementation or test execution.

## Minimal integration surfaces

- Search: add an optional async `rankFrontier(nodes: readonly SearchNode[]): Promise<FrontierJudgment>` hook to `AdaptiveSearchOptions`, called only after terminal filtering at `packages/core/src/engine/search.ts:271-274`. Keep `compareSearchNodes` unchanged as baseline/fallback. The hook returns IDs and bounded semantic evidence, never replacement nodes. Validate exact permutation, no duplicate/foreign IDs. Initially shadow-only: compute suggested order and record it while using old order. For a later accepted tie-break, preserve policy/pass/unpatched priority; only reorder eligible tied prefix groups. Never touch provisional admission at `:151-198` or candidate acceptance at `:268-270`. A callback `onSemanticDecision(record)` transports evidence without making raw provider payloads properties of every node.
- Grounding: retain `ground(tavily, diagnosis, options): Promise<Grounding>` unchanged (`diagnose/tavily.ts:500`); add `judgeGrounding(diagnosis, grounding, decisionPort): Promise<GroundingJudgment>` immediately after retrieval in `heal.ts:1119-1131`. It returns retained citation IDs and support/contradiction/insufficient labels plus evidence. Code owns IDs, URLs, versions and original snippets. Initially annotate/rank rather than discard all evidence. Unknown, timeout or invalid IDs preserve original citations. An empty validated selection is explicit insufficient support; do not turn it into fabricated source availability. Keep all original citations in evidence for reviewer reconstruction.
- Diagnosis: retain `classifyMechanically` and existing `classify` signature. Add a separate `classifyWithJudgments({llm, log, decisions, mode, observe}): Promise<Diagnosis>` wrapper used only by healing when explicitly enabled. Typed selection returns class ID and extracted-span ID; code reconstructs the existing Diagnosis. Unknown/insufficient/provider failure calls existing `classify`; its errors remain errors. Do not put Jev's confidence into `Diagnosis.confidence` or 0.7/0.9 routing thresholds without a separately evaluated mapping; shadow mode should retain the entire existing Diagnosis. Source guards at `classify.ts:276-307` remain behavioral oracle. Baseline reproduction already runs first (`heal.ts:1098-1116`). `audit-only.ts:149-150` keeps its current classifier unless a separate phase explicitly includes it.
- Recovery: optional typed proposal selector in `RecoveryInput` or a local wrapper, receiving only existing `signals` and `sources` and returning proposals in the existing validated form. Preserve deterministic `controllerPromiseHypotheses` first; replace only fallback selection at `hypotheses.ts:192-209`. Always pass selection through `validateHypotheses` (`:70-86`). Invalid/unknown/API outage returns to existing bounded super fallback only if capacity allows; otherwise existing insufficient reason with disclosure. Source checks, probes and grants `:218-245` cannot be changed by the selector.
- Navigator: new CLI `sutura explain --case-file <path> --query <text> [--json]`, over one explicitly selected local JSON case file. No gh fetch, repair dispatch, arbitrary directory crawling or shell execution. First parse a bounded regular-file JSON record (4 MiB is the existing Case Lab case-file ceiling at `packages/case-lab/src/publish.ts:34-44`), validate the minimal serializable evidence fields used, preserve source/run/policy identity and hash original bytes. Do not cast JSON to runtime `CaseFile` (its cost object may contain methods). Select from stable evidence IDs extracted from diagnosis, stages, verification and recovery, returning original excerpts and source JSON pointers; action labels come from current trusted rendering helpers. Provider-free extraction/listing must remain available on unavailable key, insufficient evidence or provider error. Explicit opt-in semantic mode and capped budget belong in command arguments/config controlled by the parent plan. Read-only input does not itself authorize transmitting its contents; show/send only an approved redacted projection. Existing `assess` and `diagnose` stay provider-free.

## Consumer sweep: executed commands and every matched file

Commands were run from repository root. Group mapping: FOUNDATION=Phase 1; SEARCH=Phase 3; GROUNDING=Phase 4; TYPED=Phase 5; DISPLAY=Phase 1 metadata and Phase 4 grounding; NAVIGATOR=Phase 6. Exclusions apply only to the named behavior; Phase 1 still covers shared audit metadata in audit-only and replay wiring.

### Search surface

`rg -l 'compareSearchNodes|searchScore\(|adaptiveSearch\(|AdaptiveSearchOptions|SearchNode' packages scripts --glob '!**/dist/**'`

All six matches: `packages/core/src/engine/search-score.ts` (unchanged baseline comparator, SEARCH), `packages/core/src/engine/search-score.test.ts` (baseline oracle, SEARCH), `packages/core/src/engine/search.ts` (optional hook, SEARCH), `packages/core/src/engine/search.test.ts` (hook safety/recovery, SEARCH), `packages/core/src/heal.ts` (inject bounded port, SEARCH), `packages/core/src/index.ts` (public optional types if exported, FOUNDATION/SEARCH). No scripts matched this query.

### Classification, grounding and recovery surface

`rg -l 'classifyMechanically|\bclassify\(|recoverDiagnosis\(|\bground\(|promoteUpstreamDependencyDiagnosis' packages scripts --glob '!**/dist/**'`

TYPED/GROUNDING implementation and tests: `packages/core/src/diagnose/classify.ts`, `packages/core/src/diagnose/classify.test.ts`, `packages/core/src/diagnose/hypotheses.ts`, `packages/core/src/diagnose/recovery.test.ts`, `packages/core/src/diagnose/tavily.ts`, `packages/core/src/diagnose/tavily.test.ts`, `packages/core/src/diagnose/tavily.live.test.ts`, `packages/core/src/heal.ts`, `packages/core/src/index.ts`. Existing live test remains opt-in and is not local acceptance evidence without authorized dispatch.

Compatibility tests / fixtures: `packages/core/src/index.test.ts`, `packages/placebo/src/testing/controller-recovery.test-helper.ts` (retain default behavior and shape); `packages/core/src/orchestrate.test.ts`, `packages/core/src/github/fleet-gated.captured.test.ts`, `packages/core/src/github/adapter.window.test.ts`, `packages/core/src/github/adapter.captured.test.ts` (read-only/mechanical behavior unchanged; run relevant existing gates, no historical fixture rewrite).

Explicitly excluded callers, preserved unchanged: `packages/cli/src/diagnose.ts`, `packages/action/src/inspect.ts`, `packages/action/src/inspect-github.ts`, `packages/core/src/orchestrate.ts`, `packages/core/src/verification/external.ts` use mechanical classification for inspection/admission; no semantic calls added. `packages/core/src/audit-only.ts` calls generative `classify` twice at lines 149-150 and remains unchanged because wrapper is healing-only. `scripts/fleet-dogfood-metrics.mjs` is a broad-regex classification match outside repair semantic scope; no fleet metrics reinterpretation.

### Shared diagnosis/grounding display consumers

`rg -l 'Diagnosis|Grounding|RecoveryHypothesis|DiagnosisRecoveryEvidence' packages/core/src/replay packages/core/src/report packages/core/src/trace packages/case-lab/src packages/action/src scripts --glob '*.ts' --glob '*.mjs'`

All seven matches: `packages/core/src/report/report.test.ts`, `packages/core/src/report/markdown.ts`, `packages/core/src/report/format.ts`, `packages/core/src/report/casefile.ts`, `packages/case-lab/src/render.test.ts`, `packages/case-lab/src/render.ts`, `packages/case-lab/src/result.ts`. Keep Diagnosis/Grounding existing fields unchanged to avoid obligatory migrations; new semantic evidence uses foundation's versioned envelope. If the parent chooses optional CaseFile semantic evidence, these seven are DISPLAY consumers requiring explicit unknown/legacy absence behavior and snapshots for the new envelope. `packages/core/src/domain.ts:21-39` is the canonical Grounding/Diagnosis type owner and `:161` owns CaseFile; no unversioned reinterpretation of `confidence`.

### JSON case-file writers/consumers and navigator

`rg -l 'case-file.json|casefile.json|case.json|JSON.stringify\(caseFile|serializeCase|serializedCase' packages scripts --glob '!**/dist/**' --glob '*.ts' --glob '*.mjs'`

All six matches: `packages/cli/src/cli.ts` writes heal/replay JSON at lines 199-214 (NAVIGATOR fixture compatibility); `packages/core/src/heal.test.ts`, `packages/core/src/orchestrate.test.ts`, `packages/core/src/github/adapter.captured.test.ts`, `packages/case-lab/src/publish.test.ts`, `scripts/placebo-live.test.mjs` (existing writers/fixture consumers; preserve old serialized records and cover navigator parser with representative output). A broader version without source extensions also matched large historical captured JSON; those are immutable evidence, not migration targets. Do not bulk reserialize them.

Direct source inspection also found `packages/case-lab/src/publish.ts:42-44` bounded JSON reader, `packages/case-lab/src/replay.ts:86-93` plain-case/cost adapters and `packages/case-lab/src/result.ts` validator; navigator must avoid importing case-lab into CLI/core. Reuse semantics via a small pure core evidence parser if compatible, without moving the entire Case Lab schema. Existing CLI dispatch/argument/export owners are `packages/cli/src/args.ts`, `cli.ts`, `index.ts`, with `args.test.ts`, `cli.test.ts`, `bundle.test.ts`; new `explain.ts` and `explain.test.ts` own bounded read/query behavior. `packages/cli/src/replay.ts:19-45` and `replay.test.ts:79-104` provide bounded-read/change-during-read behavior to mirror, not a reason to execute replay for navigation. `packages/core/src/report/recovery-summary.ts:4-14` and `format.ts` remain trusted labels; no model-generated commands.

Coverage limit: foundation's general decision-envelope/replay writers are assigned to the other investigator. This sweep covers these decision consumers, not every whole-repository CaseFile occurrence. Any parent change to CaseFile or ReplayBundle requires its separate complete sweep.

## Executable anchors and required new behavioral oracles

- SEARCH: `search-score.test.ts:17,38`; `search.test.ts:24,39,90,103,299,324,338,347,376,384`. Add disabled=byte-equivalent order/no calls; malformed/duplicate/foreign IDs fallback; uncertain/error/deadline/budget fallback **and visible reason**; rejected node never revived; suggestion cannot cause early acceptance; shadow keeps actual order; tie-break preserves prefix eligibility. Commands: `pnpm --filter @sutura/core exec vitest run src/engine/search.test.ts src/engine/search-score.test.ts`.
- TYPED: `classify.test.ts:210,347,365,397,427,440,455` covers disagreement, command authority, retry/fail-closed and redaction. Add absent/unknown result invokes existing classifier within same budget; no third unbounded retry; insufficient fallback reason retained; mechanical-only entry points no inference. Recovery anchors `recovery.test.ts:31,44,54,62,71,95,103,112,229` cover bounded probes, injected commands, hashes, audit reserve, cancellation, unavailable price, provider failure, deterministic fast path and ambiguous targets. Run `pnpm --filter @sutura/core exec vitest run src/diagnose/classify.test.ts src/diagnose/recovery.test.ts src/diagnose/hypotheses.test.ts`.
- GROUNDING: `tavily.test.ts:335,370,387,407,470` covers hostile citations, public URLs, extraction failure and 403 recovery. Add foreign citation ID rejection, uncertainty retains originals, no-support label does not invent authenticity, exact versions computed in code, prompt-like snippets cannot supply commands, evidence and reasons rendered. Run `pnpm --filter @sutura/core exec vitest run src/diagnose/tavily.test.ts` (not live test by default).
- NAVIGATOR: new temp-file tests for invalid JSON, unsupported format, >4 MiB, truncation, changed file, nonregular file, symlink policy, malicious strings/HTML, absent evidence, unfamiliar optional fields, invalid/foreign span IDs, secret redaction, missing key, timeout/429 and exhausted budget. Each failure must show local evidence/listing or a specific next action; no provider call for parse failure; no command execution/network fetch from selected text. CLI argument test rejects mutually inconsistent modes; JSON schema stable; normal help advertises input/data boundary. Run `pnpm --filter sutura exec vitest run src/explain.test.ts src/args.test.ts src/cli.test.ts src/bundle.test.ts` after files exist.

Every phase still runs repository-required full gates sequentially. These anchors are inspected tests, not fresh pass claims. The parent plan supplies phase numbers and exact defaults/budget/version policy; this note makes no live activation claim.

## Broad shared-shape sweep

Command: `rg -l "\bCaseFile\b|\bAuditFile\b|\bReplayOrchestrationConfig\b|\bRepairBudgetSnapshot\b" packages scripts --glob "!**/dist/**" --glob "*.ts" --glob "*.mjs"`. Every result below is covered by Phase 1 additive-field compatibility regression. Runtime readers/writers must preserve new optional metadata where they copy/serialize records; legacy/synthetic fixture producers retain missing metadata and add new-form cases only where their contract changes. The Phase 1 owner audits each listed projection for field loss, validates new data where untrusted, and records no-change dispositions. Search/grounding/typed/navigator changes use the phase mappings above. No blanket fixture regeneration.

- `packages/case-lab/src/replay.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/cli/src/cli.test.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/case-lab/src/result.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/cli/src/replay.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/cli/src/heal.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/cli/src/cli.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/cli/src/replay.test.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/evaluation/src/schema.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/placebo/src/comparison.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/orchestrate.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/placebo/src/score.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/placebo/src/adapters.test.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/placebo/src/adapters.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/domain.test.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/action/src/acceptance.test.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/placebo/src/baseline.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/domain.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/placebo/src/harness.test.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/action/src/acceptance.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/placebo/src/ablation.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/trace/types.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/incidents/types.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/placebo/src/baseline.test.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/replay/bundle.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/placebo/src/score.test.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/action/src/evidence.test.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/github/checks.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/audit-only.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/github/types.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/placebo/src/types.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/action/src/checks.test.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/action/src/evidence.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/verification/generated-record.test.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/replay/replay-orchestrate.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/heal.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/report/report.test.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/verification/generated-record.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/report/audit-markdown.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/report/audit-casefile.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/report/format.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/report/markdown.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/report/recovery-summary.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/report/casefile.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/index.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/report/audit-report.test.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/replay/replay-fixtures.test-helper.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/engine/candidate-identity.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
- `packages/core/src/engine/repair-budget.ts` — Phase 1 shared-shape compatibility; additional semantic behavior only per named phase above.
