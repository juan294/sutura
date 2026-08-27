# Vendored test runtime

The two `placebo-test-runtime-*-node_modules.tgz` archives are pnpm-resolved
installations of the real Vitest 4.1.11, TypeScript 6.0.3, and ESLint 10.9.1
dependency trees. One targets Darwin ARM64 and one targets Linux x64. Placebo
selects the archive that matches `process.platform` and `process.arch`.

Each archive lets a temporary corpus layout complete
`pnpm install --offline --frozen-lockfile --trust-lockfile` with a new, empty
pnpm store.

The archives retain package payloads and their shipped license files.
`THIRD_PARTY_NOTICES.md` supplies and verifies license terms for payloads that
omit a complete text.

Build either target from the checked-in source lockfile and target-specific
`supportedArchitectures` config with:

```sh
./scripts/build-test-runtime.sh darwin-arm64
./scripts/build-test-runtime.sh linux-x64
```

The script uses pnpm 11.22.0 in the pinned multi-platform
`node:22-bookworm@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d`
image. It normalizes pnpm timestamps, creates two independent GNU-tar streams
with sorted paths, epoch mtimes, numeric ownership, GNU format, no xattrs, and
deterministic gzip output, then requires the two byte strings to match. The
verifier rejects unsafe paths, escaping symlinks, wrong or foreign native
bindings, wrong pnpm metadata, and missing or mismatched license coverage.

Two full fresh-container builds of each target produced identical hashes. The
committed archives have these SHA-256 values:

- Darwin ARM64: `ede05b7c2e3348df0e19080a5e8e9717554839c5b87f2f8700ba96cfc6a4d02f`
- Linux x64: `755d2ba233a879b21562d64a9ca8b2f07c83678018033edcf6d90880744820aa`
