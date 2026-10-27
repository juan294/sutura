import { withinRecoveryDeadline } from '../diagnose/hypotheses-budget.js';
import type { Executor } from './types.js';
/** Preparation has no access to a final-verification clock or permit. */
export function preparationDeadlineExecutor(executor: Executor, startedAt: number, now: () => number = Date.now, operationPrefix = 'prepare'): Executor {
  const remaining = () => Math.max(0, 600 - (now() - startedAt) / 1000);
  const prefix = operationPrefix; let sequence = 0;
  const bounded: Executor = {
    importImage: ref => withinRecoveryDeadline(remaining(), undefined, () => executor.importImage(ref)),
    snapshot: (dir, base, options) => withinRecoveryDeadline(remaining(), undefined, () => executor.snapshot(dir, base, options)),
    operationCapacity: () => executor.operationCapacity(), cancel: id => executor.cancel(id),
    run: async (parent, command, options) => {
      const seconds = Math.min(options?.timeoutSec ?? 120, remaining());
      const operationId = options?.operationId ?? `${prefix}-${++sequence}`;
      const ordinary = { ...options };
      delete ordinary.verificationPermit;
      return withinRecoveryDeadline(seconds, undefined, () => executor.run(parent, command, { ...ordinary, operationId, timeoutSec: seconds }), () => executor.cancel(operationId));
    },
    runMany: async (parent, commands, options) => { const results = []; for (const command of commands) results.push(await bounded.run(parent, command, options)); return results; },
  };
  return bounded;
}
