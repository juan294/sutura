# Phase 4: Grounding relevance and source-support labels

Parent: [implementation plan](../2026-10-28-jev-decision-improvements.md). Baseline and invariants inherit the parent. Status: implemented and offline verified; live grounding benefit remains UNMEASURED. See the [handoff](../2026-10-28-jev-decision-improvements-notes.md).

## Scope and source anchors

Post-process already retrieved and validated citations, preserving retrieval/registry/URL boundaries (`packages/core/src/diagnose/tavily.ts:460-554`). No extra web search or fetch performed by Jev.

## Changes

Create optional healing-only grounding wrapper around current `ground`, avoiding changes to direct legacy callers. Assign stable citation IDs from source URL and snippet hash. Ask whether each passage applies to the known package/error and classify support as `supports | contradicts | insufficient`; code computes exact package/version comparisons first. Preserve all original citations in evidence and retain excluded IDs/reasons. Shadow captures inputs and original order only; Phase 2 computes suggestions after the repair ends. Assist puts confidently relevant/supporting citations first and excludes only confidently irrelevant passages from the repair prompt; contradictions remain visible as contradictory evidence. Unknown labels preserve original relative order. If all would be excluded, return original grounding with explicit no-qualified-source warning, not invented support.

Grounding public metadata is additive and validated; original source URLs/text remain escaped and traceable. Semantic relevance never makes an untrusted URL valid or promotes diagnosis confidence.

```text
@ selectGrounding(original, diagnosis, mode) -> grounding + evidence
ctx: current validated retrieval output
pre: exact version comparisons already computed by code
do:
  1. compute stable citation IDs and bounded state
  2. parse relevance and support judgments
  3. compute retained order and excluded evidence
  4. emit original provenance and fallback reason
br: assist and usable -> filtered prompt; shadow -> original prompt
fail: outage, empty selection or missing evidence -> original with disclosure
```

## Behavioral oracles

Extend tavily/heal tests and new grounding-selection tests using public fixtures: same package wrong version, matching version unrelated error, contradictory release note, malicious instructions, unsupported URL, no results and 403 fallback. Assert no extra Tavily calls, no change to source validation, exact retained/excluded provenance, uncertainty fallback and successful recovery next call. Renderer tests show that relevance is a judgment, not proof the repair works.

## Work units

After additive metadata contract, pure selector/tests and report display tests are [batch-eligible] with separate files; parent owns heal integration, domain/export/Case Lab validation and replay. Preserve baseline direct `ground` API. Phase 2 live gate is required to claim improved grounding.

## Phase acceptance and handoff

Automated: all phase oracles below pass, consumer sweep updated, and the parent plan's sequential local gates and coverage complete on the integrated candidate. Record failed and repaired checks, exact identity, files, decisions, unresolved external evidence and next-phase entry. Manual: owner reviews the evidence and accepts the phase; no manual operation is required for offline validation. Live measurements require a separately authorized cap and disclosed input data. Implemented/offline-tested is not live-qualified. Stop here unless continuation was explicitly authorized.

Shadow scheduling clarification: the pseudocode judgment steps run inline only in assist. Shadow records the baseline and bounded redacted input locally, then returns immediately; its provider comparison runs in Phase 2 outside the repair deadline. Baseline-vs-assist performance comparisons always use a no-call/off baseline, never shadow results as an exact counterfactual.
