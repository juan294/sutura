# Live repository-overlay capacity smoke, 2026-10-29

The unpublished source candidate `5cd026be9dd962e94eb3e307d92ffb7af82e95f2` completed one live CLI repair on ConTree, with outcome **fixed**, approved audit and passed runtime-candidate verification. The CLI bundle SHA-256 was `c7d7b2e67cf1c85de469fe4044c0e86e140cd45fc194740e1969280ac5f81ebd`.

The synthetic Node subject contained 151,035,450 source bytes, including three 48 MiB files. Before repair, its arithmetic assertion failed and its large-file integrity assertion passed. The source repair changed only `page-count.js`, replacing `Math.floor(items / size) + 1` with `Math.ceil(items / size)`. Both frozen tests passed afterward, including length and SHA-256 checks for all three large files.

The [chunk implementation](../../packages/core/src/executor/contree.ts#L265) uploaded archives of **50,340,864**, **50,334,208** and **50,379,776** bytes. Each extracted successfully, with networking disabled, using the preceding chunk's result image. The complete overlay manifest was attached to the first chunk. All 15 provider operations reached `SUCCESS`; no retry or second repair attempt was dispatched.

Nemotron Nano, Super and Ultra made three calls, totaling **USD 0.005908** at the recorded token prices. Sandbox resource amounts remain raw diagnostic units, without an inferred billed-USD conversion. Optional OpenAI and TypeSafe auditors were not configured; Jev decision roles were off.

This measures one synthetic Node capacity case. It does not establish a new benchmark score, fleet repair, hosted GitHub Action delivery, Python behavior or Jev qualification. Runtime verification passed with optional challenges absent (`challengeAssurance: false`). Published v0.5.0 and the historical v0.4.1 benchmark remain separate identities.

The local CI mirror, package installation, all 4,022 package tests, core/Action coverage and 859/859 guards passed before dispatch. Twelve core tests were skipped on this platform. The private controller retained the full request/operation journal and result; result SHA-256: `b4ee8783cad193083fcbc4df56e8c43bf8aa2d8e7e025487c245d2ec85e01a68`.
