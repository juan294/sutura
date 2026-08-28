# Phase 6: Evaluation Lab records and ATIF export

Dependencies: Phase 5

Batch status: Sequential

## Goal

Make every model, prompt, tool, search, and routing experiment reproducible.

Export sanitized agent trajectories for NVIDIA NeMo Agent Toolkit.

## Current evidence

Placebo stores only case results and scores (`packages/placebo/src/types.ts:46-63`).

The core `CaseFile` stores final evidence, not model and tool trajectories (`packages/core/src/domain.ts:82-91`).

The CLI prints one serialized result (`packages/cli/src/cli.ts:98-104`).

ATIF provides an interoperable agent trajectory format.

Source: [NVIDIA ATIF evaluation example](https://github.com/NVIDIA/NeMo-Agent-Toolkit/blob/develop/examples/evaluation_and_profiling/simple_web_query_eval/atif-eval-readme.md).

## Files

Add package:

- `packages/evaluation/package.json`
- `packages/evaluation/tsconfig.json`
- `packages/evaluation/tsconfig.build.json`
- `packages/evaluation/pyproject.toml`
- `packages/evaluation/uv.lock`
- `packages/evaluation/scripts/validate-atif.py`
- `packages/evaluation/src/schema.ts`
- `packages/evaluation/src/validate.ts`
- `packages/evaluation/src/atif.ts`
- `packages/evaluation/src/jsonl.ts`
- `packages/evaluation/src/manifest.ts`
- matching test files

Add core tracing:

- `packages/core/src/trace/types.ts`
- `packages/core/src/trace/recorder.ts`
- `packages/core/src/trace/sanitize.ts`
- matching test files

Modify:

- `packages/core/src/llm/nebius.ts`
- `packages/core/src/engine/repair-agent.ts`
- `packages/core/src/engine/search.ts`
- `packages/core/src/heal.ts`
- `packages/core/src/domain.ts`
- `packages/core/src/index.ts`
- `packages/placebo/src/harness.ts`
- `packages/placebo/src/types.ts`
- `packages/placebo/src/cli.ts`
- `packages/cli/src/args.ts`
- `packages/cli/src/cli.ts`
- `packages/cli/package.json`
- root workspace scripts and lockfile

## Trace contract

Use a versioned discriminated event union:

```text
run-start
model-request
model-response
tool-request
tool-result
sandbox-operation
search-decision
candidate-submitted
audit-result
run-finish
```

Every event includes a run ID, sequence, timestamp, stage, and schema version.

Model events include role, actual model ID, tokens, latency, cost, and request ID.

Tool events include tool name, validated argument summary, result summary, and child node ID.

Never store credentials, hidden reasoning, full source, or unbounded logs.

Use hashes and bounded excerpts where full content is not required.

Normalize timestamps to monotonic offsets from `run-start` for deterministic exports.

Order events by sequence, then event type. Normalize request IDs before result hashing.

Apply shared redaction to tool results and every trace event before storage.

## Evaluation manifest

```text
EvaluationManifest {
  schemaVersion
  evaluationId
  suturaCommit
  corpusName
  corpusVersion
  corpusHash
  adapterVersion
  modelCatalogSnapshot
  routingProfile
  budgetProfile
  cases[]
  startedAt
  completedAt
  resultHash
}
```

Require a clean, exact commit for a publishable manifest.

Retain unsuccessful cases in the denominator.

## ATIF mapping

Map messages, tool calls, tool results, model identifiers, and final outcomes into ATIF.

Use the Sutura run ID as the trajectory ID.

Represent ConTree lineage as tool metadata without exposing internal URLs.

Pin NeMo Agent Toolkit commit `23cd127dfba56994cd272f2771350d0ec13f3dd1` in `uv.lock`.

Pin `uv==0.12.7` for the validation environment.

The validator imports `nat.atif.trajectory.Trajectory` and calls `model_validate_json`.

Run this exact validation command:

```bash
uv run --project packages/evaluation python packages/evaluation/scripts/validate-atif.py /tmp/sutura-eval/trajectory.atif.json
```

## Data Lab profile

Keep Data Lab export disabled by default.

Create sanitized JSONL for explicit dataset import.

Before adding direct upload, verify the current official API contract through a recorded contract test.

If the current API lacks the required import operation, retain local JSONL and record that gap in Nebius feedback.

Do not disable ZDR automatically.

## CLI

Add these commands:

```text
sutura eval validate --manifest /tmp/sutura-eval/manifest.json
sutura eval export --manifest /tmp/sutura-eval/manifest.json --format atif --output /tmp/sutura-eval/trajectory.atif.json
sutura eval export --manifest /tmp/sutura-eval/manifest.json --format jsonl --output /tmp/sutura-eval/data-lab.jsonl
```

Use bounded reads and exclusive output creation unless `--force` is explicit.

## Automated success criteria

- Event sequences are monotonic and schema-valid.
- Sanitization removes secret-shaped values from every event.
- Hidden reasoning never appears in traces.
- Manifests bind the exact commit, corpus hash, profiles, and results.
- Failed and refused cases remain in output.
- Repeated export produces identical normalized ATIF and JSONL.
- Timestamps and request IDs cannot change normalized result hashes.
- Invalid or oversized input fails before output creation.
- ATIF passes the pinned NeMo validator.
- CLI bundle tests include the evaluation package commands.
- Existing Placebo scores remain unchanged for identical case results.
- The complete local gate passes.

## Manual success criteria

- Profile one exported trajectory with NeMo Agent Toolkit.
- Confirm the profile reports model, tool, token, and latency data.
- Inspect one Data Lab import with sanitized evaluation records when the supported import path exists.

## Exit evidence

Commit one small sanitized example manifest and ATIF trajectory under `docs/demo/`.

Record the exact NeMo version and validation command.
