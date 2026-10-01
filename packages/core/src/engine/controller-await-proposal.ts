import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { parse } from 'acorn';
import type { RepairAuthorizationContext } from './repair-authorization.js';
import { isAuthorizedRepairTarget, repairAuthorizationEvidence } from './repair-authorization.js';
import { validateAwaitEdit } from './repair-authorization-syntax.js';
import type { RepairSourceContext, RepairSourceExcerpt } from './repair.js';
import { REPAIR_PROPOSAL_LIMITS } from './repair.js';
import type { RepairTargetSlot } from './repair-targets.js';

type JsNode = Record<string, unknown>;
const asNode = (value: unknown): JsNode | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsNode : undefined;
const field = (node: JsNode | undefined, key: string): JsNode | undefined => asNode(node?.[key]);
const nodes = (node: JsNode | undefined, key: string): JsNode[] => {
  const value = node?.[key];
  return Array.isArray(value) ? value.flatMap((item) => { const child = asNode(item); return child ? [child] : []; }) : [];
};
const name = (node: JsNode | undefined): string | undefined => typeof node?.name === 'string' ? node.name : undefined;
function walk(node: JsNode, visit: (node: JsNode) => void): void {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => { const child = asNode(item); if (child) walk(child, visit); });
    else { const child = asNode(value); if (child) walk(child, visit); }
  }
}
function containsIdentifier(node: JsNode | undefined, identifier: string): boolean {
  if (!node) return false;
  let found = false;
  walk(node, (child) => { if (child.type === 'Identifier' && name(child) === identifier) found = true; });
  return found;
}

/** The only supported setup shape is a direct imported async call or one transparent forwarding helper. */
export async function controllerJsSetupAwaitReplacement(
  source: string, path: string, assertionLine: number, sources: readonly RepairSourceExcerpt[],
): Promise<string | undefined> {
  if (!/\.test\.[cm]?js$/u.test(path) || !Number.isSafeInteger(assertionLine) || assertionLine < 2) return undefined;
  const lines = source.split('\n');
  const assignment = lines[assertionLine - 2];
  const assertion = lines[assertionLine - 1];
  if (assignment === undefined || assertion === undefined) return undefined;
  const assigned = /^([ \t]*const[ \t]+)([A-Za-z_$][\w$]*)([ \t]*=[ \t]*)(?!await\b)([A-Za-z_$][\w$]*\([^\n;]*\))([ \t]*;[ \t]*\r?)$/u.exec(assignment);
  const observed = /^[ \t]*expect\([ \t]*([A-Za-z_$][\w$]*)\.[A-Za-z_$][\w$]*[ \t]*\)[ \t]*\.[ \t]*to(?:Be|Equal)\([^\n]*\);[ \t]*\r?$/u.exec(assertion);
  if (!assigned || !observed || assigned[2] !== observed[1] ||
    (assertion.match(/\bexpect\(/gu) ?? []).length !== 1) return undefined;
  const callName = /^([A-Za-z_$][\w$]*)\(/u.exec(assigned[4]!)?.[1];
  if (!callName) return undefined;
  let testAst: JsNode;
  try { testAst = parse(source, { ecmaVersion: 2022, sourceType: 'module' }) as unknown as JsNode; }
  catch { return undefined; }
  const top = nodes(testAst, 'body');
  const forwarding = top.flatMap((statement) => statement.type === 'VariableDeclaration' && statement.kind === 'const' ? nodes(statement, 'declarations') : []);
  const helper = forwarding.filter((declaration) => name(field(declaration, 'id')) === callName);
  if (helper.length > 1) return undefined;
  let bindings = 0;
  let reassigned = false;
  walk(testAst, (node) => {
    if (node.type === 'VariableDeclarator' && containsIdentifier(field(node, 'id'), callName)) bindings += 1;
    if (node.type === 'ImportSpecifier' && name(field(node, 'local')) === callName) bindings += 1;
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(String(node.type))) {
      bindings += nodes(node, 'params').filter((param) => containsIdentifier(param, callName)).length;
    }
    if ((node.type === 'AssignmentExpression' && name(field(node, 'left')) === callName) ||
      (node.type === 'UpdateExpression' && name(field(node, 'argument')) === callName)) reassigned = true;
  });
  if (bindings !== 1 || reassigned) return undefined;
  let importedName = callName;
  if (helper.length === 1) {
    const fn = field(helper[0], 'init');
    const params = nodes(fn, 'params');
    const body = field(fn, 'body');
    const args = nodes(body, 'arguments');
    if (fn?.type !== 'ArrowFunctionExpression' || fn.async || params.length !== 1 ||
      params[0]?.type !== 'Identifier' || body?.type !== 'CallExpression' ||
      field(body, 'callee')?.type !== 'Identifier' || args.length !== 1 ||
      args[0]?.type !== 'Identifier' || name(args[0]) !== name(params[0]) ||
      name(params[0]) === name(field(body, 'callee'))) return undefined;
    importedName = name(field(body, 'callee'))!;
  }
  const imports = top.flatMap((statement) => statement.type === 'ImportDeclaration'
    ? nodes(statement, 'specifiers').filter((spec) => spec.type === 'ImportSpecifier' && name(field(spec, 'local')) === importedName)
      .map((spec) => ({ specifier: field(statement, 'source')?.value, exported: name(field(spec, 'imported')) })) : []);
  if (imports.length !== 1 || typeof imports[0]!.specifier !== 'string' ||
    !/^\.\/?[\w./-]+\.js$/u.test(imports[0]!.specifier) || typeof imports[0]!.exported !== 'string') return undefined;
  const importedPath = posix.normalize(posix.join(posix.dirname(path), imports[0]!.specifier));
  if (importedPath.startsWith('../') || importedPath.startsWith('/')) return undefined;
  const targets = sources.filter((item) => item.path === importedPath && item.startLine === 1 && !item.truncated);
  if (targets.length !== 1 || Buffer.byteLength(targets[0]!.content) > 16_000) return undefined;
  let importedAst: JsNode;
  try { importedAst = parse(targets[0]!.content, { ecmaVersion: 2022, sourceType: 'module' }) as unknown as JsNode; }
  catch { return undefined; }
  const asyncExports = nodes(importedAst, 'body').filter((statement) => {
    const declaration = field(statement, 'declaration');
    return statement.type === 'ExportNamedDeclaration' && declaration?.type === 'FunctionDeclaration' &&
      declaration.async === true && name(field(declaration, 'id')) === imports[0]!.exported;
  });
  let exportReassigned = false;
  walk(importedAst, (node) => {
    const target = node.type === 'AssignmentExpression' || node.type === 'ForInStatement' || node.type === 'ForOfStatement'
      ? field(node, 'left') : node.type === 'UpdateExpression' ? field(node, 'argument') : undefined;
    if (containsIdentifier(target, imports[0]!.exported!)) exportReassigned = true;
  });
  if (asyncExports.length !== 1 || exportReassigned) return undefined;
  lines[assertionLine - 2] = `${assigned[1]}${assigned[2]}${assigned[3]}await ${assigned[4]}${assigned[5]}`;
  const replacement = lines.join('\n');
  if ([...replacement].length > REPAIR_PROPOSAL_LIMITS.replacementCodePoints) return undefined;
  try { await validateAwaitEdit(source, replacement, path); }
  catch { return undefined; }
  return replacement;
}

/**
 * Use only the assignment immediately before a traceback-confirmed unittest
 * assertion, or the single plain call that is that assertion's first argument.
 */
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
  const inline = /^([ \t]*self\.assertEqual\([ \t]*)(?!await\b)([A-Za-z_]\w*\([^()#\n]*\)[ \t]*,[^()#;\n]*\)[ \t]*\r?)$/u.exec(assertion);
  if (assigned && observed && assigned[1] === observed[1] && assigned[2] === observed[2]) {
    lines[assertionLine - 2] = `${assigned[1]}${assigned[2]}${assigned[3]}await ${assigned[4]}${assigned[5]}`;
  } else if (inline) {
    lines[assertionLine - 1] = `${inline[1]}await ${inline[2]}`;
  } else {
    return undefined;
  }
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
  const grant = grants[0];
  if (grants.length !== 1 || !grant || !['await-operation', 'await-setup'].includes(grant.kind) || grant.path !== slot.path) return undefined;
  const lineReferences = grant.evidenceReferences.filter((reference) => reference.startsWith('controller-stack-line:'));
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
    return grant.kind === 'await-operation' ? controllerPythonAwaitReplacement(source.content, slot.path, lineNumber) : undefined;
  }
  if (grant.kind === 'await-setup') {
    return controllerJsSetupAwaitReplacement(source.content, slot.path, lineNumber, input.sourceContext.sources);
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
