# Phase 3 — Evidence contracts and remaining source fixes

Parent: [fleet incident recovery](../2026-10-25-fleet-incident-recovery.md). Entry: the phase 2 compatibility disposition is recorded and phase 3 is authorized; revalidate `develop` and preserve unrelated work. Do not activate hosted settings, pins, secrets or workflow subscriptions in this phase; reviewed local source/configuration patches remain in scope.

## Deliverables and implementation

Resume the remaining phase 1 defect register by demonstrated frequency and available evidence. Capture a representative updater log before changing package policy; investigate scheduled probes, generated bundles, credential boundaries and resource issues without guessing. Complete local source fixes and concrete external-action packets under the phase 1 verification rules. These packages may proceed independently of journal implementation; neither gives authority to activate hosted changes. Record every finding's disposition rather than silently dropping unavailable evidence.

Use the same support, identity and readiness vocabulary for fleet operations and external onboarding. Define proposed shared bounded assessment records in `packages/core/src/incidents/` with schema/version, observation scope, support reason, confidence, required input and evidence stage. Static compatibility is never reproduced compatibility. CLI assessment and Action inspect reuse pure components; adapters handle local manifests versus authenticated run evidence. No fleet names, RPI assumptions or branch-name defaults enter that shared contract.

Reuse bounded pure checks already implemented in runtime detection, Node selection and snapshot-input validation (`packages/core/src/runtime/detect.ts:176`; `packages/core/src/runtime/node.ts:10`; `packages/core/src/security/snapshot-inputs.ts:24`). These are not all sandbox-only: snapshot enumeration/validation runs locally before upload (`packages/core/src/executor/contree.ts:1074`). Extract adapters where necessary instead of importing a live executor into assessment. Track target Action/runtime contract version, local tree identity, observed remote source SHA and evidence completeness so a newer CLI cannot certify an older installed Action by applying only newer rules. Preparation failures and the missing-tool detector depend on execution/log evidence (`packages/core/src/heal.ts:563`); absence of a static blocker is not proof of preparation. Add parity fixtures between local assess/doctor and Action inspect for the same captured input and target version, allowing differences only for explicitly missing evidence.


1. Retain a separate named existing-external-installation cohort in the ignored annex, with stable repository IDs and enrollment dates, alongside owner-fleet and prospective newcomer cohorts. Historical installation may have been assisted; it is not independent onboarding evidence. Reconcile the configured fleet with the owned nonarchived repository inventory and existing explicit exclusions. For each repository/workflow record default/integration branch, workflow ID/path/state, watched versus desired disposition, installed immutable Action SHA, routing marker, required checks, activation provenance, config-presence metadata and observation timestamp. Unknown access is not absence. Preserve intentionally excluded scope; flag unexplained drift for a concrete later patch.
2. Retain event, actor IDs, triggering actor, source run/attempt, workflow-definition identity, selected failed job/step and pagination completeness in `GhFleetClient` (`scripts/fleet-dogfood-metrics.mjs:620`, `:681`). Fetch full jobs/logs only for relevant failed or qualification-candidate runs, bound log bytes and mark truncation. A failure signature derived from insufficient evidence cannot be confirmed.
3. Add proposed `scripts/fleet-incident-evidence.mjs` and `.test.mjs` for validated companion journals and current qualification. Keep original v2 journal bytes and checksums intact. New schema `sutura-incident-evidence-v1` carries incident key, observedAt, trigger metadata, classification revision, proof references/digests and completeness. Test legacy readback and rebuild from original observations without inventing missing metadata.
4. Define `verificationContract` from a versioned native adapter/descriptor bound to protected policy: expected workflows and applicable jobs/matrix legs, event applicability, full-required rule, policy digest and source of that digest. Reuse the consumer's existing protected native/routing obligation contracts; where absent, add a reviewed declarative descriptor with explicit expected jobs and matrix expansion before enabling qualification for that consumer. Add descriptors for the pilots first; unenrolled consumers remain descriptive/qualification-unmeasured and do not block shipping compatibility fixes. Never infer requiredness from whichever jobs appeared in a successful run or generic YAML heuristics. Validate repair head against source/PR identity and the tested native merge relationship where applicable. Integration closure additionally needs integration SHA proof. A successful aggregate gate alone is insufficient. Unavailable contract gives unmeasured qualification.
5. Keep `nextObservedGreen` and elapsed time as descriptive fields. Derive qualified current counts through companion proof, not v2 strength ranking. Preserve unknown actor attribution; do not label an owner as fixer from GitHub actor alone. Explicit contradictions revoke current qualification without deleting historical observations.
6. Correct research-derived operational inputs in the private annex: partial-month denominators, trigger/cause separation, CodeQL arithmetic, historically disabled versus currently active monitors, and already-merged interactive fixes. Preserve original reports as history.

```text
@ qualifyIncident(source, observations, contract) -> qualification
ctx: read-only GitHub evidence and immutable local journal
pre: exact repository, run, attempt and SHA validated
do:
  1. validate completeness and protected contract identity
  2. lookup exact source, repair head and integration obligations
  3. compute next-green observation separately from recovery proof
  4. write companion qualification with supporting references
br: absent obligation -> unmeasured; contradictory obligation -> not-qualified
fail: corrupt identity or journal -> disclose and retain last-good history
```

## Automated acceptance

Create `scripts/fleet-incident-evidence.test.mjs` and extend both fleet script suites. Oracles: missing matrix leg, cancelled/skipped required child, different SHA, PR merge identity mismatch, reduced verification scope, incomplete pagination and same-branch unrelated green cannot qualify. Complete matching obligations qualify; subsequent contradiction removes current qualification; later partial collection retains historical valid evidence while showing stale/incomplete current coverage. V2 records remain readable and cannot silently upgrade to stronger evidence. Public export rejects private identifiers/free text.

Exact incident identity remains repository+run+attempt; two attempts and two repositories cannot collapse. Zero-input census fails completeness. The every-workflow-disposition check must name inaccessible/excluded entries instead of silently omitting them.

Run targeted `node --test scripts/fleet-incident-evidence.test.mjs scripts/fleet-dogfood-metrics.test.mjs scripts/fleet-recovery-ledger.test.mjs` after required core build, then all parent local gates sequentially. No provider spend.

## Manual acceptance and recovery

Owner reviews the private inventory discrepancies and prepared dispositions, not secret values. Missing credentials are metadata gaps until membership/validity is verified. Corrupt companion data produces a path and rebuild instruction; a clean rebuild into a new output generation must recover without overwriting raw history. Access restoration and new proof receipt must transition an unmeasured item without insider edits.

## Work units and handoff

Read-only census/capture and source-contract design are `[batch-eligible]` with separate ownership. Journal/metrics/schema changes integrate sequentially because they share readers. Independent reviewer checks false-green cases and backward compatibility. Handoff contains inventory timestamp/digest, tested candidate, checks, private defect-to-phase mapping and unresolved empirical inputs. Stop for phase acceptance.
