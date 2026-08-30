import type { GitHubApi } from '../github/types.js';
import type { RecordedGitHubCall, RecordedRepositoryCall, ReplayBundle } from './bundle.js';
import {
  describeMethodCall,
  RecordedCallCursor,
} from './recorded-call-cursor.js';
import { throwRecordedErrorResult } from './recorded-error.js';

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

export type RecordedPortCall = RecordedGitHubCall | RecordedRepositoryCall;

function returnedResult(call: RecordedGitHubCall): unknown {
  throwRecordedErrorResult(call.result);
  return call.result === null ? undefined : call.result;
}

export function replayingGitHubApi(
  bundle: ReplayBundle,
  cursor = new RecordedCallCursor<RecordedPortCall>(
    bundle.github,
    describeMethodCall,
    'port',
  ),
): ReplayingGitHubApi {
  const mutations: RecordedGitHubMutation[] = [];
  const api = new Proxy({} as GitHubApi, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined;
      return async (...args: unknown[]): Promise<unknown> => {
        const call = cursor.next(property, args) as RecordedGitHubCall;
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
