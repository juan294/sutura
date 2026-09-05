# Sutura Case Lab

The Case Lab is the public, signed-out demo of Sutura. A visitor selects one of
five server-defined cases and receives a stable, readable result: the failed
commit and CI evidence, the Nano diagnosis, the ConTree search tree, the Super
candidates, the rejected patches and their reasons, the Ultra audit verdict,
the final outcome, cost and resource use, and links to the GitHub run, pull
request or refusal report, and evidence.

Every case has a deterministic result labeled `Deterministic replay` or
`Recorded live result`. A live run through the public path is labeled
`Live run`. The label is the `mode` field of the result document and is
rendered in the page title and header.

## Architecture

```
visitor ── static site (Vercel) ── POST /api/dispatch ── GitHub workflow_dispatch
                                        │                       │
                                        │                juan294/sutura-demo case-lab.yml
                                        │                  ├─ re-checks CASE_LAB_ENABLED and the daily cap
                                        │                  ├─ materializes the case, opens the broken PR, runs CI
                                        │                  ├─ runs juan294/sutura/packages/action@<release sha>
                                        │                  └─ publishes results/<request-id>.json to case-lab-results
                                        └─ result page reads the public JSON and the public run API
```

The Token Factory and ConTree repair path runs unchanged inside the Action
step. The dispatcher is one stateless function. It holds one token and no
provider secret.

## Cases

| Id | Scenario | Placebo case | Expected outcome |
| --- | --- | --- | --- |
| `javascript-repair` | JavaScript repair | `repair-off-by-one` | `fixed` |
| `python-repair` | Python repair | `python-repair-missing-await` | `fixed` |
| `flaky-failure` | Deterministic flaky failure | `flaky-timer-race` | `flaky-no-patch` |
| `greenwash-trap` | Greenwash trap | `trap-weakened-expect` | `refused` |
| `upstream-incident` | Upstream dependency incident | `upstream-formatter-release` | `fixed` |

The list is `CASE_LAB_CASES` in `src/cases.ts`. The request boundary accepts
exactly `{ "caseId": "<one of the five>" }` and nothing else. Repository
names, refs, commands, patches, and free text are rejected before any I/O.

## Limits

| Limit | Value |
| --- | ---: |
| Concurrent live runs | 1 |
| Live runs per rolling hour | 4 |
| Worst-case cost per run | USD 0.75 |
| Daily spend stop | USD 6.00 |
| Live runs per UTC day | 8 |

The dispatcher counts the `case-lab.yml` runs of the last 24 hours through the
GitHub API before every dispatch. The workflow repeats the count and checks
the `CASE_LAB_ENABLED` repository variable before it materializes anything,
so a caller that bypasses the dispatcher cannot raise spend.

Emergency disable: set the Vercel environment variable `CASE_LAB_ENABLED` to
anything but `true`, or set the `sutura-demo` repository variable
`CASE_LAB_ENABLED` to anything but `true`. Either switch stops every live run
before a provider call.

## Service identity

The dispatcher authenticates with one fine-grained personal access token:

| Field | Value |
| --- | --- |
| Name | `sutura-case-lab-dispatcher` |
| Resource owner | `juan294` |
| Repository access | Only `juan294/sutura-demo` |
| Permissions | Actions: Read and write. Metadata: Read (automatic). Nothing else. |
| Expiry | 90 days |
| Storage | Vercel environment variable `CASE_LAB_GITHUB_TOKEN`, production only |

Actions write is the minimum permission that can create a `workflow_dispatch`
event; Actions read lists the runs for the limits. The token cannot read
repository contents, secrets, or variables, and cannot write to any other
repository.

The `case-lab.yml` workflow runs with `actions: write`, `checks: write`,
`contents: write`, and `pull-requests: write`. It never grants `id-token`.

## Environment allowlist

The dispatcher reads only:

| Variable | Meaning |
| --- | --- |
| `CASE_LAB_GITHUB_TOKEN` | The service identity token. Required. |
| `CASE_LAB_ENABLED` | `true` enables live dispatch. Anything else disables it. |
| `CASE_LAB_SITE_ORIGIN` | Optional https origin allowed to call the API from a browser. |

The dispatcher refuses to start when `NEBIUS_API_KEY`, `CONTREE_TOKEN`,
`CONTREE_PROJECT`, `TAVILY_API_KEY`, `GITHUB_TOKEN`, or `GH_TOKEN` is present
in its environment. Provider secrets exist only as `sutura-demo` Actions
secrets and are passed only to the Action step. ConTree receives `CI=true`
and `NODE_ENV=test` and no credential
(`docs/security/private-repositories.md`).

## Threat model for the public trigger

| Threat | Control |
| --- | --- |
| Arbitrary repository, ref, command, patch, or text | The request boundary accepts one key with five values; the workflow re-validates its two inputs with a `choice` input and a regex. |
| Spend amplification | Hourly throttle, daily spend stop, and a static concurrency group of one, enforced in the dispatcher and again in the workflow. Per-run cost is bounded by the Action budgets (USD 0.25 inference, 32 sandbox operations, 600 seconds). |
| Token theft | The token can only list and dispatch runs on one repository; it lives only in the Vercel environment; error paths never echo it. |
| Result tampering | Result documents carry a content hash and are validated by rebuilding it; links are restricted to public GitHub URLs. |
| Secret leakage into public results | `assertCaseLabResultPublicSafe` rejects credentials, token prefixes, and private local paths; the workflow runs it with the live secret values before publishing. |
| Dispatcher outage | The static site and every deterministic result keep working; only live dispatch is unavailable. |
| Two requests racing one limit | One instance serializes its check-then-dispatch section; across instances the workflow's static concurrency group holds concurrency at one and its own daily-cap count, which includes queued runs, holds the daily stop. The hourly throttle can be exceeded by at most the number of warm instances. |
| Emergency switch on a warm instance | The dispatcher reads its environment on every invocation; a redeploy is still the documented way to change a Vercel variable, and the repository variable inside the workflow stops spend even if the dispatcher is stale. |

## Commands

```text
case-lab catalog --out <dir>                 write the five deterministic results
case-lab replay <case-id> [--out <file>]     one deterministic result
case-lab build-site [--site-url <origin>]    write dist/site; the origin fills canonicals and the sitemap
case-lab serve [--port 4177]                 serve dist/site for local review
case-lab acceptance --base-url <url>         signed-out acceptance record (--offline skips link checks)
case-lab verify-pin [--tag v0.2.0]           prove release.json, the demo workflow, and the tag agree
case-lab dispatch --base-url <url> --case <id>
case-lab capture-replay --request-id <id> --out replay
case-lab publish-result ...                  used inside the demo workflow
```

## Search and social metadata

`build-site --site-url https://sutura-case-lab.vercel.app` (the flag
`vercel.json` passes) gives every page a canonical link and an absolute
Open Graph URL, and writes `sitemap.xml` with the index and the five replay
pages. Without the flag the build still succeeds but carries no canonical and
no sitemap, and `case-lab acceptance` fails its `robots-txt`, `sitemap-xml`,
and `canonical` checks against it.

Every build writes `robots.txt` (`/result/` and `/api/` disallowed), copies
`assets/favicon.svg` and `assets/social-card.png` (1200x630) to the site
root, and adds Open Graph, Twitter card, theme-color, and JSON-LD tags to each
page: `WebSite` plus `SoftwareApplication` on the index, `WebPage` on each
replay. Only `/result/` is `noindex`, by meta tag and by the `X-Robots-Tag`
header that `vercel.json` sets on `/result*` and `/api/*`; `case-lab serve`
sends the same headers so the acceptance record means the same thing locally.

## Deployment

Deployment is an authorization gate. The exact commands, cap, and expected
cost are recorded in `docs/plans/2026-09-04-sutura-case-lab.md`.
