# Case Lab manual inspection, 2026-09-06

Real screenshots taken in Chrome against a local build of the Case Lab
(`node packages/case-lab/dist/bin.js build-site --out <dir> --api-base ""`,
served on `127.0.0.1:8788`). Case: `greenwash-trap`, recorded live result,
outcome refused.

| File | Width | What it shows |
| --- | --- | --- |
| `verdict-first-375x812.jpg` | 375 x 812, inside a fixed-size iframe harness | The verdict headline, reason, evidence line and next action all sit above the consent banner on the first screen. |
| `verdict-first-1440x1000.jpg` | 1440 x 1000, direct | The verdict leads; the mode note, expectation, identity and execution detail follow it. |

Chrome will not resize below roughly 500 CSS px, so the narrow capture embeds
the page in a 375 x 812 iframe on a local harness page. The grey surround in
that image is the harness, not the page.

Three defects found during this inspection and fixed in the same change:

1. The identity block sat in the header and pushed the verdict off the first
   screen at 375 px. Identity now renders after the verdict.
2. The mode note and the expectation line sat in the header for the same
   reason. Both qualify the verdict, so both now render after it.
3. The 40-character subject hash in the verdict evidence line is one unbroken
   token and ran past the right edge (document width 381 px against a 375 px
   viewport). `.verdict-evidence` now sets `overflow-wrap: anywhere`, and the
   document width is 375 px.

The consent banner was 259 px tall at 375 px because `.actions .button` forces
full width below 720 px, stacking Accept and Decline. The banner now keeps its
buttons inline and is 175 px tall.

Measured after the fix at 375 x 812: verdict spans 205 to 593, banner top 637,
no overlap, document width 375.
