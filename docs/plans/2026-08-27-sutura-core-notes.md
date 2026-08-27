# Sutura Core Plan Notes

Plan: `2026-08-27-sutura-core.md`

## Deviations

### GitHub Action runtime

- Plan said: Define a Node 22 JavaScript Action.
- Found: GitHub Action metadata supports `node20` and `node24`, but not `node22`; the repository requires Node 22 or later.
- Chose: Use the supported `node24` Action runtime and bundle target.
- Why: Node 24 preserves the repository runtime floor and produces metadata that GitHub can load.

### Phase 10 execution entrypoints

- Plan said: Trigger repairs from failed CI and run Placebo against Sutura in Phase 10.
- Found: The committed Placebo adapter needed a missing `sutura heal` command, and pull requests created with `GITHUB_TOKEN` do not start normal pull-request workflows.
- Chose: Add the shared CLI repair entrypoint and a trusted exact-SHA `workflow_dispatch` CI path during Phase 9.
- Why: Phase 10 cannot execute the live Placebo benchmark or unattended break-me demo without these entrypoints.
