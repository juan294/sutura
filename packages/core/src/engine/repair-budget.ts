export interface RepairBudgetLimits {
  modelTurns: number;
  toolCalls: number;
  branches: number;
  sandboxOperations: number;
  elapsedTimeSec: number;
  inferenceCostUsd: number;
  diffBytes: number;
}

export const DEFAULT_REPAIR_BUDGET_LIMITS = Object.freeze({
  modelTurns: 8,
  toolCalls: 24,
  branches: 4,
  sandboxOperations: 32,
  elapsedTimeSec: 600,
  inferenceCostUsd: 0.25,
  diffBytes: 65_536,
}) satisfies Readonly<RepairBudgetLimits>;

export type RepairBudgetOverrides = Partial<RepairBudgetLimits>;

export class BudgetExceededError extends Error {
  constructor(readonly budget: keyof RepairBudgetLimits) {
    super(`Repair ${budget} budget is exhausted`);
    this.name = 'BudgetExceededError';
  }
}

function boundedLimit<K extends keyof RepairBudgetLimits>(
  key: K,
  value: number | undefined,
): number {
  const maximum = DEFAULT_REPAIR_BUDGET_LIMITS[key];
  const resolved = value ?? maximum;
  if (!Number.isFinite(resolved) || resolved <= 0 || resolved > maximum) {
    throw new RangeError(`Repair ${key} must be greater than 0 and at most ${maximum}`);
  }
  if (key !== 'inferenceCostUsd' && !Number.isSafeInteger(resolved)) {
    throw new RangeError(`Repair ${key} must be an integer`);
  }
  return resolved;
}

export function repairBudgetLimits(
  overrides: RepairBudgetOverrides = {},
): RepairBudgetLimits {
  return {
    modelTurns: boundedLimit('modelTurns', overrides.modelTurns),
    toolCalls: boundedLimit('toolCalls', overrides.toolCalls),
    branches: boundedLimit('branches', overrides.branches),
    sandboxOperations: boundedLimit('sandboxOperations', overrides.sandboxOperations),
    elapsedTimeSec: boundedLimit('elapsedTimeSec', overrides.elapsedTimeSec),
    inferenceCostUsd: boundedLimit('inferenceCostUsd', overrides.inferenceCostUsd),
    diffBytes: boundedLimit('diffBytes', overrides.diffBytes),
  };
}

export interface ModelTurnReservation {
  readonly id: number;
  readonly reservedUsd: number;
}

export interface RepairBudgetSnapshot {
  modelTurns: number;
  toolCalls: number;
  branches: number;
  sandboxOperations: number;
  elapsedTimeSec: number;
  inferenceCostUsd: number;
}

export class RepairBudget {
  readonly limits: Readonly<RepairBudgetLimits>;
  private modelTurns = 0;
  private toolCalls = 0;
  private branches = 0;
  private sandboxOperations = 0;
  private inferenceCostUsd = 0;
  private nextReservationId = 1;
  private readonly unsettled = new Map<number, number>();
  private readonly startedAt: number;

  constructor(
    limits: RepairBudgetOverrides = DEFAULT_REPAIR_BUDGET_LIMITS,
    private readonly now: () => number = Date.now,
  ) {
    this.limits = repairBudgetLimits(limits);
    this.startedAt = now();
  }

  private assertElapsed(): void {
    if ((this.now() - this.startedAt) / 1_000 >= this.limits.elapsedTimeSec) {
      throw new BudgetExceededError('elapsedTimeSec');
    }
  }

  private reserveCount(
    key: 'toolCalls' | 'branches' | 'sandboxOperations',
  ): void {
    this.assertElapsed();
    if (this[key] >= this.limits[key]) throw new BudgetExceededError(key);
    this[key] += 1;
  }

  reserveToolCall(): void { this.reserveCount('toolCalls'); }
  reserveBranch(): void { this.reserveCount('branches'); }
  reserveSandboxOperation(): void { this.reserveCount('sandboxOperations'); }

  reserveModelTurn(worstCaseUsd: number): ModelTurnReservation {
    this.assertElapsed();
    if (!Number.isFinite(worstCaseUsd) || worstCaseUsd <= 0) {
      throw new RangeError('Worst-case model cost must be positive');
    }
    if (this.modelTurns >= this.limits.modelTurns) {
      throw new BudgetExceededError('modelTurns');
    }
    if (this.inferenceCostUsd + worstCaseUsd > this.limits.inferenceCostUsd) {
      throw new BudgetExceededError('inferenceCostUsd');
    }
    this.modelTurns += 1;
    this.inferenceCostUsd += worstCaseUsd;
    const reservation = { id: this.nextReservationId, reservedUsd: worstCaseUsd };
    this.nextReservationId += 1;
    this.unsettled.set(reservation.id, worstCaseUsd);
    return reservation;
  }

  settleModelTurn(reservation: ModelTurnReservation, actualUsd: number): void {
    const reserved = this.unsettled.get(reservation.id);
    if (reserved === undefined) throw new Error('Model turn reservation is not active');
    if (!Number.isFinite(actualUsd) || actualUsd < 0 || actualUsd > reserved) {
      throw new RangeError('Actual model cost must be between zero and the reservation');
    }
    this.unsettled.delete(reservation.id);
    this.inferenceCostUsd -= reserved - actualUsd;
  }

  assertDiffBytes(bytes: number): void {
    this.assertElapsed();
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limits.diffBytes) {
      throw new BudgetExceededError('diffBytes');
    }
  }

  remainingElapsedTimeSec(): number {
    return Math.max(
      0,
      this.limits.elapsedTimeSec - (this.now() - this.startedAt) / 1_000,
    );
  }

  snapshot(): RepairBudgetSnapshot {
    return {
      modelTurns: this.modelTurns,
      toolCalls: this.toolCalls,
      branches: this.branches,
      sandboxOperations: this.sandboxOperations,
      elapsedTimeSec: Math.max(0, (this.now() - this.startedAt) / 1_000),
      inferenceCostUsd: this.inferenceCostUsd,
    };
  }
}
