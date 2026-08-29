# Phase 5: Exact-SHA CI and final live dogfood proof

## Goal

Prove the locally fixed controller with one exact remote candidate and one end-to-end repair pull request.

## Preconditions

- Phases 1-4 are committed in one isolated implementation branch.
- The complete local gate is green.
- The action bundle matches source.
- Simplification reviews are clean.
- The root worktree contains only the preserved user-owned `docs/demo/thumbnail/` change plus the intended integration state.

## Implementation

1. Fast-forward the implementation branch into local `develop`.
2. Push one exact `develop` SHA and wait for terminal CI.
3. If CI is not green, return to the local replay cycle before another push.
4. From the green exact SHA, create one fresh dogfood branch with the arithmetic test and subtraction implementation.
5. Push it and dispatch CI once.
6. Wait for the intentional CI failure and the paired Sutura workflow.
7. Require `fixed`, one repair PR, the exact addition-only patch, exact-parent identity, and an action check bound to the failed SHA.
8. Wait for every applicable repair-PR workflow to finish green.
9. Capture URLs and SHAs in the implementation notes.
10. Remove task-owned local worktrees and local branches. Preserve remote dogfood and repair branches as public evidence unless separately authorized for remote deletion.

## Automated success criteria

- Exact `develop` SHA CI is green.
- Intentional dogfood CI is red for the declared assertion only.
- Sutura outcome is `fixed`.
- The generated repair commit changes `left - right` to `left + right` and changes no test, workflow, policy, or dependency file.
- The repair commit is a direct child of the dogfood SHA.
- Repair PR CI is green.
- Local `develop` matches `origin/develop`.
- All task-owned local worktrees and local branches are removed.

## Exit evidence

Report the exact develop SHA, develop CI URL, dogfood SHA, intentional CI URL, Sutura workflow URL, repair PR URL, repair commit SHA, repair PR CI URL, and final local status.
