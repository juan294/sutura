# Phase 10: Python project support

Dependencies: Phases 8 and 9

Batch status: Sequential

## Goal

Support verified repair for Python projects through the same security, policy, search, and audit contracts.

## Current evidence

The default sandbox image is Node 22 (`packages/core/src/heal.ts:37-38`).

Dependency preparation recognizes npm, pnpm, and Yarn (`packages/core/src/heal.ts:39-41`).

Source extraction excludes Python extensions (`packages/core/src/orchestrate.ts:37-38`).

The failure taxonomy has no language-specific type (`packages/core/src/domain.ts:1-10`).

The architecture already accepts generic failing commands and unified diffs.

## Files

Add:

- `packages/core/src/runtime/types.ts`
- `packages/core/src/runtime/detect.ts`
- `packages/core/src/runtime/node.ts`
- `packages/core/src/runtime/python.ts`
- matching test files
- Python fixtures under `packages/placebo/corpus/`

Modify:

- `packages/core/src/heal.ts`
- `packages/core/src/orchestrate.ts`
- `packages/core/src/config.ts`
- `packages/core/src/domain.ts`
- `packages/core/src/diagnose/classify.ts`
- `packages/core/src/engine/patch-rules.ts`
- `packages/core/src/audit/mechanical.ts`
- `packages/core/src/index.ts`
- `packages/action/src/input.ts`
- `packages/action/src/main.ts`
- `packages/cli/src/heal.ts`
- action metadata, installer, doctor, and README files
- `packages/placebo/src/types.ts`
- `packages/placebo/src/corpus.ts`
- workspace lockfile

Update matching tests and rebuild the action and CLI bundles.

## Runtime adapter contract

```text
RuntimeAdapter {
  id: "node" | "python"
  imageRef
  requiredTools
  detect(evidence)
  dependencyInputs
  preparationCommand
  normalizeCommand
  sourceExtensions
  policyRules
}
```

Keep Node behavior inside `runtime/node.ts` without changing its verified semantics.

## Detection

Detect Python through bounded evidence:

- `pyproject.toml`
- `uv.lock`
- `poetry.lock`
- `requirements.txt`
- `requirements-dev.txt`
- `pytest.ini`
- `ruff.toml`
- Python source paths in failed logs
- `pytest`, `ruff`, `mypy`, or `python -m` failing commands

Use `.sutura.json` runtime selection when the repository is intentionally polyglot.

Fail closed when automatic evidence selects multiple runtimes with equal confidence.

## Python preparation

Use `ghcr.io/astral-sh/uv@sha256:47965cdc9d53a515f68f78241161c901e70051ce428f12e791bd7fe19f6a631a`.

The verified image contains Python 3.13.11, uv 0.9.30, Git 2.39.5, and GNU tar 1.34.

Require a live ConTree import probe for the exact digest and every required tool.

Support dependency preparation in this order:

```text
uv.lock -> uv sync --frozen --no-install-project --no-build
requirements.txt -> python -m pip install --require-hashes --only-binary=:all: --requirement requirements.txt
pyproject.toml without lock -> stop with a deterministic lockfile requirement
```

Run preparation before repository overlay with networking enabled.

Run project commands after overlay with networking disabled.

Do not execute repository build hooks during network-enabled preparation.

Reject editable installs, local paths, VCS references, repository includes, and unsupported workspaces.

Bound recursive requirement includes before accepting them.

Refuse dependencies that require a source build or PEP 517 execution.

## Python repair safety

Add mechanical detection for:

- deleted Python tests
- `pytest.mark.skip` and `pytest.skip`
- removed assertions
- broad `# type: ignore`
- broad `# noqa`
- relaxed Ruff or Mypy configuration
- widened Pytest ignore patterns
- swallowed exceptions

Repository policy remains stronger than runtime defaults.

## Placebo Python set

Add at least these deterministic fixtures:

- missing `await`
- wrong import
- type mismatch
- cache key defect
- flaky timer
- skipped test trap
- broad type-ignore trap
- swallowed exception trap

Use hidden verification for repair and trap cases.

Finalize `CORPUS_VERSION = '0.2'` after adding the Python fixtures.

Create the final v0.2 corpus manifest and hash in this phase.

## Automated success criteria

- Runtime detection selects Node and Python deterministically.
- Ambiguous polyglot detection fails with configuration guidance.
- Python dependency preparation sees no source files.
- The exact runtime image provides Python, uv, Git, and tar.
- Networked preparation accepts only locked binary dependencies.
- Editable, local, VCS, source-build, and unsupported workspace dependencies stop deterministically.
- Python test and repair commands have no network.
- Python source extraction remains bounded and symlink-safe.
- Python unsafe shortcuts fail before execution or publication.
- Every Python fixture self-checks.
- Python Placebo results retain zero false approvals.
- Node Placebo results do not regress.
- The clean installation matrix supports one Node and one Python repository.
- The complete local gate passes.

## Manual success criteria

- Import and run the pinned Python image through live ConTree.
- Complete one Python repair and one Python refusal in a clean external repository.
- Confirm both reports identify the Python runtime and exact evidence.

## Exit evidence

Publish separate JavaScript and Python benchmark measures.

Do not combine language scores into one repair-rate claim without both denominators.
