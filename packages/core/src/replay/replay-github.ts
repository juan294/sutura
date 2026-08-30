import type { GitHubApi } from '../github/types.js';
import { canonicalJson, firstJsonDifference } from './canonical-json.js';
import type { RecordedGitHubCall, ReplayBundle } from './bundle.js';
import { ReplayMismatchError } from './replay-fetch.js';

const MUTATING_METHODS = new Set<keyof GitHubApi>([
  'createRef',
  'deleteRef',
  'createIssueComment',
  'createCommitComment',
  'updateIssueComment',
  'updateCommitComment',
  'createPullRequest',
  'createCheckRun',
  'updateCheckRun',
]);

export interface RecordedGitHubMutation {
  sequence: number;
  method: keyof GitHubApi;
  args: unknown[];
}

export interface ReplayingGitHubApi {
  api: GitHubApi;
  mutations: RecordedGitHubMutation[];
}

function recordedError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Object.keys(value).length !== 1) return null;
  const error = (value as { error?: unknown }).error;
  return typeof error === 'string' ? error : null;
}

function returnedResult(call: RecordedGitHubCall): unknown {
  const error = recordedError(call.result);
  if (error) throw new Error(error);
  return call.result === null ? undefined : call.result;
}

export function replayingGitHubApi(bundle: ReplayBundle): ReplayingGitHubApi {
  const calls = bundle.github.toSorted((left, right) => left.sequence - right.sequence);
  const mutations: RecordedGitHubMutation[] = [];
  let index = 0;
  const api = new Proxy({} as GitHubApi, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined;
      return async (...args: unknown[]): Promise<unknown> => {
        const call = calls[index];
        if (!call) {
          throw new ReplayMismatchError(index + 1, '$', 'recorded call', 'sequence exhausted');
        }
        index += 1;
        if (call.method !== property) {
          throw new ReplayMismatchError(call.sequence, '$.method', call.method, property);
        }
        if (canonicalJson(call.args) !== canonicalJson(args)) {
          const difference = firstJsonDifference(call.args, args);
          throw new ReplayMismatchError(
            call.sequence,
            difference?.path ?? '$.args',
            difference?.expected,
            difference?.actual,
          );
        }
        if (MUTATING_METHODS.has(property as keyof GitHubApi)) {
          mutations.push({
            sequence: call.sequence,
            method: property as keyof GitHubApi,
            args,
          });
        }
        return returnedResult(call);
      };
    },
  });
  return { api, mutations };
}
