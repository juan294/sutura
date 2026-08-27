# Third-party notices for the vendored test runtimes

The archives retain the license files shipped by their packages. The packages
below do not ship a complete license text in their npm payload. This index
records their declared SPDX license and supplies the corresponding license
terms. Keyv's upstream file omits the MIT grant and retention clauses, so its
bundled text reconstructs the standard terms around the upstream copyrights.
`stackback` declares MIT in its published package metadata, but its upstream
repository has no license file, so its text is reconstructed from the standard
MIT terms and its package-author attribution.

| Package | Declared license | Bundled upstream text | Upstream source |
| --- | --- | --- | --- |
| `@humanfs/types@0.15.0` | Apache-2.0 | `licenses/Apache-2.0.txt` | `humanwhocodes/humanfs` tag `types-v0.15.0`, `packages/core/LICENSE`; no NOTICE exists at that tag |
| `@rolldown/binding-darwin-arm64@1.2.5` | MIT | `licenses/rolldown-MIT.txt` | `rolldown/rolldown` LICENSE |
| `@rolldown/binding-linux-x64-gnu@1.2.5` | MIT | `licenses/rolldown-MIT.txt` | `rolldown/rolldown` LICENSE |
| `@rolldown/binding-linux-x64-musl@1.2.5` | MIT | `licenses/rolldown-MIT.txt` | `rolldown/rolldown` LICENSE |
| `esrecurse@4.3.0` | BSD-2-Clause | `licenses/esrecurse-BSD-2-Clause.md` | `estools/esrecurse` LICENSE.md |
| `ignore@5.3.2` | MIT | `licenses/ignore-MIT.txt` | `kaelzhang/node-ignore` LICENSE-MIT |
| `imurmurhash@0.1.4` | MIT | `licenses/imurmurhash-MIT.txt` | `jensyt/imurmurhash-js` LICENSE |
| `keyv@4.5.4` | MIT | `licenses/keyv-MIT.txt` | reconstructed standard MIT terms with `jaredwray/keyv` LICENSE copyrights |
| `natural-compare@1.4.0` | MIT | `licenses/natural-compare-MIT.txt` | `litejs/natural-compare-lite` LICENSE |
| `punycode@2.3.1` | MIT | `licenses/punycode-MIT.txt` | `mathiasbynens/punycode.js` LICENSE-MIT.txt |
| `stackback@0.0.2` | MIT | `licenses/stackback-MIT.txt` | reconstructed standard MIT terms with `shtylman/node-stackback` package-author attribution |
