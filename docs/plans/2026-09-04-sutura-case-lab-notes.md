# Sutura Case Lab implementation notes

Plan: `docs/plans/2026-09-04-sutura-case-lab.md`

## Deviations

### Phase 5: browser-side validation is structural, not the full validator

Plan said: the result page fetches the live JSON and renders it.

Found: `validateCaseLabResult` depends on `node:crypto` and `Buffer`, which the browser bundle cannot carry.

Chose: `isRenderableResult` in `render.ts` checks the schema version, case id, mode, outcomes, request id, and object shapes before rendering; the full validator runs in Node when the document is written and in the acceptance script.

Why: the renderer escapes every value, so a malformed document can only fail to render, never inject; the hash-verified validation still gates publication and acceptance.

### Phase 5: manual mobile review used a 375 px iframe harness

Plan said: review at 375 px and 1280 px in a browser.

Found: the desktop Chrome window on this machine cannot shrink to 375 px.

Chose: reviewed 1280 px directly and 375 px through a temporary local page embedding the index, the greenwash-trap result, and the javascript-repair candidates in 375 by 812 iframes; the media query applies to the iframe viewport. Single column, wrapped diff, no horizontal scroll, badges legible. The harness file was deleted after the review.

### Phase 6: the workflow reproduces the case file with the released CLI, not with the Case Lab tooling

Plan said: `publish-result` replays the bundle into a `CaseFile`.

Found: research section 2.3 records that a bundle replays only against the Sutura commit family that recorded it, and the tooling checkout (`SUTURA_CONTROLLER_SHA`, a `develop` commit) is not the release commit that ran the Action.

Chose: the workflow installs `sutura@<release.json version>` from npm and runs its `replay --bundle ... --format json`, then `publish-result` validates that case file and only cross-checks the bundle's `actionSha` and outcome. `capture-replay` replays a downloaded bundle with the current core before writing a fixture and refuses one that does not replay, so a drifted fixture can never break the catalog build.

Why: the released package is the exact identity that produced the recording; replaying with another commit would fail closed and publish results without a case file.

### Phase 6: the controller pin is set after the first push

Plan said: `SUTURA_CONTROLLER_SHA` names a `develop` commit that contains `packages/case-lab`.

Found: no such commit exists until this work is on `develop`.

Chose: the committed workflow carries a zero sha that `verifyPin` rejects; after the integrated commit is pushed, `case-lab verify-pin --set-controller <sha>` writes the real value into the committed copy, the demo repository receives the byte-identical file, and `verify-pin --tag v0.2.0` proves the tag, the file, the controller commit, and the demo copy agree. The pin test accepts either state and the verify step is recorded below.

### Phases 2 and 3: throttling is global, not per visitor

Plan said: request throttling, concurrency limits, a daily spend stop, and an emergency disable.

Found: the dispatcher is stateless and GitHub run accounting is the only durable counter; per-visitor identity would require storing visitor markers in public run names.

Chose: global limits only (one concurrent run, four per rolling hour, eight per UTC day derived from the USD 6.00 daily stop and the USD 0.75 worst-case run), enforced in the dispatcher and again in the workflow.

Why: the total caps bound spend regardless of who calls; a per-visitor limit adds no spend protection and would put visitor-derived data into public run names.

### Phase 2: link hosts, link keys, and error wording

Plan said: links are `https://github.com/` only; the contract lists eight link keys; invalid counts throw `run counts must be nonnegative integers`.

Found: the live result document itself is served from `raw.githubusercontent.com`, the live path produces a repair pull request distinct from the broken one, and a per-field message names the field the operator must fix.

Chose: allow exactly the two GitHub hosts, add `repairPullRequest` and `atifTrajectory`, and throw `<field> must be a nonnegative integer`. The plan's contract text was amended in the same commit.

Accepted residual: nested case-file keys beyond the validated ones pass through unchanged; the case file comes from Sutura's own pipeline, every value is escaped when rendered, and the public-safety and size checks still apply.

### Phase 3: wrong method answers 405 with Allow, not 404

Plan said: a non-POST request to the dispatch path answers 404.

Found: 405 with an `Allow: POST` header is the HTTP contract for a known path.

Chose: 404 for unknown paths, 405 for a wrong method, 415 for a wrong content type; the tests pin these codes.

## Verification record

- Phases 2 to 6: `pnpm --filter @sutura/case-lab test` 103 tests, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` green at each phase commit.
- Demo repository: `pnpm test` 24 tests, `pnpm run lint`, `pnpm run typecheck`, `pnpm run verify:readme` green at the demo commit.
- Manual: desktop 1280 px and mobile 375 px review of `/`, `/replay/javascript-repair/`, `/replay/greenwash-trap/` on the local build, 2026-09-04.
