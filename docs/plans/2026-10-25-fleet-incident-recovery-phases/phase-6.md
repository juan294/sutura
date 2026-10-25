# Phase 6 — Admission, explicit outcomes and weekly email

Parent: [fleet incident recovery](../2026-10-25-fleet-incident-recovery.md). Entry: phases 3–5 accepted and phase 6 authorized. Preserve CI routing and admitted strict repair semantics. The owner selected a weekly email, not merely a generated file. This phase prepares delivery locally; sending and account configuration need their concrete execution authority.

## Shared admission and Action integration

Use the phase 3 pure classification/support contract from proposed `packages/core/src/incidents/classify.ts`. Keep trigger, cause, confidence, disposition and actual repair outcome separate. No LLM is required for deterministic admission. The same supported source assertion remains equally repairable under owner, bot and scheduled triggers, subject to existing trust/credential/policy gates. Known live probes, unsupported runtimes, stale bundles and credential boundaries route from evidence, not actor alone.

Extend modes to `inspect | heal | verify` while retaining default `heal` and existing `verify` semantics (`action.yml:6`; `packages/action/src/input.ts:85`). A minimal inspect parser runs before provider validation (`packages/action/src/main.ts:65`). Inspect reads authenticated run/attempt/SHA and bounded logs using read-only repository access, without provider/App/private credentials or source execution. Return versioned evidence, disposition, reason, owner, digest and next action. Encode logs as untrusted data. Repair independently revalidates trusted source identity and policy before claiming or spending; an editable inspect output cannot grant authority.

The generated monitor has read-only inspection followed by conditional privileged repair, per-job permissions, and an always-evaluated finalizer independent of provider configuration. Preserve App wiring through phase 5 minimal migrations. Runner-start failure produces collector-derived metadata-only evidence, not a fictional artifact. Update root/package Action metadata, setup/doctor, README verifier and bundle together.

## Terminal outcome policy

Dispatch by a validated detailed reason and failing stage, never by broad cause label alone. Preserve case evidence and accounting. `packages/action/src/main.ts:227` currently fails generic exceptions; expected cases gain explicit typed handling, not a catch-all success. `acceptance.ts:10` remains the admitted strict gate.

| Reason/stage | Inspect or advisory heal | Admitted `require-fixed` heal | Owner disclosure and recovery |
| --- | --- | --- | --- |
| Known unsupported snapshot/runtime/native preparation or policy refusal, including identified ConTree input refusal | Completed non-repair, successful workflow with typed reason; no claim/spend when known before admission | Failure if discovered after admission and not fixed | Capability limit, required adapter/input and later distinct-event path. |
| Known missing installation or credential boundary | Completed setup-blocked evidence; no provider work | Failure if admitted attempt cannot fulfill its contract | Exact missing name/permission and prepared setup command; no secret values. |
| Confirmed provider quota/capacity/disk exhaustion, or bounded known network outage | Typed resource-blocked completion in advisory mode, with consumed resources retained | Failure | Resource owner, failing stage and measured remedy; no blind automatic capacity increase. |
| Reproduction mismatch, unavailable identity, exhausted repair budget | Typed non-repair with both evidence sets and bounds | Failure | Required evidence or supported scope; no retry bypass or false fixed claim. |
| Unexpected exception, internal bug, corrupt evidence, source identity/security violation, classifier/parser failure or failed evidence API read | Failed monitor with diagnostics and no further privilege | Failure | Incident reference and exact corrective input/action; never green merely because labeled `sutura-internal`. |
| Already attempted or repair-branch recursion | Preserve existing non-repair handling and linked prior result | Preserve existing dedicated handling | Prior attempt link or distinct eligible event; no claim deletion. |
| Fixed with required evidence | Existing successful repair outcome | Success only under existing strict acceptance | Proposal/native/integration stages remain separate. |

For recognized ConTree failures, distinguish validated unsupported input, confirmed resource blockage and unrecognized provider fault. Do not parse a vague error string into a successful stop. Test direct heal and generated inspect paths. Expected unsupported cases may be operationally green while unresolved; metrics must never count them as repairs. Sutura's own admitted strict monitor intentionally remains red on non-fixed outcomes; its notification cost is accepted and measured. No toggling strict policy to improve colors.

## Queue and email delivery

Add proposed `scripts/fleet-incident-queue.mjs` and `scripts/fleet-digest-email.mjs` with tests. Reuse ledger/companion evidence to render private JSON/Markdown and a concise email: what changed, unresolved causes/owners, exact native evidence, proposed actions, new/reopened incidents, verified recoveries, daily rates and collection gaps. No raw logs, credentials or private attachments. The email is itself private data disclosure to the selected mail provider; its recipient/content scope is part of the activation packet.

Schedule one digest for the preceding complete ISO week in Europe/Madrid, on the first existing daily scheduled invocation on or after Monday 09:10 local. After each collection attempt, evaluate due delivery independently of collection success. Use the latest valid snapshot with explicit stale/failed coverage; a corrupt current snapshot may fall back to a validated prior snapshot, while no valid snapshot yields a coverage-unavailable notice with no invented counts. The current collector is daily, so no new hosted scheduler is needed. A sleeping/offline host sends the newest due summary on recovery with missing weeks disclosed, not a burst of stale emails. Freshness remains 36 hours; stale collection yields a visibly incomplete digest when the sender can run. A stopped host cannot send a warning about itself: preserve last-good state and expose the missed collection/delivery when it returns; this is not an always-on pager.

Use a small Resend API adapter invoked by the local collector, with a readback-capable configured account and verified sender. The installed Resend CLI establishes a practical administration path, not proof of account readiness. No new service account, domain or billing change is assumed. Prepare the exact verified sender, owner recipient, protected credential reference and schedule in private activation evidence; validate read-only permissions/readback before requesting any needed account action. If unavailable, delivery remains blocked with an actionable packet while local queue generation works. Interactive Gmail connector availability is not treated as an unattended launchd transport.

Persist an atomic outbox with stable scope+recipient hash+week delivery key and frozen content hash before sending. Renderer version is frozen payload metadata, never part of logical delivery identity; a renderer upgrade cannot resend an accepted/delivered week. A correction requires explicit separate delivery authority and a linked correction receipt. An OS-managed lock serializes collectors and releases on process death; do not use an immortal lockfile sentinel. Record `prepared`, `sending`, `accepted`, `delivered`, `bounced` or `delivery-unknown`, provider ID and timestamps. Poll provider delivery state with bounded reads; accepted is not delivered and delivered-to-server is not read-by-owner. Resend's [idempotency contract](https://resend.com/changelog/idempotency-keys) retains keys for 24 hours: bounded retries use the same key and body within that window. Never mint a new key or blindly resend an ambiguous request after expiry. Reconcile existing provider evidence, or leave delivery-unknown with a visible manual-review action. Retain failed/unknown weeks in the next digest. This prevents routine duplicates without pretending an external service offers unlimited exactly-once delivery.

This adds no per-incident email channel. Urgent failures remain in existing workflow output; the weekly digest is not a pager. GitHub's native subscriptions remain unchanged and may still send notifications. Deduplication applies to Sutura presentation, not raw runs, spend claims or GitHub's mailbox.

```text
@ deliverWeeklyDigest(snapshot, deliveryConfig, outbox) -> receipt
ctx: local collector, protected configuration and authorized mail adapter
pre: exact recipient, sender and delivery scope validated
do:
  1. compute due week and freeze redacted payload under a lock
  2. lookup durable delivery state and provider evidence
  3. emit authorized unsent payload with stable idempotency key
  4. write acceptance or delivery evidence and next action
br: ambiguous expired send -> disclose unknown; delivered -> no duplicate
fail: access, bounce or provider fault -> retained outbox and visible recovery
```

## Automated acceptance

Event matrices cover owner/bot/schedule/fork, success/failure/timeout, trust gates, disabled and diagnostic-only policies. Rejected cases consume zero claims/provider work. Inspect with missing provider config works; default heal and explicit verify remain compatible. Tampered output/source/policy cannot admit repair. Test token creation, finalizer failure, missing artifact and runner-start failure with subsequent restored access recovery.

Table-drive every terminal policy row in inspect/advisory/strict contexts, including supported fixes and unknown error lookalikes. Generic internal errors remain red. Resource recovery reaches the intended stage on a later authorized event. Every non-repair terminal outcome contains a usable next action.

Queue tests cover recurrence digest/version/contract, distinct failures within one workflow, unknown identities, repeated observation/restart, two attempts, closure and reopening. Email tests use a fake transport: no authorization/config means no send; double collectors, killed lock holder/restart, renderer change before first send and after pending/accepted/delivered, interrupted write, accepted-then-crash, lost response, bounded same-key retry, expiry ambiguity, bounced mail, delayed delivery, DST/week boundary, offline catch-up, persistent API failure, stale source, corrupt current snapshot with valid prior snapshot, no valid snapshot, recipient change and redact/escape fixtures. Recovery or explicit disclosure must be proven for each failure. No real email is needed for local acceptance.

Run queue/collector/CLI/Action tests, generated workflow event assertions, README setup verifier, actionlint, bundle validation and parent full gates sequentially. Protect private fields from public exports.

## Manual acceptance and handoff

Review a rendered synthetic email for decision usefulness and a private preview addressed only to the owner before requesting activation. Actual delivery acceptance requires an explicitly authorized test/due digest, provider delivery receipt and owner confirmation that the summary is understandable; receipt alone does not prove benefit. The owner preference recorded here authorizes the design, not sending now.

After shared interfaces are fixed, Action integration and queue/email implementation are `[batch-eligible]` with disjoint ownership; parent owns shared exports/generator/bundle integration. Handoff records outcome policy tests, private mail activation packet, receipt states, unresolved delivery/access gaps, and exact candidate for phase 7. Stop at acceptance.
