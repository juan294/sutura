# Phase 1: Chunked repository overlay

Parent: [ConTree repository overlay chunking](../2026-10-29-contree-overlay-chunking.md). Dependency: none. Local only; no push, dispatch, release or provider call. Work in a separate local worktree.

## Outcome

`ContreeExecutor.snapshot` with `profile: 'repository'` and `mode: 'overlay'` splits an archive larger than `overlayChunkBytes` (default 64 MiB) into sequential chunk instances. The returned image holds every overlay file, the prepared dependencies and the complete overlay manifest. Archives that fit in one chunk produce the same requests as today.

## Implementation

1. **Planner (new file `packages/core/src/executor/overlay-chunks.ts`).** A pure function takes the sorted file list with sizes and the budget and returns ordered groups. It uses a tar size estimate per file (512-byte header, data rounded up to 512, plus 1,024 bytes when the path exceeds 100 bytes) and fills each group greedily in path order. A file whose estimate exceeds the budget raises a `ContreeError` naming the path and size. Add the unit tests first.
2. **File sizes.** `createSnapshotArchive` (`contree.ts:1250`) already lists files; read sizes with `lstat` for regular files (symlinks count as header only). Reuse `validateSnapshotFiles` data where possible rather than a second pass.
3. **Archive set.** For the overlay profile build one tar and one members file per group. Keep the single-archive code path untouched when the planner returns one group, and keep the full manifest file (`manifest.bin`) as today.
4. **Command.** Extend `snapshotCommand` (`contree.ts:718`) with an optional members path. With no members path the output string is exactly today's. With one, the `xargs` validation reads the members file, the tar extraction is unchanged, and the command removes the members file at the end.
5. **Upload and chain.** In `snapshot` (`contree.ts:210`) upload the full manifest once. For chunk 1 inject tar, members and full manifest. For later chunks inject tar and members only. Run the instances sequentially, each on the previous `result_image_uuid`, and return the last. Use the existing `instanceLimit` and `spawn` path so cancellation, polling and `completions` behave as today.
6. **Config.** Add `overlayChunkBytes?: number` to `ContreeExecutorConfig`; reject non-positive or non-integer values in the constructor with the same style of message as `maxOps`.
7. **Cleanup.** Remove every temporary archive and members file in the existing `finally` path, including when a middle upload fails.

```text
@ planOverlayChunks(files[{path,size,isSymlink}], budget) -> string[][]
pre: files sorted; budget positive integer
do:
  1. compute tarEstimate(file) per file
  2. refuse file with estimate > budget (name path, size)
  3. fill groups in order until next file would exceed budget
  4. return groups; one group means single-archive path
fail: oversize file -> ContreeError before any upload
risk: estimate below real tar size -> verify real tar size <= budget after tar -cf
```

```text
@ ContreeExecutor.snapshot(dir, base, options) -> ImageId  [overlay]
ctx: files upload, instances spawn, poll
pre: groups = planOverlayChunks(...)
do:
  1. if one group -> existing path, unchanged requests
  2. upload full manifest once
  3. for each group: upload tar + members; spawn on previous image
  4. poll; stop chain on first FAILED
  5. return last result image
fx: N+1 provider uploads, N instances, N checkpoint images
fail: real tar > budget -> ContreeError naming chunk and bytes
risk: chunk 1 must inject the full manifest or the Git baseline misses files
```

## Files and work units

Sequential; the units share `contree.ts`, so no `[batch-eligible]` split.

- **A (first):** `packages/core/src/executor/overlay-chunks.ts`, `overlay-chunks.test.ts`.
- **B:** `packages/core/src/executor/contree.ts`, `contree.test.ts`.
- **C:** a new test file `packages/core/src/executor/contree-overlay-chunks.test.ts` for oracle tests that need real `tar` and `sh` (follows the shell-contract fixture at `contree.test.ts:1336-1420`).

## Behavioral oracles

O-IDENTITY, O-SIZE, O-PEAK, O-CHAIN, O-WORKSPACE, O-BASELINE, O-REFUSE and O-GUARD from the parent plan. Write each as a failing test before the matching code (TDD). For O-SIZE build the tree from a size profile (file count and byte distribution only; no private paths or contents), scale the budget to 1 MiB, and assert the partition and per-tar bounds. For O-BASELINE run the real command from `sandboxRepositoryInitializationCommand` (`heal.ts:650`) in a temporary directory with local `git`.

## Automated verification

Run sequentially from the worktree:

```sh
pnpm --filter @sutura/core exec vitest run src/executor/overlay-chunks.test.ts src/executor/contree-overlay-chunks.test.ts src/executor/contree.test.ts src/executor/snapshot-compatibility.captured.test.ts src/executor/snapshot-oracle-isolation.test.ts
pnpm --filter @sutura/core exec vitest run src/replay src/heal.test.ts src/executor/deadlines
pnpm run typecheck
pnpm run lint
```

New tests that spawn `tar`, `sh` or `git` declare an explicit timeout of at least 30 s (`.claude/rules/ci-parity.md`). Add any other invalidated test file to the list explicitly.

## Manual acceptance and handoff

No manual step. Independent review checks: the single-chunk request equality, the manifest persistence across chunks, symlink and collision refusal in a non-first chunk, temp-file cleanup on failure, and that no new `Executor` interface change leaked. Stop at this gate. Handoff records the exact candidate commit, the test list with outcomes, any deviation from D1 to D6, and confirmation that nothing was pushed or sent to the provider.
