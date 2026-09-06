# Paid run manifests

Each manifest is a reviewable request for one paid measurement. Authorization
starts at zero and is scoped per manifest: approving one approves nothing else,
and no manifest here has been dispatched.

Rebuild and reprice any manifest with the validator that enforces its caps:

```bash
node --input-type=module -e "
import { manifestMaximumUsd, validateRunManifest } from './scripts/verified-program-evidence.mjs';
import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync('docs/demo/run-manifests/preflight-contract-v1.json', 'utf8'));
console.log(validateRunManifest(m).manifestHash, manifestMaximumUsd(m));
"
```

## Staged ladder

The plan runs these in order, and each stage gates the next. A failure at any
stage stops every dependent job rather than continuing to the next.

| Stage | Manifest | Subjects | Priced maximum | Spend cap | What it decides |
| --- | --- | --- | --- | --- | --- |
| 1 | `preflight-contract-v1` | 6 | USD 0.12 | USD 1.00 | Whether the provider, the pinned image and the typed-probe protocol work at all. Not a quality benchmark. |
| 2 | `development-smoke-v1` | 6 | USD 0.98 | USD 3.00 | Whether six known controls behave: a repair, a green-but-broken trap, a missing await, a two-file pair, a flake and a policy refusal. |
| 3 | not yet written | 60 + 20 | — | — | Development and validation comparisons. Needs stage 2 green before it is worth pricing. |
| 4 | not yet written | 20 | — | — | The held-out estimate, opened once, with the runtime configuration frozen beforehand. |

Stages 3 and 4 are deliberately absent. Writing them before stage 2 has run
would price a run whose shape depends on what stage 2 finds.

## How the priced maximum is computed

Every turn is priced at the most expensive model the manifest names, with the
full input and output token allowance, and each subject may take
`modelTurnsPerSubject` of them per repetition. It is a ceiling, not an
estimate: a request that can only be approved on an optimistic average is not a
bounded request.

The spend cap is separate and lower-bounding: whichever of the two is smaller
is what the run can spend. Sandbox operations, elapsed time, raw sandbox units
and concurrency are capped independently, and none of them has a default.

## Identities

All manifests here are bound to:

| Field | Value |
| --- | --- |
| Candidate commit | `303a571dee985c6c25b5b44364490a1feb92e9e0` |
| Runtime image | `node:22` at `sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d` |
| Corpus (expanded, 100 cases) | `ed58d316397157fca580e1a74ba9fcde8af1bd6c580137b3a09af47c48b768f6` |
| Split | `49fb4609a602e609a6f31596522a4b229b3fc56ba670ce6a29d764905364a683` |
| Configuration | `eadefeea0455a6a88202a6f1c5e978bafd9d1326222c4a15306b53baa5f6bf0b` |

A result recorded under any other candidate, image, corpus, split, config,
model or price is refused by `validateRunEvidence`, so evidence cannot be
carried from one manifest to another.

## Before dispatching

1. `pnpm run push-freeze on --reason "<manifest id>"` — the pre-push hook then
   refuses to push while the run is live, so the candidate cannot move under it.
2. Check credentials by presence only: `NEBIUS_API_KEY`, `CONTREE_TOKEN`,
   `CONTREE_PROJECT`, `TAVILY_API_KEY`. Never print a value.
3. Dispatch the approved manifest and nothing else.
4. `pnpm run push-freeze off` once every dispatched job is terminal or
   explicitly cancelled and recorded.
