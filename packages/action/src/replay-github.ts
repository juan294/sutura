import type { ReplayRecorder } from '@sutura/core';

import type { GitHubApi } from './github.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
            result: { error: errorMessage(error) },
          }, sequence);
          throw error;
        }
      };
    },
  });
}
