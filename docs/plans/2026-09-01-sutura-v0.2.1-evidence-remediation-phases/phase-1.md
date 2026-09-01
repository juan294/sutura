# Phase 1: Restore Python runtime and fail-early image proof

Status: Implemented locally; live ConTree proof pending authorization

## Goal

Replace the unavailable Python image digest with a verified immutable digest and prevent a release from using an unavailable runtime image.

## Work

1. Add a resolver/check script that reads the configured Python image, requires an exact digest, and rejects tags.
2. Import the candidate image through the same ConTree boundary used by repair execution.
3. On a network-disabled child, prove Python, `uv`, Git, and tar versions and execute the Python fixture preparation contract.
4. Store only the verified exact digest in the runtime constant and update the Action bundle.
5. Add the image proof to provider/ConTree canary evidence and to the release gate.
6. Add captured failure tests for a deleted digest, wrong tools, mutable tag, and runtime mismatch.

## Automated success criteria

- The exact old digest reproduces the captured unavailable-image failure offline.
- Mutable tags and unverified digests fail before repair inference.
- The selected exact digest passes tool, lockfile, preparation, and network-isolation tests.
- Python repair and refusal fixtures pass locally through the real runtime adapter.
- `pnpm run test:release-contracts`, typecheck, lint, build, and bundle verification pass.

## Manual success criteria

- Review the registry source, image provenance, and exact digest.
- Confirm the canary artifact contains no credential or registry authorization value.

Stop after the phase is integrated into local `develop` and its task worktree is removed.
