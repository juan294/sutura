# Sutura data boundaries

Status: v0.2 implementation contract, reviewed against repository behavior on 2026-08-28.

Sutura is a bring-your-own-key tool. It does not proxy repository data through Sutura maintainer infrastructure. Provider terms and account settings still govern data after Sutura sends it.

## Boundary summary

| Destination | Data sent | Network and retention contract |
| --- | --- | --- |
| GitHub | Workflow run metadata, failed-step logs, evidence comments, HTML case files, repair branches, and repair pull requests | The action uses GitHub APIs. Repository and Actions retention settings govern stored comments, branches, pull requests, logs, and artifacts. Sutura never auto-merges. |
| Nebius Token Factory | Bounded, redacted failure logs; diagnosis data; redacted non-editable evidence; and exact editable excerpts only when no known credential pattern is present | Requests go directly from the action with the repository owner's key. Zero Data Retention prevents inference-log collection when the account enables it. Sutura does not change ZDR settings. |
| Tavily | A bounded, redacted error query, public package names and versions, and public release or migration URLs | Tavily is optional. Requests go directly from the action with the repository owner's key. The owner's Tavily plan and provider policy govern retention. |
| Nebius ConTree | A base image reference, dependency-input archive, repository-overlay archive, commands, and bounded command output | Only dependency preparation has outbound networking. Source is absent then. All source-bearing execution is network-disabled. ConTree beta documentation states that untagged, unreferenced images can remain for 180 days. Sutura v0.2 has no image-deletion control. |
| Package registries | Package names, versions, lockfile resolution data, and normal package-manager request metadata | Registry access occurs only from the manifest-only dependency image. Lifecycle scripts are disabled. Sutura refuses `.npmrc`, embedded URL credentials, and Yarn auth fields. Private authenticated registries are unsupported in v0.2. |

## Local CLI and action data

The CLI reads repository configuration and writes the Sutura workflow. Provider secret values are passed to GitHub through standard input during setup. The CLI does not write them into repository files.

The action reads the exact failed GitHub run, checks out its exact head SHA, and keeps provider keys in the action process. It does not copy provider keys, the GitHub token, `.env` files, private keys, credential files, `.npmrc`, Git metadata, installed dependencies, caches, or build output into a repository overlay.

Sutura-owned local outputs are console output and generated configuration. GitHub-hosted outputs are the evidence comment, HTML case-file artifact, repair branch, and pull request. Sutura has no maintainer-operated telemetry or artifact service.

## Sandbox network sequence

```text
import trusted base image
  -> upload declared dependency manifests only
  -> install with network enabled and lifecycle scripts disabled
  -> overlay the safe repository archive
  -> initialize an exact hook-disabled Git baseline
  -> rebuild required dependencies with network disabled
  -> reproduce, triage, adaptive repair search, and audit with network disabled
```

The dependency archive includes the root package manifest, supported root lockfiles and workspace files, and package manifests selected by declared workspace patterns. It excludes source and installed dependency paths. The overlay rejects symlink destinations, symlink parents, and collisions with preparation-generated paths.

## Redaction limits

Sutura applies one bounded redactor before each Sutura-owned Token Factory or Tavily request, including JSON-repair retries. It covers known authorization headers, environment-style key, token, secret and password assignments, URL credentials, private-key blocks, and known token prefixes. It returns only the sanitized text and match count.

Redaction is not secret scanning. It cannot detect an arbitrary secret stored as ordinary source text. Sutura therefore rejects an editable source excerpt when the redactor would change it, instead of asking a model to edit altered source. Users must still keep secrets out of source control and review every generated patch.

The public `NebiusClient` transport does not promise redaction for arbitrary caller content. The guarantee applies to Sutura-owned orchestration paths.

## Data Lab and ZDR

Data Lab export is disabled. Sutura does not import traces, prompts, logs, code, or evaluation records into Data Lab unless a future explicit user-controlled export enables a sanitized record.

ZDR is an account-side Token Factory control. Sutura does not enable, disable, or verify it automatically. Confirm the account setting before processing confidential source.

Official references: [Token Factory quickstart](https://docs.tokenfactory.nebius.com/quickstart), [ConTree overview](https://docs.tokenfactory.nebius.com/sandboxes/overview), [Data Lab overview](https://docs.tokenfactory.nebius.com/data-lab/overview), and [Tavily API reference](https://docs.tavily.com/documentation/api-reference/endpoint/usage).
