# Phase 6: Developer evidence navigator and completion

Parent: [implementation plan](../2026-10-28-jev-decision-improvements.md). Baseline and invariants inherit the parent. Status: planned, not implemented.

## Scope and source anchors

Add `sutura explain --case-file <path> --query <text> [--semantic --max-usd <amount>] [--json]`. It reads a local completed report and selects evidence; it does not replay or execute a repair. Existing CLI dispatch is `packages/cli/src/cli.ts:121-150`; case reports contain runtime methods such as `cost.totalUsd`, so raw JSON must not be cast to `CaseFile` (`packages/core/src/domain.ts:106-117`, `:161-191`).

## Changes

Implement a bounded serializable evidence projection/parser in core, local file reader and CLI command. Read an explicitly selected regular file with no-follow opening, reject symlinks, and verify inode/size/mtime after reading to detect replacement; error text tells the user to pass the actual stable JSON file. Maximum file 4 MiB and query 2 KiB; accept plain serialized case JSON and supported Case Lab envelope through an explicit parser, with no CLI dependency on Case Lab. Validate only recognized evidence fields and identities strictly; preserve absent legacy fields as unavailable, never invent them. File input cannot supply callable methods or commands. Ignore unneeded data such as full arbitrary trace bodies.

Build deterministic candidate blocks from diagnosis excerpt, executed verification/check evidence, search terminal reasons, policy identity and existing typed recovery actions. Stable IDs bind case identity + field path + content hash. Default lexical selection is provider-free and returns up to three original excerpts plus exact JSON field locators. `--semantic` explicitly discloses sending the redacted query and bounded candidate text to TypeSafe, requires a positive cap <=USD 0.002 and existing key, then uses Choice relevance plus applicability Noul. Return only validated existing IDs, original excerpts, typed action text and mode/provenance. Never manufacture a causal explanation. JSON schema has `matched | no-match | unavailable | invalid-input`, results and nextAction; invalid input exits 2, unavailable exits 1, matched/no-match exits 0. Provider outage may return lexical results labeled fallback while status remains unavailable. No network without --semantic.

```text
@ explain(file, query, options) -> EvidenceAnswer
ctx: bounded local reader, optional TypeSafe wrapper
pre: explicit file path; no repository scan or execution
do:
  1. parse and validate serializable projection and query
  2. compute bounded lexical evidence shortlist
  3. parse optional semantic IDs and validate membership
  4. emit original excerpts, locators, status and existing next action
br: no applicable evidence -> no-match; provider disabled -> lexical
fail: invalid file -> visible correction; provider error -> labeled lexical fallback
```

## Behavioral oracles

CLI args/dispatch and new explain integration tests use temporary local files with real parser and mocked external transport only. Cases: legacy report, Case Lab envelope, unknown schema, wrong numeric types, over-limit file, HTML/Markdown injection, secret redaction, duplicate/missing IDs, unrelated query, malicious action text and provider recovery. Assert zero shell execution/replay, zero fetch in lexical/invalid modes, no command is auto-run, and deterministic field locators survive formatting. Include golden query-to-evidence labels from at least 30 cases through Phase 2 evaluator; lexical baseline measured alongside semantic. Do not claim comprehension gains without a study.

Manual usability acceptance: on five fixed tasks (cause evidence, stopped gate, missing assurance, actual cost, next recovery action), owner can identify evidence and provenance from CLI output without insider knowledge. Record task answers/time and limitations; this is not an independent-user study. No hosted UI or new MCP interface is added.

## Work units and final delivery

After projection contract is fixed, core projection/ranker tests and CLI parser/dispatch/help tests are [batch-eligible] only if integration owner supplies stable exports first. Parent integrates command wiring, docs, package and consumer checks sequentially. Document local options, transmitted data, statuses and all disabled defaults. Re-run applicable parent gates; update evaluation guide with implementation status separate from live qualification. Deliver locally on develop and stop. No push, deployment or new default activation.

## Phase acceptance and handoff

Automated: all phase oracles below pass, consumer sweep updated, and the parent plan's sequential local gates and coverage complete on the integrated candidate. Record failed and repaired checks, exact identity, files, decisions, unresolved external evidence and next-phase entry. Manual: owner reviews the evidence and accepts the phase; no manual operation is required for offline validation. Live measurements require a separately authorized cap and disclosed input data. Implemented/offline-tested is not live-qualified. Stop here unless continuation was explicitly authorized.
