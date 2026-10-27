import { nodeTestRunner } from './focus/node-test.js';
import { shellWords } from './focus/shared.js';
import { isCapturedDiagnostics } from './native-diagnostics.js';
/** Evidence-only stop for Node test wrappers. Direct runner and application commands retain their contracts. */
export function needsNodeReproductionProfile(command: string, diagnostics?: unknown): boolean {
  const words = shellWords(command);
  if (!words || words[0] !== 'node' || nodeTestRunner.parse(words) !== undefined) return false;
  return isCapturedDiagnostics(diagnostics) || words.some(word => /^(?:\.\/)?scripts\/(?:[^/]+\/)*(?:test[\w.-]*|run-tests?[\w.-]*)\.[cm]?js$/iu.test(word));
}
