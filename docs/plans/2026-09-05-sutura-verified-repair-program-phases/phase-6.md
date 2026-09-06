# Phase 6 — Blinded evaluation, real NeMo execution and Arena preparation

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on phase 5. **[batch-eligible] with phase 9 only.** All evaluation remains local in this phase; Data Lab upload/batch and live Arena are phase 10.

## Outcome and ownership

Build the evaluation machinery that can test whether the new verifier and sponsor integrations help. Retain the old 110-row Data Lab v1 dataset as historical outcome-classification preparation. Produce a separate v2 quality task, actual standalone NeMo evaluation, and an immutable 100-case inventory with contamination controls.

Own `packages/evaluation/`, `packages/placebo/src/` evaluation/selection/comparison files and new corpus cases, `scripts/datalab-experiment.mjs:1` and its tests, plus `docs/datalab/` and evaluation-experiment documentation. Reuse `packages/evaluation/src/datalab.ts:306` where legacy expected outcome currently follows kind/grounding flags; add a versioned exporter/scorer. Consume trusted declarations from phase 1 as public task context, while keeping held-out sampled inputs/outputs out of all inference prompts. Cover JSON-property observations in addition to callable probes. Read `packages/evaluation/src/atif.ts:1`, `schema.ts:1`, `packages/evaluation/scripts/validate-atif.py:1`, `pyproject.toml:1`, `packages/placebo/src/comparison.ts:20` and `selection.ts:1` completely.

Do not edit core/shared contracts, Action dist, root package scripts, shared README, workflows, adoption files or shared release validators. New commands run directly in this phase; phase 10 integrates root local-gate wiring. This keeps phase 9 genuinely independent.

## Evaluation task and dataset

Construct blinded records from executed patches: original failure, bounded before/after production diff, public contracts and selected baseline/visible execution observations. Exclude case kind, expected outcome, final Sutura verdict, adjudicator recommendation, hidden tests/results, agent identity and label-bearing filenames. Hash source records and document redaction. Labels are derived offline from independent executable truth/preservation checks and explicit policy oracle, with `unknown` retained when execution is missing. Model task: predict `preserves-contract | breaks-contract | insufficient-evidence`, cite input evidence and calibrated confidence. Never train the model to map a fixture label to its declared outcome.

Pre-register two prompt variants, one direct rubric and one evidence-citation rubric. Use the same verified available NVIDIA model for the paired Data Lab comparison, fixed output schema and token caps. Development records tune prompts; validation selects one; held-out records are evaluated once after selection. Evaluate balanced accuracy over known labels, false-approval rate on deceptive patches, false-refusal rate on valid patches, abstention/coverage, calibration and cost. Report unknown and missing batch outputs separately. Safety quality is not the same metric as rubric-label agreement.

```text
split = freezeByRootFamily(corpus, counts={dev:60, validation:20, heldout:20})
for executedRecord in sourceManifest:
    truth = independentEvaluatorOnlyOracle(executedRecord)
    blindInput = redactAndRemoveOutcomeLeaks(executedRecord)
    assert noForbiddenMetadata(blindInput)
    emit(modelInput=blindInput, privateScoringKey=truth, lineage=sourceHash)
preparePairedBatch(promptA, promptB, identicalInputs, verifiedModel, finiteCaps)
score(joinByExactCustomId(outputs, privateScoringKey), retainMissing=True)
```

Data Lab input bytes can include the supplied candidate, because this is an offline evaluator of candidate quality. That differs deliberately from phase 4 challenge generation, which must never see a candidate. Scoring keys remain separate from uploaded model inputs. Data Lab data management metadata must not leak into batch prompt construction. Preserve existing idempotent prepare/upload/run/recover/finalize state machine and exact custom-ID joins; handle partial jobs without relaunching automatically.

## Standalone NeMo evaluator

NVIDIA documents base `nvidia-nat-eval` for standalone ATIF `EvaluationHarness` and ATIF-native evaluators; this fits recorded Sutura trajectories without replacing runtime orchestration. Use the existing pinned NVIDIA repository revision `23cd127dfba56994cd272f2771350d0ec13f3dd1` for matching ATIF/eval packages if its source contains this API. Inspect it before lock changes; if unavailable, select and record one compatible upstream immutable revision for both packages with contract tests. Never leave an unpinned latest dependency. This is an implementation compatibility check, not a product design question. [NVIDIA evaluation documentation](https://docs.nvidia.com/nemo/agent-toolkit/latest/workflows/evaluate.html), [custom evaluator source](https://github.com/NVIDIA/NeMo-Agent-Toolkit/blob/develop/docs/source/extend/custom-components/custom-evaluator.md).

Proposed `packages/evaluation/scripts/evaluate-atif.py`, `test_evaluate_atif.py` and bounded fixture manifest. Implement real `EvaluationHarness` invocation with ATIF-native custom evaluators for complete gate coverage, outcome agreement against evaluator-only truth, false approval/refusal, operation/latency accounting and evidence provenance. Evaluators return item-level results and denominators, not just Pydantic validity. Keep existing `validate-atif.py` distinct. Deterministic evaluators require no paid LLM; later Nemotron/Data Lab judgments are compared to these external outcomes rather than defining truth themselves.

```text
trajectories = validateAtifAndLoadBoundedManifest()
evaluators = {gateCoverage, independentOutcomeAgreement, resourceAccounting}
outputs = await EvaluationHarness(evaluators).evaluate(trajectories)
assert each requested evaluator produced terminal per-item results
writeHashedReport(toolRevision, configHash, trajectoryHashes, outputs)
```

The pseudocode describes semantics; use the API signature from the inspected pin. A local installed smoke test must demonstrate actual harness execution with one correct, one deceptive and one infrastructure-stop trajectory and expected nonidentical scores. A hand-written scorer without invoking NVIDIA's harness does not satisfy this phase.

## Arena and comparison contract

Freeze exactly 100 unique cases: 60 development, 20 validation, 20 held out. Expand by distinct root defects, including unfamiliar JS/TS/Python async, two-file contracts, upstream migrations, preservation regressions, flakes and deception. Pin upstream repositories/commits/licenses and offline dependencies. Synthetic mutations share family identity with originals and cannot cross splits. Publish split hashes and counts before live evaluation; retain hidden expectations outside all inference inputs. Public code can contain benchmark assets, but runtime packaging and prompt tests must prove they are inaccessible to the model context and candidate sandbox.

Reuse existing comparison arms and Wilson intervals. Extend observation records for challenge/routing versions and oracle status. Compare matched budgets/model availability and fixed candidate sets for verifier ablations. Report pairwise outcomes, per-language/family/split slices, correctly verified repairs per priced dollar, coverage, median and p95 latency with sample sizes. Keep first-green explicitly derived. Do not pool the historical 51 cases with expanded new-oracle metrics into one trend line.

## Automated success criteria

- [ ] Leak-sentinel tests inject kind, labels, hidden verdicts, agent provenance and answer-bearing filenames; model prompt export removes/rejects them while scoring retains valid joins.
- [ ] Dataset tests reject duplicates, split-family overlap, missing licenses/provenance, source-hash mismatch and missing outputs falsely scored correct.
- [ ] Perturb execution truth and confirm quality scores change; alter only fixture kind and confirm blinded predictions cannot obtain it.
- [ ] Run the real local NeMo harness via `uv run --project packages/evaluation python packages/evaluation/scripts/evaluate-atif.py` with the implemented manifest CLI; run Python unit tests directly through the same locked environment. Existing `pnpm run test:atif` remains passing.
- [ ] `pnpm --filter @sutura/evaluation test`, `pnpm --filter placebo self-check`, and `node --test scripts/datalab-experiment.test.mjs` pass sequentially.
- [ ] Comparison mutations reject changed models/budgets/splits and never interpret missing or infrastructure outcomes as negative-cost wins.

## Manual success criteria

- [ ] Independent reviewer checks one valid and one deceptive record end to end from executable truth through sanitized model input and final score.
- [ ] Reviewer audits the held-out split for family leakage and records known benchmark familiarity limits.
- [ ] Real local NeMo output exists; Data Lab remains explicitly prepared, not uploaded or measured until phase 10.

## Phase gate

Follow the parent plan's implementation/review/fix/simplification loop. Run focused checks and the standard local commands sequentially: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`. Rebuild the committed Action bundle for core/Action changes, run `pnpm run verify:bundle`, and complete `pnpm run ci:local` before any later push involving core. New process/build/sandbox tests use explicit timeouts of at least 30 seconds. Inspect actual hosted triggers before any push; never create a Vercel preview or use hosted CI to debug. Record actual results and the integrated source identity; stop after this phase. Remote actions and participant messages require the concrete authorization described in the parent plan.

## Progress record — September 6

Implemented source: this phase's commit. No provider call, Data Lab upload, batch job or paid evaluation occurred.

`packages/evaluation/src/blinded.ts` implements the contamination controls. `blindExecutedRecord` keeps the failure, candidate diff, public contracts and executed observations — the candidate is deliberately retained, because this is an offline evaluator of candidate quality, unlike phase 4 challenge generation — and removes case kind, expected outcome, final verdict, adjudicator recommendation, hidden tests and results, agent identity, and any changed path whose name carries a label. `assertNoForbiddenMetadata` fails on a forbidden key nested anywhere in a prompt-bound structure. `freezeSplitByRootFamily` assigns whole root families, so a synthetic mutation can never land in a different split from the case it derives from, and produces the same assignments and split hash for the same corpus in any input order. 30 tests.

Not built in this pass, and not claimed:

- The standalone NeMo `EvaluationHarness` invocation, `packages/evaluation/scripts/evaluate-atif.py` and its installed smoke test are absent. That acceptance item explicitly rejects a hand-written scorer, and it needs a pinned `nvidia-nat-eval` revision inspected and locked first.
- The v2 quality task and its two pre-registered prompt variants are built. `buildQualityPrompt` serves `direct-rubric-v2` and `evidence-citation-v2` over byte-identical inputs, differing only in the instruction, which is what makes comparing them meaningful. The record is asserted label-free immediately before serialization, so a caller cannot reach the prompt with an unblinded record and have it sent anyway, and a variant that was not pre-registered is refused rather than tuned in after seeing results. The response schema is closed over the three labels with bounded citations and a calibrated confidence.

  `scoreQualityPredictions` keeps unknown truth and unanswered records out of accuracy and reports them as their own counts, so a run that returned half its answers cannot look like a run that answered them correctly. Balanced accuracy averages per-class recall, so always predicting the majority label scores 0.5 rather than 0.9. False approval and false refusal are separate rates, abstention is its own rate rather than a wrong answer, and confidence is reported separately for correct and incorrect decisions. Nothing scorable returns nulls rather than zeros. 23 tests.

  The paired Data Lab batch itself is still not built; no prompt was constructed or sent, and no provider or upload was touched.
- The inventory machinery is built and was run against the real corpus. `buildEvaluationInventory` freezes the 60/20/20 split by root family, publishes a split hash and an inventory hash that moves when any fixture content or the corpus revision changes, and is reproducible for the same corpus in any order. A short corpus is reported as a shortfall and never frozen as a smaller split, because quietly freezing fewer cases as if they were the registered 100 would make every later held-out number describe a different experiment from the one that was pre-registered. An oversized corpus is refused rather than silently sampled. 8 tests.

  Run against the expanded corpus on September 6 it reports `incomplete`: **63 of the required 100 cases across 50 distinct root families, 37 missing**. That is the honest state of the inventory, and no split hash is published until the corpus reaches 100. Authoring 37 further distinct root defects, with pinned upstream repositories, commits, licenses and offline dependencies, is the outstanding work.
- Balanced accuracy, false-approval and false-refusal scoring, calibration and cost accounting are not implemented.
