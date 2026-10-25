# Sutura repair delivery assessment — 2026-10-23

Question: does current configuration establish reliable verified repair delivery, and which evidence should govern remediation?

Baseline: Sutura `develop`, `3d830597aa34288156038cb1e00749ab3aca7f3b`. This assessment changed no product source or configuration. It preserved existing unrelated documentation edits. Private repository names, current operational evidence and per-project dispositions remain in the gitignored local report at `docs/agents/sutura-fleet-review-20261023/assessment.md`; they must not be copied into public source or a public PR.

## Criteria and implementation evidence

The delivery chain is source failure, eligible trigger, successful setup, faithful reproduction, audited typed outcome, linked repair PR and independent native CI on the exact repair head. Integrated recovery additionally requires authorized integration and its own green proof.

An advisory successful Action may report a non-fixed outcome (`packages/action/src/acceptance.ts:11`). The existing legacy metric counts fixed outcomes with successful wrappers as `repairPrsOpened` (`scripts/fleet-dogfood-metrics.mjs:496`) and labels them verified repairs (`scripts/fleet-dogfood-metrics.mjs:512`). The stricter ledger requires linked repair CI and distinguishes proposals from integrated recovery (`scripts/fleet-recovery-ledger.mjs:90`). Treat that stricter chain as delivery proof.

Repository overlay classification rejects any installed dependency path (`packages/core/src/executor/contree.ts:949`). Configuration validation accepts only comments, blanks and a single literal npm setting (`packages/core/src/executor/contree.ts:1268`). Both are protective contracts requiring captured-input compatibility tests before changing them. Relaxing their safeguards without a reviewed replacement is not a reliability repair.

Collection completeness, baseline completeness and actor attribution are independent (`scripts/fleet-recovery-ledger.mjs:452`). A running collector and a successful exit do not establish freshness, complete baseline evidence or operational repair health (`scripts/fleet-dogfood-metrics.mjs:743`).

## Recommendation and alternatives

Prioritize observed setup/reproduction compatibility failures, resource-boundary diagnosis and exact-head native verification. Make status display typed outcomes and stages. Reconcile enrollment and escalation separately from automatic repair coverage. Preserve Sutura-owned automatic routing, identity guards, independent audit, one-claim spending boundaries and publication controls (`docs/ci-routing.md:3`, `packages/core/src/github/adapter.ts:325`).

Expanding subscriptions first does not resolve runtime failures. Changing strict/advisory acceptance alone changes status colors. Weakening audit or native proof defeats the delivery criterion. Historical local rollout receipts cannot replace current hosted source inspection; installed source cannot replace successful live execution.

Current GitHub documentation confirms workflow_run default-branch requirements and explicit workflow lists ([events reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)). GitHub also documents repository-token PR workflow approval behavior and App-token alternatives; old blanket assumptions about all repository-token events being suppressed are insufficient ([trigger documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow)). Retrieved October 23, 2026.

## Evidence and handoff

Private assessment status: RED for demonstrated repair delivery in the inspected current cohort. Exact counts, repository/run identities, findings REL-01 through REL-13, alternative dispositions and coverage limits are in the ignored operational report. This public artifact deliberately retains only source-backed criteria and direction. Overall end-to-end fleet-health scan_complete=false; the bounded current workflow inventory is complete, while historical native evidence, resource occupancy and production health have separate limits.

Unchanged-source local checks passed: routing 25/25 and metrics/ledger 38/38. These fixture results do not establish hosted repair reliability. No full implementation gates, provider experiment, production health audit or remote mutation occurred.

Next phase: revalidate current heads/settings and implement captured-input regressions with TDD, independent review, simplify and applicable local gates in isolation. All identified repairs remain unresolved. Preserve the operational report before changing its evidence; hosted verification, administration, provider spending and publication remain independently controlled.
