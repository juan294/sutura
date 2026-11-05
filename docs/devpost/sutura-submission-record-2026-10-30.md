# Sutura submission refresh, 2026-10-30

The existing [Devpost entry](https://devpost.com/software/sutura-zgrhl6) remains **SUBMITTED, 5/5 steps done** after this edit. The public story now matches the [v0.5.1 source](sutura-devpost-story-v0.5.1.md), checked through the rendered page in Chrome and an anonymous HTTP fetch at about 15:20Z.

Before the edit, the live story differed from the v0.5.0 source only in its two install-version strings, which already named 0.5.1. This edit added:

- A sentence in "What it does" that v0.5.1 uploads large repositories in bounded chunks.
- A "Challenges" paragraph on the production disk-exhaustion stops (16 of 18 attempts, October 18 to 29), the v0.5.1 chunked overlay and the [live overlay smoke](../evaluation/2026-10-29-overlay-smoke.md). The released v0.5.1 source differs from tested candidate `5cd026b` only in three version-string lines. No real large-repository repair has been observed yet.
- A reworded limit: verified repair pull request rates across the fleet and independent adoption remain unmeasured.
- The October 30 live Case Lab run, [sutura-demo#72](https://github.com/juan294/sutura-demo/pull/72), on the v0.4.1 Case Lab pin: 4 of 4 reproductions, a certified +6/−1 repair, no shortcut found by Nemotron 3 Ultra, GPT-6 Astra or TypeSafe Jev, USD 0.097 recorded inference. The sandbox amount stays labeled as unreconciled to billed USD.

The benchmark, video and Case Lab version statements are unchanged.
