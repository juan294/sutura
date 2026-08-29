export type RuntimeId = 'node' | 'python';

export interface RuntimeEvidence {
  paths: readonly string[];
  failingCommand: string;
  failedLog?: string;
  configuredRuntime?: RuntimeId;
}

export interface DependencyPreparation {
  paths: readonly string[];
  command: string;
}

export interface RuntimeAdapter {
  readonly id: RuntimeId;
  readonly imageRef: string;
  readonly requiredTools: readonly string[];
  detect(evidence: RuntimeEvidence): number;
  dependencyInputs(caseDir: string): Promise<DependencyPreparation>;
  readonly preparationCommand: string;
  normalizeCommand(command: string): string;
  readonly sourceExtensions: readonly string[];
  readonly policyRules: readonly string[];
}
