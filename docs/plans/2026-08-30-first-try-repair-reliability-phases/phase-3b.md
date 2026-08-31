# Phase 3b: Guard tests — provider, Tavily, ConTree, routing `[batch-eligible]`

## Goal

Every guard in `packages/core/src/llm/{nebius,json,token-factory,router,cost,provider-contract-canary}.ts`,
`packages/core/src/diagnose/tavily.ts`, and
`packages/core/src/executor/{contree,memory,live-diagnostics}.ts` is reached
by a test. Before Phase 5, provider, Tavily, and ConTree HTTP guards use
labeled synthetic fixtures; the authorized Phase 5 capture session replaces
applicable shapes and closes the captured-boundary pending count.

Research baseline (VERIFIED 2026-08-30): nebius 14/25, json 4/4, token-factory +
router + cost 3/11, canary 6/9, tavily 2/18, contree + memory +
live-diagnostics 18/54. Acceptance: the Phase 3b subset of the
run-time-derived `N/N` is complete.

## Files

Add captured fixtures under `packages/core/src/__fixtures__/captured/`:

- `provider/<canary-run-id>/bundle.json` — one real Super exchange recorded by
  the Phase 5 authorized canary. Before that authorization, provider boundary
  tests remain explicitly pending and synthetic contract tests cover shapes.
- `provider/error-shapes/*.json` — real 400/401 bodies captured by sending
  deliberately malformed requests to the exact endpoint during the same
  authorized session; includes the live-16 `reasoning_effort: none` 400 body.
  429/503 remain labeled synthetic until observed provider bodies exist.
- `tavily/<capture-id>/bundle.json` — one real search exchange and one real
  extract exchange from the Phase 5 authorized capture session.
- `contree/<capture-id>/bundle.json` — from the first Phase 5 live run, or
  from one authorized sandbox smoke (`contree.live.test.ts` shape) with the
  recorder attached; until then, ConTree guard tests use the existing
  `executor/__fixtures__/*.json` and are listed as pending in the manifest
  `boundaries` field so the contract test counts them.

Modify tests only:

- `packages/core/src/llm/nebius.test.ts` — transport failures (`:454`,
  `:464`, `:502`) via a rejecting `fetch`; remaining response-shape guards
  from captured error bodies.
- `packages/core/src/llm/router.test.ts` (new), `cost.test.ts`,
  `token-factory.test.ts`.
- `packages/core/src/llm/provider-contract-canary.test.ts` — the three
  unreached checks, including the shadowed `:179` (construct a reply that
  passes `nebius.ts:103` but has empty usage totals).
- `packages/core/src/diagnose/tavily.test.ts` — drive `TavilyClient` itself
  (not a literal `{search, extract}`) with the captured exchange and mutated
  variants for all 16 unreached guards.
- `packages/core/src/executor/contree.test.ts` — dependency-snapshot path
  safety, archive path safety, size and count caps, response-shape guards,
  the `.npmrc` under `profile: repository` case reaching `:991`, and the
  non-git branches at `:869`/`:881`.

## Implementation

1. Derive the guard checklist with the Phase 3c scanner so inline and
   multiline `throw`, `process.exit`, and `core.setFailed` forms are included.

2. During the separately authorized Phase 5 capture session, record with the Phase 1
   recorder through `createTokenFactoryClient({apiKey}, {fetch: recordingNebiusFetch(...)})`):
   - the canary request/response (success shape);
   - the same request with `reasoning_effort: 'none'` (expected 400 — the
     live-16 terminal, captured verbatim);
   - an invalid model id (expected 4xx);
   - an invalid key (expected 401);
   - a `max_tokens` above the endpoint limit (expected 400).
   Redact and commit; add manifest entries with `kind: 'provider-capture'`,
   `source` pointing at the canary workflow run when run there, or the
   git commit of the capture when run locally with `capturedBy: 'local'`.

3. Rewrite `repair-provider-replay.test.ts` responses for runs 12, 15, 16 to
   use the captured error bodies and usage blocks; keep the others inline
   until Phase 5 produces their captures.

4. During the separately authorized Phase 5 capture session, capture one real `search` response with the query used by
   `tavily.live.test.ts` and one real `extract` response; guard tests mutate
   fields (missing `results`, non-https URL, oversized snippet, non-array
   citations) on the applicable captured body.

5. ConTree: for the 35 unreached guards, construct inputs per guard; for
   response-shape guards prefer the captured bundle once it exists; for
   filesystem guards use temp directories.

6. Shadowed guards: for each, write the input that satisfies the earlier
   check; if impossible, delete the guard and document.

## Automated success criteria

- The checklist test `packages/core/src/guards-3b.test.ts` (same mechanism as
  3a) reports the derived subset as complete until `guards:verify` replaces it.
- Before Phase 5, `nebius.test.ts` names the live-run-16 400 regression and
  asserts the exact known error shape from a labeled synthetic fixture; Phase
  5 replaces it with the captured body without changing the assertion.
- Before Phase 5, `tavily.test.ts` drives `new TavilyClient(key, {fetch})` for
  all guards with labeled synthetic fixtures; Phase 5 replaces applicable
  search and extract shapes with captured exchanges.
- No committed capture contains a credential (contract test).
- Core suite passes; `pnpm run ci:fast` passes.

## Manual success criteria

None before the Phase 5 authorization stop. The provider, Tavily, and ConTree
captured-boundary entries remain explicit pending items until that session.

## Exit evidence

Record the checklist and which provider, Tavily, and ConTree guards remain on
synthetic fixtures pending the Phase 5 capture session (must be zero after
Phase 5).
