import { createHash } from 'node:crypto';
import type { ReproductionProfile } from './reproduction-profile.js';
export const PROFILE_FILES = { 'scripts/test-select.mjs': 'reviewed wrapper source\n', 'package.json': '{"scripts":{"test":"node scripts/test-select.mjs run terminal:rest"}}\n', 'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n' };
export function reproductionProfile(overrides: Partial<ReproductionProfile> = {}): ReproductionProfile {
  return { id: 'terminal', nativeCommand: 'node scripts/test-select.mjs run terminal:rest', cwd: '.', argv: ['node', '--test', '--test-reporter=spec'],
    sourceInputs: Object.entries(PROFILE_FILES).map(([path, content]) => ({ path, sha256: createHash('sha256').update(content).digest('hex') })),
    nativeNodeVersion: '22.22.2', sandboxNodeVersion: '22.22.2', imageRef: `node:22.22.2@sha256:${'b'.repeat(64)}`,
    probeTimeoutSec: 240, fullCommand: 'node scripts/test-select.mjs run terminal:rest', fullTimeoutSec: 1800,
    callers: [], approverIds: [], ...overrides };
}
