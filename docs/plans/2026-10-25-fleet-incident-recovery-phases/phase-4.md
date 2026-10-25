# Phase 4 — Faithful diagnosis and reproduction

Parent: [fleet incident recovery](../2026-10-25-fleet-incident-recovery.md). Entry: phase 3 shared evidence contracts accepted and phase 4 authorized. Preserve existing runtime/fixture/npm configuration fixes and missing-prerequisite guard.

## Deliverables and implementation

1. Carry explicit selected native job/step identity, observed command and bounded primary log into diagnosis. Keep other failed steps labeled auxiliary context. Fix `packages/core/src/diagnose/classify.ts:276` so a model's alternate command or aggregate-gate excerpt cannot become the selected failure's class/grounding evidence. Preserve mechanical command choice, mismatch signal and confidence cap. Class disagreement with the correct command requires grounded primary evidence rather than unconditional replacement.
2. Add proposed `packages/core/src/engine/failure-identity.ts` and tests. Contract: `matched | mismatch | unavailable`, evidence version, native and sandbox fingerprints, parser, selected-step identity and reason. No generic exit-code/text-similarity approval. Reuse runner fingerprints from `packages/core/src/engine/focus/index.ts:27`, but do not inherit its direct-command-only eligibility as a global repair restriction. Identity extraction uses actual tool diagnostics: test runner/test ID/assertion fingerprint; typechecker diagnostic code/file/message; linter rule/file/message; supported build tool diagnostic code/source/module identity. Package-script wrappers remain supported when exact manifest/script provenance and observed tool output establish the underlying adapter; never execute source text to discover a command. A full command with multiple failures compares the complete normalized failure set, while a focused probe binds its selected target separately. Unknown or truncated sets disclose unavailable identity.
3. Compare baseline reproduction before paid diagnosis/search and each full triage failure against the selected native failure. Preserve the narrow missing-tool detector (`packages/core/src/heal.ts:549`). Add an explicit native-findings versus scanner-evidence-unavailable mismatch rule; do not infer which scanner prerequisite failed from generic stderr.
4. Thread identity through `orchestrate.ts`, both local and hosted `heal.ts` paths, `engine/repair.ts:599`, `triage` and `boundedTriage`. A mismatched/unavailable failing full probe is not fed to the SPRT as reproduction. Record spent probe time and stop with typed evidence; never discard budget/claim accounting. A passing full probe retains existing flaky/clean-baseline behavior. A rejected focused probe retains full-command fallback, whose failures now need identity proof too.
5. Preserve both native and sandbox evidence in case/replay/report output. New optional versioned fields allow old fixtures to load as historical identity-unmeasured, never silently matched. Search/fixed claims for new executions require matched original failure plus existing audit/verification gates. Before enabling that requirement, produce a support-diff matrix for all existing positive repair/replay/Placebo fixtures by class and command form. Every previously supported true-match case must gain an adapter or be explicitly shown as an evidence-limited case for owner acceptance; silently disabling package scripts, lint/typecheck/build or multi-failure tests blocks phase acceptance. Existing protected verification obligations remain independent.

```text
@ evaluateReproduction(nativeStep, sandboxResult, identityAdapter) -> decision
ctx: exact selected source evidence and sandbox execution record
pre: source identity and command provenance validated
do:
  1. parse native and sandbox failure fingerprints
  2. compute matched, mismatch or unavailable identity
  3. write both evidence references and consumed resources
br: matched failure -> triage; pass -> existing clean/flaky path
fail: mismatch or unavailable failure -> typed stop with required input or adapter
risk: repeated nonzero exits must not certify a different failure
```

## Automated acceptance

RED fixtures first, sanitized from private captures: selected shard plus aggregate gate/model disagreement; native vulnerability findings versus missing valid scan evidence; native timeout versus newly missing tool; same test ID with different assertion fingerprint; absent/truncated primary evidence. All mismatch/unavailable cases must show zero repair search, zero fixed claim and no remaining repeated probes; already-spent preparation/probe costs remain recorded. Native and sandbox identical missing-tool failures must not be mislabeled a new prerequisite defect.

Positive oracles: same assertion with harmless timestamp/path variation matches; supported dependency evidence remains upstream-grounded; direct and package-script-wrapped test/lint/typecheck/build failures retain support; multi-failure sets match only when complete identities agree; supported deterministic repair still reaches independent audit and native admission; true flaky/pass sequence retains correct confidence semantics. Test both direct legacy `triage`/repair entry and bounded Action/local paths, not only the main orchestrator.

Recovery/disclosure oracles: missing native assertion names the required log/artifact; adding valid captured evidence supports a later distinct event; unavailable adapter remains visible; no claim deletion/retry bypass. A focused mismatch can fall back, but an unrelated failing full command cannot become matched.

Update triage/heal/orchestration/classify tests, replay readers, domain/report fixtures, public exports and Placebo focused-triage tests. Run targeted suites, then all parent local gates and coverage; rebuild committed bundle. No live sandbox execution is required for local acceptance.

## Manual acceptance and handoff

Independent reviewer traces selected-step evidence through grounding/search and checks every triage caller in the parent consumer sweep. Unsupported native services, custom commands and offline scanner inputs remain explicit support limits; this is not a claim of universal reproduction. The operator sees exactly what evidence/adapter is absent and where to resume.

Two behavioral work units share contracts and must integrate sequentially. Sanitized fixture preparation may be `[batch-eligible]` after parent fixes interfaces and assigns nonoverlapping fixture paths. Record RED/GREEN and tested identity, adapter support table, retained safety tests and hosted limitations. Stop for acceptance.
