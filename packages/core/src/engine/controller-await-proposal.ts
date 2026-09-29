import { createHash } from 'node:crypto';
import type { RepairAuthorizationContext } from './repair-authorization.js';
import { isAuthorizedRepairTarget, repairAuthorizationEvidence } from './repair-authorization.js';
import { validateAwaitEdit } from './repair-authorization-syntax.js';
import type { RepairSourceContext } from './repair.js';
import { REPAIR_PROPOSAL_LIMITS } from './repair.js';
import type { RepairTargetSlot } from './repair-targets.js';

/** Use only the assignment immediately before a traceback-confirmed unittest assertion. */
export async function controllerPythonAwaitReplacement(
  source: string, path: string, assertionLine: number,
): Promise<string | undefined> {
  if (!path.endsWith('.py') || !Number.isSafeInteger(assertionLine) || assertionLine < 2) return undefined;
  const lines = source.split('\n');
  const assignment = lines[assertionLine - 2];
  const assertion = lines[assertionLine - 1];
  if (assignment === undefined || assertion === undefined) return undefined;
  const assigned = /^([ \t]*)([A-Za-z_]\w*)([ \t]*=[ \t]*)(?!await\b)([A-Za-z_]\w*\([^#\n]*\))([ \t]*\r?)$/u.exec(assignment);
  const observed = /^([ \t]*)self\.assertEqual\([ \t]*([A-Za-z_]\w*)(?=[\[.,])/u.exec(assertion);
  if (!assigned || !observed || assigned[1] !== observed[1] || assigned[2] !== observed[2]) return undefined;
  lines[assertionLine - 2] = `${assigned[1]}${assigned[2]}${assigned[3]}await ${assigned[4]}${assigned[5]}`;
  const replacement = lines.join('\n');
  if ([...replacement].length > REPAIR_PROPOSAL_LIMITS.replacementCodePoints) return undefined;
  try { await validateAwaitEdit(source, replacement, path); }
  catch { return undefined; }
  return replacement;
}

/** Propose one byte-preserving await insertion only for a proven, complete grant target. */
export async function controllerAwaitReplacement(input: {
  authorization?: RepairAuthorizationContext;
  sourceContext: RepairSourceContext;
  slots: readonly RepairTargetSlot[];
}): Promise<string | undefined> {
  const { authorization, slots } = input;
  if (!authorization || slots.length !== 1) return undefined;
  const slot = slots[0]!;
  const grants = repairAuthorizationEvidence(authorization.session);
  if (grants.length !== 1 || grants[0]?.kind !== 'await-operation' || grants[0].path !== slot.path) return undefined;
  const lineReferences = grants[0].evidenceReferences.filter((reference) => reference.startsWith('controller-stack-line:'));
  if (lineReferences.length !== 1 || !/^controller-stack-line:[1-9]\d*$/u.test(lineReferences[0]!)) return undefined;
  const lineNumber = Number(lineReferences[0]!.slice('controller-stack-line:'.length));
  if (!Number.isSafeInteger(lineNumber)) return undefined;
  const sources = input.sourceContext.sources.filter((source) => source.path === slot.path);
  if (sources.length !== 1) return undefined;
  const source = sources[0]!;
  if (source.startLine !== 1 || source.truncated || slot.startLine !== 1 ||
    createHash('sha256').update(source.content).digest('hex') !== slot.contentSha256 ||
    !isAuthorizedRepairTarget(authorization.session, authorization.baseline, source)) return undefined;
  if (slot.path.endsWith('.py')) {
    return controllerPythonAwaitReplacement(source.content, slot.path, lineNumber);
  }

  // Only the source line confirmed by both the failure and controller probe
  // may receive an edit. Multiline and ambiguous expressions remain model work.
  const lines = source.content.split('\n');
  const rawLine = lines[lineNumber - 1];
  if (rawLine === undefined) return undefined;
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
  const match = /^([ \t]*expect\([ \t]*)(?!await\b)([A-Za-z_$][\w$]*\([ \t]*\)[ \t]*\)[ \t]*\.[ \t]*to(?:Be|Equal)\([^\n]*\);[ \t]*)$/u.exec(line);
  if (!match?.[1] || !match[2] || (line.match(/\bexpect\(/gu) ?? []).length !== 1) return undefined;
  lines[lineNumber - 1] = `${match[1]}await ${match[2]}${rawLine.endsWith('\r') ? '\r' : ''}`;
  const replacement = lines.join('\n');
  if ([...replacement].length > REPAIR_PROPOSAL_LIMITS.replacementCodePoints) return undefined;
  try { await validateAwaitEdit(source.content, replacement, source.path); }
  catch { return undefined; }
  return replacement;
}
