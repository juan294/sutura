# Phase 5 — Execution-backed verification of external patches

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on phase 4 and its shared controller-owned probe verification contract. Sequential; not batch eligible. Stop after review and local verification. Real patches from two agent sources and live proof are phase 10 work.

## Outcome

A developer can submit an existing agent's patch and receive independently executed verification evidence tied to exact source and trusted policy identities. Verification never generates a replacement, opens a repair PR, or substitutes uploaded green logs for sandbox execution. Existing `sutura audit` remains explicitly reduced-assurance log analysis.

## Source baseline and change surface

- `packages/core/src/heal.ts:820` already accepts a supplied diff; `:1311` prepares and reproduces failures. Reuse phase 4's extracted preparation and candidate evaluator instead of duplicating its gates or invoking repair publication.
- `packages/core/src/audit-only.ts:131` and `packages/core/src/domain.ts:172` define the legacy reduced-assurance path. Preserve its contract.
- `packages/cli/src/args.ts:10` documents commands; `:139` parses inline heal diffs, while `:246` parses audit evidence file arguments. New verify always takes a diff **file**.
- `packages/cli/src/heal.ts:213` loads policy with symlink/bounded-read checks; `:494` reads audit evidence. Reuse these safe primitives after extracting shared local-input helpers as necessary.
- `packages/action/src/main.ts:132` invokes repair orchestration; `packages/action/src/input.ts:81` maps existing repair inputs. Add a separate verification route that cannot reach repository mutation methods.
- Read `packages/action/src/repository.ts:1`, `packages/core/src/github/types.ts:1`, `packages/action/action.yml:1`, `packages/cli/src/cli.ts:1`, `packages/core/src/report/audit-casefile.ts:1`, and corresponding tests completely before changes.

Add `packages/core/src/verify.ts`, `packages/cli/src/verify.ts`, `packages/action/src/verify.ts`, colocated tests and external-patch fixtures. Update argument/dispatch/public exports, evidence rendering, Action metadata, setup/help documentation, and committed Action bundle. Phase 4 evidence remains the one execution-backed schema.

## Public interface and trusted inputs

```text
sutura verify --case-dir <clean-source-checkout>
  --source-sha <exact-40-character-commit>
  --policy-base-sha <exact-40-character-trusted-commit>
  --candidate-diff <file>
  --failing-command <allowlisted-command>
  --runtime <auto|node|python>
  --format json
```

All identity and trust inputs above except runtime are required; runtime defaults to auto. `--policy-base-sha` explicitly chooses an operator-trusted policy revision, not a candidate/failing-checkout policy. Resolve `.sutura.json` from that commit via bounded Git object reads; absent file means versioned built-in defaults. Reject unavailable/ambiguous objects and record policy commit plus policy hash. Setup documentation shows the phase 1 trusted declarative contract format and named supported adapters; missing contracts return insufficient in verify rather than silently falling back. A model cannot grant trust to a proposed policy declaration. GitHub mode resolves trusted policy base from authenticated repository configuration/base metadata rather than accepting the patch's request to relax policy.

`--source-sha` identifies the failed source state and must equal clean checkout HEAD, with no tracked/untracked product changes. Create an immutable temporary source snapshot, exclude evidence input files and sensitive paths through existing snapshot policy, and bind its hash. Candidate diff file may live outside this checkout, is bounded by run/repository limits, and is read once without symlink/path-race ambiguity. Fail if the source changes during snapshotting. Source and policy identities can differ; the report explains their roles.

Failing command must resolve to a controller-owned runtime command or trusted policy allowlist before any execution; printable text validation alone is insufficient. The patch may not change command authorization, `.sutura.json`, harness/result files, or other phase 3 protected paths. Dependency-changing patches use phase 3's controlled transaction/preparation path, never candidate-provided install hooks. Preserve stronger existing test/configuration controls.

Optional future provenance fields are informational only: agent source/name/version, creation date, and originating patch reference never alter gate selection or trust. Do not add provider-specific coding-agent clients. This API verifies supplied bytes regardless of their author.

## API and execution pseudocode

```ts
interface VerifyRequest {
  caseDir: string;
  sourceSha: string;
  policyBaseSha: string;
  candidateDiff: string; // core bytes, CLI supplies bounded file contents
  failureCommandId: string;
  runtimeId?: 'node' | 'python';
}

verifyExternalPatch(request, ports):
  source = validateAndSnapshotExactCleanSource(request)
  policy = resolvePolicyFromExplicitTrustedCommit(request.policyBaseSha)
  validateDiffAndCommandBeforeProviderCalls(source, policy, request)
  baseline = prepareSharedSandbox(source, policy)
  reproduction = reproduceAndTriage(baseline, trustedCommand)
  if infrastructureFailure: return infra-stop
  if not reproducible or intermittent: return insufficient
  prepared = prepareVerificationContext(baseline, policy, challengeMode='required')
  evidence = verifyCandidate(suppliedPatch, prepared)
  return versionedExecutedVerificationResult(evidence)
```

The core API has no repair-generation or repository-write port. Importing a broad LLM implementation must not accidentally permit repair calls; expose only classification, challenge, and adjudication capabilities. Production verification status is not called `fixed`: a patch can pass checks without Sutura having authored or applied it to the developer's branch. Reports show `passed checks`, `refused`, `insufficient evidence`, or `infrastructure stopped`, exact checks and hashes, and review guidance. JSON stores the phase 1 five-state observation vocabulary; command exit conventions must match documented CLI error/result handling and be tested explicitly.

An already-applied or nonapplicable patch is invalid input, not a successful repair. A passing baseline, inconsistent reproduction, provider failure, exhausted budget, unsupported probe adapter, or unavailable required challenge is not approval. Persist terminal evidence even when an execution fails. Reuse global audit reservation and resource limits; do not introduce separate unbounded verify budgets.

## GitHub Action boundary

Add explicit `mode: verify` with exact failed-source identity, trusted policy identity derived by the controller, and bounded candidate input. Preserve existing default repair behavior. Implement a distinct `runVerificationAction` that receives read-only GitHub/repository ports and an evidence artifact port; it never receives push/commit/PR creation methods. Default verification mode produces Action output/summary/artifact only. Checks-only reporting may be selected explicitly where a scoped checks-write token is supplied; it still grants no contents/PR write capability.

Never execute head-controlled workflow or fetch provider credentials into candidate code. Authenticate the repository/run/patch association and fail before remote execution when identities conflict. For fork PRs, use trusted controller workflow and base policy, acquire source/diff as data, and retain secret-free sandbox execution. Do not add `pull_request_target` followed by checkout/execution of untrusted head on the credential-bearing runner. Prevent mixing patch evidence from one SHA with a check attached to another SHA. Action permission docs and example workflow must demonstrate minimal scopes.

## Executable acceptance specification

Write failing tests first:

1. `packages/cli/src/args.test.ts`: verify accepts only documented options; requires exact source and trusted-policy SHAs, diff file, failing command, and JSON output; rejects duplicate/unknown options, abbreviated refs, inline diff misuse, malformed SHAs, and conflicting runtime.
2. `packages/cli/src/verify.test.ts`: reject symlink/oversize/changing diff, dirty or changed checkout, wrong HEAD, missing policy commit, command injection, untrusted command, policy modification, already-applied and nonapplicable patches before paid execution. Confirm different trusted policy/source commits are supported and both hashes recorded.
3. `packages/core/src/verify.test.ts`: known-good and known-bad supplied patches receive the same phase 4 observations as ordinary generated candidates; required challenge mode abstains on missing valid checks. Nonreproduction, flakiness, infrastructure stop, expired operations and budget exhaustion remain distinct. Spy proves no repair proposal call or repository mutation is reachable.
4. Baseline-policy fixture: candidate changes `.sutura.json` and script commands to permit itself; controller still applies trusted policy and refuses. Add a failing source policy that already weakened checks to prove trust is not silently taken from failing HEAD.
5. Provenance fixture: identical patch labeled with two agent sources produces identical deterministic gate outcomes; provenance cannot increase assurance. Keep actual paid agent-source results for phase 10.
6. `packages/action/src/verify.test.ts`: read-only action mode cannot invoke push/branch/PR methods; checks-only mode binds target SHA correctly; untrusted fork metadata, repository mismatch, credential propagation, candidate-controlled policy and artifact traversal fail safely. Capture/redact provider/GitHub contract fixtures before relying on new guards.
7. Existing `audit-only.test.ts` and audit-report fixtures still output `assurance: reduced`; execution-backed reports explicitly identify actual ConTree execution and frozen challenge hashes. Replay labels cannot masquerade as fresh execution.
8. Bundle/help/workflow tests exercise installed CLI and Action entry dispatch, exact flag/file semantics, terminal outcomes, minimal permissions and absence of repair publication in verification mode.

## Automated success criteria

- Correct external control passes required checks; exact wrong pagination control fails the shared challenge gate; unrelated equivalent valid repair is not refused just because it differs from a known answer.
- No candidate or log supplies trusted policy, command authority, result envelope, source identity, or assurance mode. No generation/PR write occurs in verification.
- All negative-input/provider/replay controls above pass with no real API calls.
- Run targeted tests sequentially; then `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`, and `pnpm run verify:bundle` sequentially. Include rebuilt committed Action bundle. Before a later authorized push, complete `pnpm run ci:local` and inspect all remote triggers; never trigger a Vercel preview.

## Manual success criteria and phase exit

A reviewer can take a saved patch against an exact clean baseline, follow the documented command, and identify verdict, executed checks, challenge limitations, source/policy provenance, and next review action. Verify read-only Action documentation and inspect the JSON/artifact presentation. Real installation and two-agent-source measurements remain phase 10 and must not be marked complete by mocked/local tests.

Complete implementation review, fixes, dedicated simplification review, and local verification; stop for the phase gate. No provider spending, hosted CI experiment, push, production deployment, outreach, or public verification dispatch is authorized merely by this plan.
