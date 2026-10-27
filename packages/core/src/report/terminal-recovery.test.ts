import { expect, it } from 'vitest';
import { describeTerminalRecovery } from './terminal-recovery.js';
const typed = (code: string, stage: string, details = {}) => Object.assign(new Error('retained original boundary'), { code, stage, details });
it('names exact-source recovery without substituting the branch head', () => {
  const result = describeTerminalRecovery(typed('exact-source-unavailable', 'source-checkout', { sourceSha: 'a'.repeat(40) }));
  expect(result?.nextAction).toContain('a'.repeat(40));
  expect(result?.nextAction).toContain('Never substitute branch HEAD');
});
it('discloses provider disk evidence without assuming an account root cause or retrying', () => {
  expect(describeTerminalRecovery(typed('provider-disk-exhausted', 'provider-operation'))?.nextAction).toContain('ENOSPC');
});
it('does not classify error prose or wrong source identities', () => {
  expect(describeTerminalRecovery(new Error('Could not fetch the exact failing SHA; ENOSPC'))).toBeUndefined();
  expect(describeTerminalRecovery(typed('exact-source-unavailable', 'source-checkout', { sourceSha: 'HEAD' }))).toBeUndefined();
});
