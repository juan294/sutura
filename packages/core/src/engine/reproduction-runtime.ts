import { processSucceeded, type Executor, type RunResult } from '../executor/types.js';
import { isResolvedReproductionPlan, type ResolvedReproductionPlan } from './reproduction-plan.js';
export async function verifyReproductionRuntime(executor: Executor, image: string, plan: ResolvedReproductionPlan): Promise<{ ok: boolean; result: RunResult }> {
  if (!isResolvedReproductionPlan(plan)) throw new Error('Captured protected reproduction plan required');
  const result = await executor.run(image, 'node -p process.versions.node', { cwd: '/workspace', network: 'disabled', timeoutSec: 30 });
  return { ok: processSucceeded(result) && !result.truncated && result.stdout.trim() === plan.profile.sandboxNodeVersion, result };
}
