import { describe, expect, it } from 'vitest';

import {
  BudgetExceededError,
  DEFAULT_REPAIR_BUDGET_LIMITS,
  RepairBudget,
  repairBudgetLimits,
} from './repair-budget.js';

describe('RepairBudget', () => {
  it('reserves concurrent operations atomically against one global limit', async () => {
    const budget = new RepairBudget({ ...DEFAULT_REPAIR_BUDGET_LIMITS, sandboxOperations: 2 });

    const reservations = await Promise.allSettled([
      Promise.resolve().then(() => budget.reserveSandboxOperation()),
      Promise.resolve().then(() => budget.reserveSandboxOperation()),
      Promise.resolve().then(() => budget.reserveSandboxOperation()),
    ]);

    expect(reservations.filter(({ status }) => status === 'fulfilled')).toHaveLength(2);
    expect(reservations.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(budget.snapshot().sandboxOperations).toBe(2);
  });

  it('reserves worst-case inference cost before a model request and settles actual cost', () => {
    const budget = new RepairBudget({ ...DEFAULT_REPAIR_BUDGET_LIMITS, inferenceCostUsd: 0.05 });
    const reservation = budget.reserveModelTurn(0.04);

    expect(() => budget.reserveModelTurn(0.02)).toThrow(BudgetExceededError);
    budget.settleModelTurn(reservation, 0.01);
    expect(() => budget.reserveModelTurn(0.04)).not.toThrow();
  });

  it('accepts lower limits and rejects values above the core hard maxima', () => {
    expect(repairBudgetLimits({ modelTurns: 2 })).toMatchObject({ modelTurns: 2 });
    expect(() => repairBudgetLimits({ modelTurns: 9 })).toThrow(/at most 8/u);
    expect(() => new RepairBudget({ modelTurns: 9 })).toThrow(/at most 8/u);
  });
});
