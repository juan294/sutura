import { assertSuccessfulRun } from './live-diagnostics.js';
import type { Executor, ImageId } from './types.js';

const INSTALL_GIT_COMMAND =
  'apt-get update -qq && apt-get install -y -qq git';

export async function prepareGitTooling(
  executor: Executor,
  base: ImageId,
): Promise<ImageId> {
  const result = await executor.run(base, INSTALL_GIT_COMMAND, {
    timeoutSec: 300,
  });
  assertSuccessfulRun('prepare sandbox Git tooling', result);
  return result.imageId;
}
