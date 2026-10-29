import { withinRecoveryDeadline } from '../diagnose/hypotheses-budget.js';
import { processSucceeded } from '../executor/types.js';
import type { Candidate, StageEvidence } from '../domain.js';
import type { ImageId, RunMetrics } from '../executor/types.js';
import type { RepairTestEvidence } from './repair-tools.js';
import { diffFingerprint, errorFingerprint } from './fingerprint.js';
import { compareSearchNodes, compareSearchNodePriorities } from './search-score.js';

export const DEFAULT_SEARCH_LIMITS = Object.freeze({
  initialBranches: 4,
  beamWidth: 2,
  maximumDepth: 4,
  maximumTotalBranches: 12,
});

export interface SearchPolicyEvidence {
  valid: boolean;
  violations: string[];
  changedFiles: string[];
  diffBytes: number;
}

export interface SearchNode {
  id: string;
  parentId?: string;
  depth: number;
  imageId: ImageId;
  cumulativeDiff: string;
  errorFingerprint: string;
  testEvidence: RepairTestEvidence;
  policyEvidence: SearchPolicyEvidence;
  stageEvidence: StageEvidence[];
  transcriptReference: string;
  metrics?: RunMetrics;
  candidate?: Candidate;
  terminalReason?: 'passed' | 'policy' | 'repeated-state' | 'depth' | 'cancelled' | 'failed' | 'completion-limit' | 'verification-refused';
  /** Why full verification refused a provisionally green candidate. */
  verificationReason?: string;
}

export interface SearchExpansion {
  imageId: ImageId;
  cumulativeDiff: string;
  testEvidence: RepairTestEvidence;
  policyEvidence: SearchPolicyEvidence;
  stageEvidence: StageEvidence[];
  transcriptReference: string;
  metrics?: RunMetrics;
  candidate?: Candidate;
  terminalReason?: SearchNode['terminalReason'];
}

export interface SearchExpansionContext {
  parent: SearchNode | undefined;
  parentImageId: ImageId;
  depth: number;
  branch: number;
  nodeId: string;
  operationId: string;
  signal: AbortSignal;
}

export interface AdaptiveSearchOptions {
  baselineImageId: ImageId;
  initialBranches?: number;
  beamWidth?: number;
  maximumDepth?: number;
  maximumTotalBranches?: number;
  availableBranches(frontier?: readonly (SearchNode | undefined)[]): number;
  concurrencyCapacity?(): number;
  cancel?(nodeId: string): Promise<void | boolean>;
  singleFinalVerification?: boolean;
  onProvisional?(input: { nodeId: string; expansion: SearchExpansion }): void | number;
  onDecision?(decision: { summary: string; nodeId?: string; parentNodeId?: string }): void;
  /** Advisory ordering only: must return an exact permutation of these IDs. */
  rankFrontier?(nodes: readonly SearchNode[]): Promise<readonly string[]>;
  expand(context: SearchExpansionContext): Promise<SearchExpansion>;
  /**
   * Fully verifies a provisionally green candidate. Diagnosed-test green only
   * makes a branch provisional; without this hook a green branch is admitted on
   * the visible suite alone, which is the pre-phase-4 behavior.
   */
  admit?(input: {
    nodeId: string;
    expansion: SearchExpansion;
  }): Promise<{ accepted: boolean; reason?: string }>;
}

export interface AdaptiveSearchResult {
  nodes: SearchNode[];
  candidates: SearchNode[];
  terminalReason: 'candidate-found' | 'frontier-exhausted' | 'branch-budget' | 'operation-capacity' | 'depth' | 'completion-limit';
}

function isEvidenceTerminal(
  reason: SearchNode['terminalReason'],
): reason is 'cancelled' | 'completion-limit' {
  return reason === 'cancelled' || reason === 'completion-limit';
}

function limit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > DEFAULT_SEARCH_LIMITS.maximumTotalBranches) {
    throw new RangeError(`${name} must be from 1 to ${DEFAULT_SEARCH_LIMITS.maximumTotalBranches}`);
  }
  return resolved;
}

export async function adaptiveSearch(options: AdaptiveSearchOptions): Promise<AdaptiveSearchResult> {
  const initialBranches = limit(options.initialBranches, DEFAULT_SEARCH_LIMITS.initialBranches, 'initialBranches');
  const beamWidth = limit(options.beamWidth, DEFAULT_SEARCH_LIMITS.beamWidth, 'beamWidth');
  const maximumDepth = limit(options.maximumDepth, DEFAULT_SEARCH_LIMITS.maximumDepth, 'maximumDepth');
  const maximumTotalBranches = limit(options.maximumTotalBranches, DEFAULT_SEARCH_LIMITS.maximumTotalBranches, 'maximumTotalBranches');
  const nodes: SearchNode[] = [];
  const visited = new Set<string>();
  let appliedProposals = 0;
  let completionLimits = 0;
  let frontier: Array<SearchNode | undefined> = Array.from({ length: Math.min(initialBranches, maximumTotalBranches) });

  for (let depth = 1; depth <= maximumDepth && frontier.length > 0; depth += 1) {
    const remaining = maximumTotalBranches - nodes.length;
    const authorized = Math.max(0, Math.floor(options.availableBranches(frontier)));
    const parents = frontier.slice(0, Math.min(remaining, authorized));
    if (parents.length === 0) {
      return { nodes, candidates: [], terminalReason: remaining === 0 ? 'branch-budget' : 'operation-capacity' };
    }
    const children: SearchNode[] = [];
    const concurrency = Math.max(1, Math.floor(options.concurrencyCapacity?.() ?? parents.length));
    for (let start = 0; start < parents.length;) {
      const authorizedBatchSize = Math.max(0, Math.floor(options.availableBranches(parents.slice(start))));
      if (authorizedBatchSize < 1) break;
      const batch = parents.slice(start, start + Math.min(concurrency, authorizedBatchSize));
      const controllers = batch.map(() => new AbortController());
      const settled = batch.map(() => false);
      const ids = batch.map((_parent, index) =>
        `search-${String(nodes.length + start + index + 1).padStart(3, '0')}`,
      );
      let cancellationStarted = false;
      let selectedIndex: number | undefined;
      let drainSeconds = 15;
      let notifySelected!: () => void;
      const selection = new Promise<void>(resolve => { notifySelected = resolve; });
      const completedValues: Array<SearchExpansion | undefined> = batch.map(() => undefined);
      const draining = new Set<number>();
      const cancellationRequests: Promise<unknown>[] = [];
      const raw = batch.map(async (parent, index) => {
        const id = ids[index]!;
        options.onDecision?.({ summary: `Expand branch ${start + index + 1} at depth ${depth}`, nodeId: id,
          ...(parent === undefined ? {} : { parentNodeId: parent.id }) });
        const expansion = await options.expand({ parent, parentImageId: parent?.imageId ?? options.baselineImageId,
          depth, branch: start + index + 1, nodeId: id, operationId: id, signal: controllers[index]!.signal });
        settled[index] = true; completedValues[index] = expansion;
        if (options.singleFinalVerification && selectedIndex === undefined && expansion.policyEvidence.valid && processSucceeded(expansion.testEvidence) && expansion.candidate !== undefined) {
          selectedIndex = index;
          // This synchronous hook non-refundably binds the selected candidate and
          // closes ordinary ports before any cancellation/drain await.
          if (!options.onProvisional || !options.admit) throw new Error('Single final verification requires controller admission');
          const allotted = options.onProvisional({ nodeId: id, expansion });
          if (allotted !== undefined) { if (!Number.isFinite(allotted) || allotted <= 0 || allotted > 60) throw new Error('Invalid final cancellation allocation'); drainSeconds = allotted; }
          notifySelected();
          ids.forEach((otherId, otherIndex) => {
            if (otherIndex === index || settled[otherIndex]) return;
            draining.add(otherIndex); controllers[otherIndex]!.abort();
            if (options.cancel) cancellationRequests.push(Promise.resolve().then(() => options.cancel!(otherId)));
          });
        }
        return expansion;
      });
      let expansions: Array<{ expansion: SearchExpansion; admission: { accepted: boolean; reason?: string } }>;
      if (options.singleFinalVerification) {
        const all = Promise.all(raw);
        await Promise.race([selection, all]);
        let completed: SearchExpansion[];
        let confirmed = true;
        if (selectedIndex === undefined) completed = await all;
        else {
          try {
            completed = await withinRecoveryDeadline(drainSeconds, undefined, async () => {
              const values = await all;
              await Promise.allSettled(cancellationRequests);
              for (const index of draining) {
                try { if (!options.cancel || await options.cancel(ids[index]!) !== true) confirmed = false; }
                catch { confirmed = false; }
              }
              return values;
            });
          } catch {
            confirmed = false;
            completed = completedValues.map((value, index) => value ?? {
              imageId: batch[index]?.imageId ?? options.baselineImageId,
              cumulativeDiff: batch[index]?.cumulativeDiff ?? '',
              testEvidence: { commandId: 'diagnosed', imageId: batch[index]?.imageId ?? options.baselineImageId, exitCode: -1, output: 'Controller stop: cancelled branch has no terminal observation within the drain allowance' },
              policyEvidence: { valid: false, violations: ['cancellation-unresolved'], changedFiles: [], diffBytes: 0 },
              stageEvidence: [], transcriptReference: ids[index]!, terminalReason: 'cancelled' as const,
            });
          }
        }
        const admission = selectedIndex === undefined ? undefined : !confirmed
          ? { accepted: false, reason: 'Final verification blocked: cancellation/drain terminal evidence is unresolved within the approved deadline' }
          : await options.admit!({ nodeId: ids[selectedIndex]!, expansion: completed[selectedIndex]! });
        expansions = completed.map((expansion, index) => ({ expansion, admission: index === selectedIndex && admission ? admission : { accepted: false, reason: 'Single final verification selected another candidate' } }));
      } else {
        expansions = await Promise.all(raw.map(async (pending, index) => {
          const expansion = await pending;
          const provisional = expansion.policyEvidence.valid && processSucceeded(expansion.testEvidence) && expansion.candidate !== undefined;
          const admission = provisional && options.admit !== undefined ? await options.admit({ nodeId: ids[index]!, expansion }) : { accepted: provisional };
          if (!cancellationStarted && admission.accepted) {
            cancellationStarted = true;
            await Promise.all(ids.flatMap((otherId, otherIndex) => {
              if (otherIndex === index || settled[otherIndex]) return [];
              controllers[otherIndex]!.abort(); return options.cancel === undefined ? [] : [options.cancel(otherId)];
            }));
          }
          return { expansion, admission };
        }));
      }
      for (const [index, { expansion, admission }] of expansions.entries()) {
        const parent = batch[index];
        const id = ids[index]!;
      const fingerprint = `${diffFingerprint(expansion.cumulativeDiff)}:${errorFingerprint(expansion.testEvidence.output)}`;
      const repeated = visited.has(fingerprint);
      visited.add(fingerprint);
      const provisional = processSucceeded(expansion.testEvidence) && expansion.candidate !== undefined;
      const terminalReason = !expansion.policyEvidence.valid
        ? 'policy' as const
        : provisional
          ? (admission.accepted ? 'passed' as const : 'verification-refused' as const)
          : isEvidenceTerminal(expansion.terminalReason)
            ? expansion.terminalReason
            : repeated
              ? 'repeated-state' as const
              : expansion.terminalReason ?? (depth === maximumDepth ? 'depth' as const : undefined);
      children.push({
        id,
        ...(parent === undefined ? {} : { parentId: parent.id }),
        depth,
        imageId: expansion.imageId,
        cumulativeDiff: expansion.cumulativeDiff,
        testEvidence: expansion.testEvidence,
        policyEvidence: expansion.policyEvidence,
        stageEvidence: expansion.stageEvidence,
        transcriptReference: expansion.transcriptReference,
        ...(expansion.metrics === undefined ? {} : { metrics: expansion.metrics }),
        ...(expansion.candidate === undefined ? {} : { candidate: expansion.candidate }),
        errorFingerprint: errorFingerprint(expansion.testEvidence.output),
        ...(terminalReason === undefined ? {} : { terminalReason }),
        ...(terminalReason === 'verification-refused' && admission.reason !== undefined
          ? { verificationReason: admission.reason }
          : {}),
      });
      options.onDecision?.({
        summary: terminalReason === undefined ? 'Retain branch in frontier' : `Branch terminal: ${terminalReason}`,
        nodeId: id,
        ...(parent === undefined ? {} : { parentNodeId: parent.id }),
      });
      }
      const batchChildren = children.slice(-expansions.length);
      for (const child of batchChildren) {
        if (child.policyEvidence.changedFiles.length > 0) appliedProposals += 1;
        if (child.terminalReason === 'completion-limit') completionLimits += 1;
      }
      if (children.some(({ terminalReason }) => terminalReason === 'passed') || selectedIndex !== undefined) break;
      if (completionLimits > appliedProposals) {
        nodes.push(...children);
        return { nodes, candidates: [], terminalReason: 'completion-limit' };
      }
      start += batch.length;
    }
    nodes.push(...children);
    const candidates = children.filter(({ terminalReason }) => terminalReason === 'passed').sort(compareSearchNodes);
    if (candidates.length > 0) return { nodes, candidates, terminalReason: 'candidate-found' };
    if (options.singleFinalVerification && children.some(node => node.terminalReason === 'verification-refused')) return { nodes, candidates: [], terminalReason: 'frontier-exhausted' };
    const baseline = children
      .filter(({ terminalReason }) => terminalReason === undefined || terminalReason === 'failed')
      .sort(compareSearchNodes);
    const eligible = baseline.filter(node => !processSucceeded(node.testEvidence));
    if (options.rankFrontier && eligible.length > 1 && nodes.length < maximumTotalBranches) {
      try {
        // The hook sees a copy and returns IDs; it cannot replace executable evidence.
        const suggested = await options.rankFrontier(structuredClone(eligible));
        const byId = new Map(eligible.map(node => [node.id, node]));
        if (Array.isArray(suggested) && suggested.length === eligible.length &&
          new Set(suggested).size === eligible.length && suggested.every(id => byId.has(id))) {
          const positions = new Map(suggested.map((id, index) => [id, index]));
          const ordered = eligible.toSorted((left, right) => compareSearchNodePriorities(left, right) || positions.get(left.id)! - positions.get(right.id)!);
          let next = 0;
          for (let index = 0; index < baseline.length; index++) {
            if (byId.has(baseline[index]!.id)) baseline[index] = ordered[next++]!;
          }
        } else options.onDecision?.({ summary: 'semantic-ranking-invalid-permutation' });
      } catch { options.onDecision?.({ summary: 'semantic-ranking-unavailable' }); }
    }
    frontier = baseline.slice(0, beamWidth);
  }
  return { nodes, candidates: [], terminalReason: frontier.length === 0 ? 'frontier-exhausted' : 'depth' };
}
