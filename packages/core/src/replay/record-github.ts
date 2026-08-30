import type { GitHubApi } from '../github/types.js';
import type { ReplayRecorder } from './bundle.js';
import { recordedErrorResult } from './recorded-error.js';

export function recordingGitHubApi(
  api: GitHubApi,
  recorder: ReplayRecorder,
): GitHubApi {
  return new Proxy(api, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof property !== 'string' || typeof value !== 'function') return value;
      return async (...args: unknown[]): Promise<unknown> => {
        const sequence = recorder.reservePortSequence('github');
        try {
          const result = await Reflect.apply(value, target, args) as unknown;
          recorder.recordGitHub({ method: property, args, result }, sequence);
          return result;
        } catch (error) {
          recorder.recordGitHub({
            method: property,
            args,
            result: recordedErrorResult(error),
          }, sequence);
          throw error;
        }
      };
    },
  });
}
