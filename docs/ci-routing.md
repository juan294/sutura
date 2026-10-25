# Automatic CI routing v2

Sutura owns the routing contract in `scripts/ci-routing-v2.mjs` and the reviewed workflow glue in `scripts/ci-routing-workflow-v2.mjs`. This is an opt-in installation for repositories with an existing cadence policy. It does not install itself, mutate repository settings or publish changes.

An authenticated ordinary owner change on the integration branch can use bounded fast checks. Workflow, action, helper, dependency and runtime changes automatically select full verification. Repair bots, forks, production candidates, scheduled refresh and manual verification require full verification. Full selects an amount of application testing; independent native identity guards still control secrets, runners, provider proof and publication.

The workflow loads the planner and policy from the protected push-before commit or the physical first parent of a PR merge checkout. It checks that the PR second parent matches the native head. Source, protected base and tested merge remain distinct identities. The candidate planner is never executed to select its own route. Missing installation selects full; malformed identity fails the routing check and preserves the full-required output.

Each managed workflow adds a read-only routing job before skippable work and an always-evaluated application gate. The integration branch must require those gates before a policy-only CI Fast change is published. A successful fast route may skip full jobs; full routes require actual successful applicable children. Failed, missing, cancelled or skipped children cannot satisfy the gate. Independent production/untrusted predicates must override a false routing output in both child and final-gate conditions. Scope-specific provider publication is not counted as application proof.

During first installation, classic adapters run the protected v1 exported policy, lockfile and frozen-fixture checks without invoking its obsolete mode classifier. An explicit inert compatibility marker can satisfy the old validator while new predicates use v2. Frozen v1 receipts keep their original release/provider acceptance restrictions. Native adapters preserve their own protected acquisition, bounded checks and refresh receipt contracts. PR application proof never becomes an owner release receipt.

Install or check exact local copies with explicit target roots:

```sh
node scripts/ci-routing-sync.mjs --install /path/to/existing-cadence-repository
node scripts/ci-routing-sync.mjs --check /path/to/existing-cadence-repository
pnpm run test:ci-routing
```

The check is read-only and fails on source drift. Installation writes the two canonical modules and a deterministic source-fingerprint marker; it refuses to overwrite unowned different code. It does not generate repository-specific jobs or update branch protection. Adaptation must preserve actual native job inventories, matrix legs, event applicability and release contexts, with workflow tests and actionlint. Existing standard-CI repositories need no mode migration.

Routing failure messages name the invalid source/control boundary and direct coordination to Sutura. Repair the identified policy, installation or event identity; the next valid event routes automatically. No lean/legacy variable edit is part of recovery. Existing known-failed refresh and remote retry boundaries remain in force. Local checks do not establish hosted activation, native startup cost, provider readiness or recording readiness.
