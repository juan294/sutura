# Private repository security

Use this threat model before enabling Sutura on a private repository.

## Protected assets

The protected assets are repository source, unreleased product details, CI logs, GitHub tokens, provider credentials, registry credentials, signing keys, customer data, and the integrity of tests and branch protection.

## Trust boundaries

- The GitHub workflow and Sutura version pinned on the default branch are trusted.
- A failing pull request, its source, manifests, logs, commands, and candidate patches are untrusted.
- GitHub, Nebius Token Factory, Nebius ConTree, Tavily, and package registries are external processors selected and paid by the repository owner.
- Human review and branch protection remain the final publication boundary.

## Enforced controls

- The action repairs only the exact head SHA reported by GitHub and claims one attempt before provider spending.
- The action passes only `CI=true` and `NODE_ENV=test` into sandbox commands. Provider and GitHub credentials do not enter ConTree.
- Network-enabled preparation receives only declared dependency inputs and bounded allowlisted npm configuration. Package lifecycle scripts are disabled, with no blanket post-overlay rebuild.
- Source is overlaid only after dependency preparation. Every source-bearing command is network-disabled.
- Dependency snapshots exclude source, Git metadata, credentials, caches, build output, and installed dependencies. Repository overlays keep tracked build output when it is part of the exact failing checkout, but exclude Git metadata, sensitive credential paths, and installed dependencies.
- Overlay extraction refuses unsafe paths, installed dependencies, symlink destinations, symlink parents, and unexpected existing-path collisions. Tracked dependency fixtures under `__fixtures__/**/node_modules/**` are retained only as source, never as preparation inputs.
- The sandbox Git baseline uses only the exact overlay manifest. Git templates and hooks are disabled.
- Model and Tavily inputs use bounded shared redaction. Editable source that matches a credential pattern is refused instead of rewritten.
- Setup previews the exact workflow and explicitly selected credential names before applying changes. Private setup receipts contain operation state and non-secret configuration such as `CONTREE_PROJECT`, but no secret values. Read-only inspection precedes privileged repair, and native/sandbox failure identity must match before repair inference.
- Candidate diffs pass deterministic patch policy, isolated tests, and adversarial audit. Sutura opens a pull request but never merges it.

## Unsupported configurations

Private authenticated registries remain unsupported. A bounded `.npmrc` may
contain comments, blank lines and boolean `engine-strict`, `legacy-peer-deps`
or `prefer-offline`; credentials, registry overrides and other options are
refused. Embedded URL credentials, Yarn authentication fields, copied registry
credentials and an unverified Yarn installer version are also refused. Use a
public dependency set until a reviewed credential-broker design exists.

Do not give the workflow broad organization tokens, production credentials, deployment keys, signing keys, or cloud administrator roles. Do not disable branch protection for Sutura.

## Residual risks

- Pattern redaction can miss a secret that looks like ordinary text.
- An explicit Data Lab upload is retained provider data and is not covered by
  inference Zero Data Retention. Do not upload private-repository evaluation data
  merely because ZDR is enabled.
- Token Factory, Tavily, ConTree, GitHub, and package registries remain external data processors with their own retention and access policies.
- ConTree images can retain private source for the documented image-retention
  period. Confirm current provider terms before use; Sutura cannot delete them
  through a verified API.
- A malicious dependency or test can run code during source-bearing verification. Networking is disabled, but that code can read overlaid source inside the sandbox. Automatic post-overlay lifecycle rebuilds are disabled.
- A generated patch can be logically wrong even when tests and audit pass. Human review remains required.
- GitHub comments and artifacts can expose sanitized failure context to repository collaborators who can read Actions data.

## Maintainer checklist

- Pin Sutura to an immutable release commit, not a mutable branch or tag.
- Keep inspection at `contents: read` and `actions: read`. Only the admitted
  repair job needs `checks: write`, `contents: write`, and `pull-requests: write`.
- Confirm the Token Factory ZDR and provider retention settings required by your organization.
- Review the exact Data Lab request hash before any explicit dataset upload; after
  an authorized experiment, record the output hash and delete the dataset and
  batch outputs under the organization's retention policy.
- Confirm ConTree's retention period is acceptable for the repository classification.
- Keep secrets outside source, manifests, lockfiles, test fixtures, and CI logs.
- Keep branch protection and required human review enabled.
- Review the case file, exact diff, and final CI result before merge.

## External adoption and Marketplace

External studies use public npm packages and immutable Action commits. A
participant repository remains inside that participant's GitHub and provider
accounts; Sutura has no maintainer-operated collection service. Study records are
pseudonymous by default and contain timing, categorical outcomes, public run/check
evidence, and manual-intervention counts. Accepted WS-3 evidence uses only public
repository and evidence URLs; never place a private-repository URL in the study record.
Before storing a record, review every free-text field for secrets, private paths,
source, logs, and personal data, then set `publicReviewConfirmed` to `true`.
Store an attributable quote or display name only after the
participant approves that exact attribution.

GitHub Marketplace publication makes the root Action metadata and release listing
public. It does not grant Sutura new repository access. Each installing repository
still controls workflow permissions, secrets, variables, Actions retention,
provider processing, and human review. Pin Marketplace installations to the exact
release commit generated by `sutura init`; do not replace it with a mutable branch
or floating tag.

The optional fleet digest stays private and requires its own reviewed sender,
recipient, fleet scope and credential reference. Public field reports omit exact
repository identities and free text. Local setup and synthetic receipts do not
prove native CI recovery, digest delivery or independent adoption.
