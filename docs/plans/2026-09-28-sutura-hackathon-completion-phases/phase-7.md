# Phase 7 — Judging access and evidence retention

Parent: [Hackathon completion](../2026-09-28-sutura-hackathon-completion.md). Depends on an accepted phase 6 public submission. Observation window: December 1–15, 2026. Owner: Juan. Follow [verified repair phase 14](../2026-09-05-sutura-verified-repair-program-phases/phase-14.md?plain=1#L1) and the [judging access runbook](../../runbooks/judging-access.md?plain=1#L1).

## Work

Before the window, read back actual public artifact URLs and hashes, credential expiry metadata, approved finite live-operation reserve, owner/monitoring arrangement and recorded fallback. Build the final manifest only from real published values. The existing [collector](../../../scripts/judging-access-collect.mjs#L1) performs anonymous bounded GET/HEAD checks and writes archive/report evidence. Retain weekly post-submission checks, then daily checks during December 1–15 and after incidents. Publish durable public archives only under the applicable authorization; local downloads alone do not prove public retention.

## Acceptance

Automated: Manifest and collector tests reject missing URLs/hashes, embedded credentials, pin drift, expired links, failed live and fallback paths, and timeouts. Every observed check records exact time, served path, byte hash and failure reason. Incident and access reports stay bound to the submitted release.

Manual: A signed-out judge can reach the live demo or correctly labeled fallback and immutable evidence throughout the actual window. Each outage has first observation, affected artifact, fallback status, repair authorization and verified restoration. Close this phase only after December 15 observations are complete; October operational readiness is not the same result.

If live access fails, present the recorded fallback and install instructions. If both paths fail, report `no-usable-path`, keep the incident open and restore under the authorized deployment procedure. Do not dispatch paid canaries or rotate credentials as a side effect of the read-only collector.
