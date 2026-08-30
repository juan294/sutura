import { readFile } from 'node:fs/promises';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface GuardChecklistEntry {
  source: string;
  lines: readonly number[];
}

// Interim inventory only. The merged Phase 3c guards:verify command proves
// reachability with V8 statement-to-line coverage.
const CHECKLIST: readonly GuardChecklistEntry[] = [
  { source: 'llm/nebius.ts', lines: [103, 223, 228, 236, 244, 247, 251, 257, 263, 269, 279, 348, 394, 400, 403, 454, 464, 523, 531, 539, 544, 569, 586, 597] },
  { source: 'llm/json.ts', lines: [74, 103, 116, 123] },
  { source: 'llm/token-factory.ts', lines: [31, 35, 41] },
  { source: 'llm/router.ts', lines: [35, 41, 43, 46, 48] },
  { source: 'llm/cost.ts', lines: [37, 50, 71] },
  { source: 'llm/provider-contract-canary.ts', lines: [79, 138, 143, 148, 162, 168, 173] },
  { source: 'diagnose/tavily.ts', lines: [130, 142, 145, 149, 168, 172, 182, 185, 190, 202, 206, 209, 229, 232, 242, 245, 249, 269] },
  { source: 'executor/contree.ts', lines: [137, 139, 144, 226, 250, 299, 330, 376, 413, 485, 495, 504, 564, 575, 593, 598, 627, 633, 643, 752, 770, 788, 794, 829, 841, 870, 882, 888, 899, 907, 917, 923, 928, 938, 944, 950, 991, 1016, 1021, 1025, 1028, 1041, 1051, 1055, 1061, 1069, 1076, 1114, 1137, 1158, 1167] },
  { source: 'executor/memory.ts', lines: [107, 113] },
  { source: 'executor/live-diagnostics.ts', lines: [12] },
];

function throwLines(source: string, fileName: string): number[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isThrowStatement(node) && ts.isNewExpression(node.expression)) {
      lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lines;
}

describe('Phase 3b interim guard checklist', () => {
  it('inventories all 118 canonical provider-scope guards for merged coverage', async () => {
    const root = new URL('./', import.meta.url);
    let mapped = 0;
    for (const entry of CHECKLIST) {
      const source = await readFile(new URL(entry.source, root), 'utf8');
      expect(throwLines(source, entry.source), entry.source).toEqual(entry.lines);
      mapped += entry.lines.length;
    }
    expect(mapped).toBe(118);
  });

  it('keeps live capture boundaries explicitly pending for Phase 5', async () => {
    const pending = JSON.parse(await readFile(new URL(
      './__fixtures__/captured/pending-boundaries.phase-3b.json',
      import.meta.url,
    ), 'utf8')) as { pendingPhase?: unknown; boundaries?: unknown };
    expect(pending).toEqual(expect.objectContaining({
      pendingPhase: 'phase-5',
      boundaries: ['provider', 'tavily', 'contree'],
    }));
  });
});
