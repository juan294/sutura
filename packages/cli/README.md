# Sutura CLI

Sutura verifies AI-generated CI repairs before it opens a pull request.

Version 0.5.0 starts with one repository assessment. Node.js 22 or later is required; assessment needs no provider account and never runs repository scripts.

```bash
sutura assess . --json
sutura init --plan --workflow "CI" --repo example/project
```

Review the displayed workflow diff, permissions, provider destinations, limits and unknown total costs, then use the exact apply command it prints. Candidate testing supplies an immutable `--action-sha`; after publication, the CLI resolves its matching version tag. Live repair needs your own Nebius Token Factory and access-controlled ConTree credentials. Assessment and selected-run diagnosis remain available without them.

`init` is now preview-first. Select every credential name explicitly with `--credential`; unselected environment values are ignored. `--force` does not overwrite custom workflows. Apply persists a local receipt without secret values. Interrupted operations resume from observed state; an uncertain remote write requires a newly reviewed replacement plan before it can repeat.

```bash
sutura diagnose --repo example/project --run-id 12345 --json
sutura doctor --repo example/project
sutura upgrade --plan --workflow "CI" --repo example/project
```

Doctor distinguishes installed and desired Action versions and static/configured/activated/prepared/reproduced/native-verified/integrated stages. Secret names do not prove credential validity. Incomplete readiness returns exit 2; an operational read error returns 1. Assessment and diagnosis can return a useful unsupported/unknown result successfully.

`upgrade` changes reviewed pins without replacing App wiring or unrelated jobs. `pause`, `resume` and `remove` use the same plan/apply contract; removal requires an unchanged wholly owned workflow and retains credentials/evidence. Activation only occurs after the workflow reaches the default branch. No setup command activates a workflow or runs a paid smoke test.

Use `npx sutura@0.5.0` in place of `sutura` after publication. Release verification uses the packed candidate before registry publication; installing the package alone does not activate a consumer workflow.

Sutura handles pull request, push, scheduled, and manual CI failures. It records evidence on the pull request or failing commit and in one GitHub Check on the exact failing SHA.

Node and Python projects use separate sandbox adapters. Detection is automatic
for a single runtime. Set `runtime` to `node` or `python` in `.sutura.json` for a
polyglot repository, or pass `--runtime node|python` to a local `sutura heal`
run. Python preparation requires `uv.lock` or exact hash-locked binary
requirements and never runs repository source with network access.

A local `sutura heal` reproduces `pnpm test` (Node) or `python -m unittest`
(Python) unless `--failing-command "<command>"` names the command CI ran. The
Action always passes the command it extracted from the failing log.

For a local review that does not use ConTree, run:

```text
sutura audit --case-dir /tmp/case --candidate-diff /tmp/fix.diff --before-log /tmp/before.log --after-log /tmp/after.log --format json
```

Audit-only mode requires only `NEBIUS_API_KEY`. It uses supplied evidence and never executes or verifies the patch. Its separate `AuditFile` output always says `assurance: "reduced"` and never reports a verified repair outcome.

Replay a complete captured run without network access:

```text
sutura replay --bundle /tmp/captured/bundle.json --format json
```

Replay uses the recorded runtime unless `--runtime node|python` overrides it.
`--runtime auto` keeps the recorded setting. Historical GitHub-only captures
are partial fixtures for boundary tests. The public command rejects them before
provider, repository, or sandbox work starts.

The current local source candidate adds `sutura explain --case-file <path> --query <text> [--json]` for completed case JSON. Build the checkout and use `node packages/cli/dist/bin.js explain` before publication; an installed older package does not establish delivery of this candidate. Lexical mode makes zero provider requests, returns up to three original redacted excerpts with exact JSON locators, and never scans or executes repository source. Files must be stable regular JSON, at most 4 MiB; queries are limited to 2 KiB. Symlink/replacement, malformed recognized fields and unsupported schemas return invalid-input with a correction.

`--semantic --max-usd 0.002` explicitly sends the redacted query and bounded evidence candidates to TypeSafe using the existing `TYPESAFE_API_KEY`; stderr discloses that transmission even with `--json`. The positive cap must be at most USD 0.002. One pinned `jev-1.14.0` request checks applicability and selects at most one best supplied evidence block, with no retry or generated explanation. Missing key, uncertain/malformed answers and provider failure retain labeled lexical fallback when available. Status/exit pairs are `matched`/0, `no-match`/0, `unavailable`/1 and `invalid-input`/2. Old missing assurance stays unavailable, and file-supplied actions cannot become executable commands.

Local `heal` can select `--jev-ranking`, `--jev-grounding`, `--jev-classification` or `--jev-recovery` as `off|shadow|assist`, with a shared `--jev-budget-usd` cap at most 0.02 and an existing key for nonoff modes. Defaults are all off. Shadow captures bounded redacted local comparison inputs without inline inference; assist changes only the bounded selection. Neither changes executable admission, grants, final verification or hosted defaults. Semantic recovery selects at most one existing validated hypothesis; the native fallback retains its at-most-two limit. Quality/performance qualification is separate; see [local Jev evaluation](../../docs/evaluation/jev-decisions.md).

Read the complete [user guide](../../docs/user-guide.md) for credentials,
first-run behavior, upgrades, disabling, removal, and troubleshooting. The
[setup and security overview](https://github.com/juan294/sutura#install-sutura)
summarizes the trust boundary.
