import { expect, it, vi } from 'vitest';
import { budgetedRecoveryPorts } from '../diagnose/hypotheses-budget.js';
import { RepairBudget } from '../engine/repair-budget.js';
import { InMemoryExecutor } from '../executor/memory.js';
import type { HealLlm } from '../heal.js';
import { ReplayRecorder } from './bundle.js';
import { ReplayControllerClock } from './controller-clock.js';
import { recordingExecutor } from './record-executor.js';
import { RecordedExecutor } from './replay-executor.js';
it('replays captured elapsed inputs and retains exact shortened-operation deadline matching', async () => {
  let now = 0; const time = vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const recorder = new ReplayRecorder('42', 'example/project', 'a'.repeat(40), { triageN: 1, raceK: 1, models: { nano: 'nano', super: 'super', ultra: 'ultra' }, routingProfileId: 'clock', maxOps: 1 });
    recorder.bindControllerStart(0); now = 120_000;
    const budget = new RepairBudget({}, () => recorder.clockNow('repair'), 0);
    expect(budget.remainingElapsedTimeSec()).toBe(480);
    const executor = recordingExecutor(new InMemoryExecutor(() => ({ exitCode: 0, stdout: 'passed', stderr: '', truncated: false, metrics: {} })), recorder);
    const llm = {} as HealLlm;
    const live = budgetedRecoveryPorts({ budget, executor, llm, operationIdPrefix: 'clock' });
    now = 590_000;
    await live.executor.run('base', 'node --test');
    const bundle = recorder.finish('gave-up');
    expect((bundle.executor[0]?.args[2] as { timeoutSec: number }).timeoutSec).toBe(10);
    const replay = async (tampered = false) => {
      const clock = new ReplayControllerClock(bundle.configuration.controllerClock!);
      const captured = structuredClone(bundle.executor);
      if (tampered) (captured[0]!.args[2] as { timeoutSec: number }).timeoutSec = 11;
      const offline = new RecordedExecutor(captured);
      try {
        const budget = new RepairBudget({}, () => clock.now('repair'), clock.startedAt);
        expect(budget.remainingElapsedTimeSec()).toBe(480);
        const ports = budgetedRecoveryPorts({ budget, executor: offline, llm, operationIdPrefix: 'clock' });
        const result = await ports.executor.run('base', 'node --test');
        clock.assertConsumed(); return result;
      } finally { offline.dispose(); }
    };
    await expect(replay()).resolves.toMatchObject({ exitCode: 0 });
    await expect(replay(true)).rejects.toThrow(/timeoutSec/);
  } finally { time.mockRestore(); }
});
