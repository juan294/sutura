# Fixed owner evidence-navigation tasks

This is the Phase 6 usability protocol, separate from automated correctness and model qualification. No owner answers or task times were observed during implementation: all five remain **UNMEASURED**. Automated CLI output cannot stand in for owner comprehension or an independent-user study.

Use the existing, unchanged retained case file `packages/case-lab/src/__fixtures__/live-36975022285-python-repair-fixed-case-file.json`. It records a historical fixed Python repair. Its ledger values are recorded inference estimates; it does not establish complete current billing or missing legacy verification assurance.

| Task | Fixed query | Source evidence to inspect | Owner answer/time |
| --- | --- | --- | --- |
| Find cause evidence | `coroutine assertion` | `$.diagnosis.errorExcerpt`; original recorded assertion, not a generated causal explanation | UNMEASURED |
| Find the stopped branch | `repeated-state` | `$.search[2].terminalReason`; the complete case outcome is fixed even though this branch stopped | UNMEASURED |
| Identify missing assurance | `verification assurance` | Absence of `$.verification`; historical absence remains unavailable | UNMEASURED |
| Identify actual cost limits | `inference cost` | `$.cost.entries`; nine entries total about USD 0.051429 recorded inference, with full sandbox/billing unavailable | UNMEASURED |
| Find the recorded recovery action | `controller-authorized-recovery` | `$.recovery.reason` and `$.recovery.hypotheses[1]`; a historical narrow grant is not permission to execute another repair | UNMEASURED |

For each task, record the owner's selected locator, their interpretation of provenance/limitations, elapsed time and any confusion. Do not fill these observations from an agent's own answers. Source/candidate identities and automated CLI readbacks belong in the parent implementation notes; they do not change the UNMEASURED owner status above.
