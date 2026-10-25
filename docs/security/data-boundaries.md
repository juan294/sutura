# Sutura data boundaries

Status: implementation contract refreshed against Sutura 0.4.0 on 2026-10-25.
Package publication alone does not establish consumer activation.
Provider retention statements below retain their cited provider basis; this
source review does not revalidate account settings or provider terms.

Sutura is a bring-your-own-key tool. It does not proxy repository data through Sutura maintainer infrastructure. Provider terms and account settings still govern data after Sutura sends it.

## Boundary summary

| Destination | Data sent | Network and retention contract |
| --- | --- | --- |
| GitHub | Workflow run metadata, failed-step logs, evidence comments, HTML case files, repair branches, and repair pull requests | The action uses GitHub APIs. Repository and Actions retention settings govern stored comments, branches, pull requests, logs, and artifacts. Sutura never auto-merges. |
| Nebius Token Factory | Bounded, redacted failure logs; diagnosis data; redacted non-editable evidence; and exact editable excerpts only when no known credential pattern is present | Requests go directly from the action with the repository owner's key. Zero Data Retention prevents inference-log collection when the account enables it. Sutura does not change ZDR settings. |
| Nebius Data Lab | An explicit, allowlisted evaluation dataset and batch outputs, only after separate upload and spend authorization | Explicit dataset upload creates a retained Data Lab object even when inference ZDR is enabled. Data Lab processes datasets and batch outputs in EU-North1 (Finland). The repository owner must review the exact input hash and delete the dataset and outputs when they are no longer needed. |
| Tavily | A bounded, redacted error query, public package names and versions, and public release or migration URLs | Tavily is optional. Requests go directly from the action with the repository owner's key. The owner's Tavily plan and provider policy govern retention. |
| Nebius ConTree | A base image reference, dependency-input archive, repository-overlay archive, commands, and bounded command output | Only dependency preparation has outbound networking. Source is absent then. All source-bearing execution is network-disabled. The previously cited ConTree beta documentation states that untagged, unreferenced images can remain for 180 days; confirm current terms before confidential use. Sutura has no verified image-deletion control. |
| Package registries | Package names, versions, lockfile resolution data, and normal package-manager request metadata | Registry access occurs only from the dependency-input image. Lifecycle scripts are disabled. Bounded `.npmrc` files may contain only comments, blank lines and boolean `engine-strict`, `legacy-peer-deps` or `prefer-offline`. Credentials, registry overrides, other configuration and Yarn auth fields are refused. Private authenticated registries remain unsupported. |
| Resend, when explicitly configured | The bounded private owner digest, configured sender and recipient, and stable idempotency key | The optional fleet worker requires exact scoped authorization and a credential reference before sending. Its private outbox separates provider acceptance from delivery; retries are bounded. No email was sent by local candidate preparation. |

## Local CLI and action data

Assessment reads bounded repository metadata without executing scripts or calling providers. Selected-run diagnosis uses bounded read-only GitHub evidence without inference or sandbox access. Setup previews a digest-bound plan before writing the workflow or configuring explicitly selected credential names. Selected secret values go to GitHub through standard input and never enter setup plans or receipts. `.sutura/setup-receipt.json` retains local operation state and repository metadata; keep it private and out of commits.

Generated workflows inspect failures with read permissions before entering privileged repair. The heal path reads the exact failed GitHub run, checks out its exact head SHA, and keeps provider keys in the action process. It excludes provider keys, the GitHub token, `.env` files, private keys, credential files, Git metadata, installed dependencies and caches from repository overlays. Tracked build output and dependency fixtures under `__fixtures__/**/node_modules/**` can remain as source; they are never dependency-preparation inputs. `.npmrc` bytes pass the bounded allowlist above before copying.

Sutura-owned local outputs include console output, generated configuration, private setup receipts, optional sanitized evaluation manifests, one-trajectory ATIF files, and explicit JSONL exports. The optional fleet collector also retains private incident/native records, queue state, daily reports and email outbox receipts; its public projection is an aggregate whitelist. GitHub-hosted outputs include terminal evidence, comments, checks, HTML case files, repair branches and pull requests. Sutura has no maintainer-operated telemetry or artifact service.

## Sandbox network sequence

```text
import trusted base image
  -> upload declared dependency manifests only
  -> install with network enabled and lifecycle scripts disabled
  -> overlay the safe repository archive
  -> initialize an exact hook-disabled Git baseline
  -> reproduce the observed command without automatic lifecycle rebuilds
  -> require the selected native failure to match the sandbox failure
  -> reproduce, triage, adaptive repair search, and audit with network disabled
```

The dependency archive includes the root package manifest, supported root lockfiles and workspace files, package manifests selected by declared workspace patterns, and validated supported npm configuration. It excludes source and installed dependency paths. The overlay rejects symlink destinations, symlink parents, and collisions with preparation-generated paths. Missing native build prerequisites require a separately reviewed preparation path; Sutura does not enable lifecycle hooks to force reproduction.

## Redaction limits

Sutura applies one bounded redactor before each Sutura-owned Token Factory or Tavily request, including JSON-repair retries. It covers known authorization headers, environment-style key, token, secret and password assignments, URL credentials, private-key blocks, and known token prefixes. It returns only the sanitized text and match count.

Redaction is not secret scanning. It cannot detect an arbitrary secret stored as ordinary source text. Sutura therefore rejects an editable source excerpt when the redactor would change it, instead of asking a model to edit altered source. Users must still keep secrets out of source control and review every generated patch.

The public `NebiusClient` transport does not promise redaction for arbitrary caller content. The guarantee applies to Sutura-owned orchestration paths.

## Data Lab and ZDR

Sutura prepares a bounded, allowlisted Data Lab request locally. The request uses
opaque case hashes, categorical evaluation attributes, fixed prompt text, bounded
numbers, and expected public outcomes. It does not copy source, logs, trace
summaries, repository names, private paths, provider URLs, request IDs, or
arbitrary input keys. Dataset upload and batch dispatch are separate commands and
each requires a literal authorization token. Tests and dry runs do not contact
Data Lab.

ZDR is an account-side Token Factory inference control. When ZDR is enabled,
Token Factory does not collect chat-completion logs for later Data Lab import.
Sutura does not enable, disable, or verify ZDR automatically. An explicit Data
Lab dataset upload is different: it deliberately creates a dataset object and a
batch operation creates output data. ZDR does not turn those explicit objects
into transient inference requests. Record the exact input and output hashes,
review the account retention terms, and delete the dataset and batch outputs when
they are no longer needed.

Data Lab documentation states that its logs, datasets, batch outputs, and training
data are processed in EU-North1 (Finland), with Nebius acting as data processor
under its Data Processing Agreement. Dataset IDs, versions, operation IDs, model,
limits, hashes, latency, cost, and aggregate quality may be published as evidence;
provider credentials and raw authorization responses must not be published.

Official references: [Token Factory quickstart](https://docs.tokenfactory.nebius.com/quickstart), [ConTree overview](https://docs.tokenfactory.nebius.com/sandboxes/overview), [Data Lab overview](https://docs.tokenfactory.nebius.com/data-lab/overview), and [Tavily API reference](https://docs.tavily.com/documentation/api-reference/endpoint/usage).
