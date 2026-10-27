export interface TerminalRecovery {
  code: 'exact-source-unavailable' | 'provider-disk-exhausted';
  stage: 'source-checkout' | 'provider-operation';
  nextAction: string;
}
/** Describe origin-owned typed evidence; error prose never establishes a cause. */
export function describeTerminalRecovery(error: unknown): TerminalRecovery | undefined {
  if (!(error instanceof Error)) return undefined;
  const value = error as Error & { code?: unknown; stage?: unknown; details?: Record<string, unknown> };
  if (value.code === 'exact-source-unavailable' && value.stage === 'source-checkout' &&
      typeof value.details?.sourceSha === 'string' && /^[a-f0-9]{40}$/iu.test(value.details.sourceSha)) {
    return { code: value.code, stage: value.stage,
      nextAction: `Restore scoped access/ref availability for exact failing SHA ${value.details.sourceSha}; verify that exact object before a new authorized attempt. Never substitute branch HEAD.` };
  }
  if (value.code === 'provider-disk-exhausted' && value.stage === 'provider-operation') {
    return { code: value.code, stage: value.stage,
      nextAction: 'The provider reported ENOSPC. Retain operation evidence and known/unknown charges; ask the provider/account owner to inspect capacity. Cleanup and another billed attempt require separate authorization.' };
  }
  return undefined;
}
