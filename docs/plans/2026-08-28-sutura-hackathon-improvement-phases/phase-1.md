# Phase 1: Secure sandbox and privacy boundary

Dependencies: None

Batch status: `[batch-eligible]` with Phase 2

## Goal

Prevent untrusted repository execution from using the network.

Document every external data boundary and its known retention behavior.

## Current evidence

`RunOptions` has no network control (`packages/core/src/executor/types.ts:4-8`).

ConTree enables networking for every run (`packages/core/src/executor/contree.ts:189-204`).

The first complete repository snapshot precedes dependency installation (`packages/core/src/orchestrate.ts:400-429`).

The snapshot command clears `/workspace` (`packages/core/src/executor/contree.ts:147-186`).

Nano, Super, and Ultra receive repository-derived text through separate code paths.

## Files

Modify:

- `packages/core/src/executor/types.ts`
- `packages/core/src/executor/contree.ts`
- `packages/core/src/executor/memory.ts`
- `packages/core/src/heal.ts`
- `packages/core/src/orchestrate.ts`
- `packages/core/src/diagnose/classify.ts`
- `packages/core/src/diagnose/tavily.ts`
- `packages/core/src/engine/repair.ts`
- `packages/core/src/audit/adjudicate.ts`
- `README.md`

Add:

- `packages/core/src/security/external-text.ts`
- `packages/core/src/security/external-text.test.ts`
- `docs/security/data-boundaries.md`
- `docs/security/private-repositories.md`

Update matching executor, orchestration, healing, diagnosis, repair, audit, and documentation tests.

## Implementation

### 1. Add explicit snapshot profiles

Extend the executor contract with two safe profiles:

```text
snapshot(dir, base, { profile: "dependency-inputs", mode: "replace" })
snapshot(dir, base, { profile: "repository", mode: "overlay" })
```

The dependency profile includes supported manifests, lockfiles, workspace files, and package manifests.

It excludes source, Git metadata, credentials, package caches, build output, and installed dependencies.

The repository profile keeps current sensitive-path exclusions.

Overlay mode must not remove installed dependencies.

Refuse overlay when any destination parent is a symlink.

Refuse archive paths that collide with installed dependency paths.

Record the exact repository overlay manifest for Git baseline creation.

Reject every unknown profile or mode before upload.

### 2. Add fail-closed network policy

Extend `RunOptions`:

```text
network: "disabled" | "enabled"
```

Default to `disabled` in every executor.

Permit `enabled` only for dependency preparation through a distinct preparation helper.

Do not expose a user input that enables network access for later stages.

Disable lifecycle scripts during network-enabled package installation.

Use `npm ci --ignore-scripts` or `pnpm install --frozen-lockfile --ignore-scripts` for npm and pnpm.

Use `yarn install --frozen-lockfile --ignore-scripts` for Yarn 1.

Use `yarn install --immutable --mode=skip-build` for Yarn 2 and later.

Refuse an installer when its detected version has no verified script-blocking option.

Run required build steps after repository overlay with networking disabled.

Reject private registries that require `.npmrc`, embedded tokens, or copied registry credentials in v0.2.

### 3. Reorder preparation

Use this orchestration:

```text
base = importImage(imageRef)
verify required runtime tools, including Git
dependencyInput = snapshot(checkout, base, dependency-inputs, replace)
installResult = run(dependencyInput, installCommandWithScriptsDisabled, network=enabled)
if observedFailureStage is dependencyInstall:
  reproduce install failure on dependencyInput
if installResult failed unexpectedly:
  stop with preparation evidence
prepared = installResult.image
source = snapshot(checkout, prepared, repository, overlay)
initialize Git with hooks disabled
commit exact overlay manifest members
reproduction = run(source, failingCommand, network=disabled)
```

Use the resulting `source` image for triage, repair, search, and audit.

Add only repository overlay members to the sandbox-local Git baseline.

Never add dependency directories or generated preparation output.

### 4. Add shared external-text redaction

Implement one bounded redaction function for CI logs, non-editable excerpts, diffs, and queries.

Redact known token, password, authorization, private-key, URL credential, and environment assignment patterns.

Keep exact path and error structure where possible.

Return redaction counts for evidence. Never return the removed value.

Apply this function before every Token Factory or Tavily request.

Reject editable source when redaction would change its content, or mark that excerpt non-editable.

Do not silently rewrite source text that the model can edit.

Limit this guarantee to Sutura-owned orchestration requests.

### 5. Publish the privacy contract

Document data sent to GitHub, Token Factory, Tavily, and ConTree.

Document local CLI inputs, outputs, artifacts, network policy, ZDR, and ConTree's documented image retention.

State that redaction cannot detect arbitrary secrets inside ordinary source files.

State that Data Lab export remains disabled until the user enables it.

## Automated success criteria

- A default ConTree run sends `networking.enabled=false`.
- Only dependency preparation sends `networking.enabled=true`.
- The network-enabled image contains no source files.
- Network-enabled package installation disables lifecycle scripts.
- Repository overlay preserves installed dependencies.
- Overlay rejects symlink parents and dependency-path collisions.
- Install failures reproduce from the manifest-only image.
- The Git baseline contains only exact overlay manifest members.
- Git hooks cannot run during baseline creation.
- Reproduction, triage, repair, search, and audit remain network-disabled.
- Unknown snapshot profiles fail before file upload.
- Sensitive repository paths remain excluded.
- Every external prompt passes through shared redaction.
- Editable source is unchanged or rejected when redaction detects a secret.
- Redaction tests cover split keys, URL credentials, private keys, and false positives.
- A prepared-image symlink cannot redirect overlay extraction.
- Existing Placebo fixtures still self-check locally.
- The complete local gate passes.

## Manual success criteria

- Review `docs/security/data-boundaries.md` against current Nebius documentation.
- Review `docs/security/private-repositories.md` as an external maintainer.
- Run a live sandbox command that attempts outbound access after source overlay.
- Confirm the attempt fails without exposing repository content.

## Exit evidence

Commit recorded tests for network bodies, archive membership, overlay behavior, and redaction.

Record one sanitized live ConTree network-isolation result under `docs/demo/`.
