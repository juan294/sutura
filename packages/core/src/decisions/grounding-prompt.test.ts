import { expect, it } from 'vitest';
import type { Diagnosis } from '../domain.js';
import type { GroundingSelection } from './grounding-evidence.js';
import { diagnosisForRepairPrompt } from './grounding-prompt.js';
function fixture(): Diagnosis {
  const ids = [1, 2, 3].map(n => `citation-${String(n).repeat(64)}`);
  const originals = ids.map((id, index) => ({ id, title: `Source ${index}`, url: `https://example.com/${index}`, snippet: index === 2 ? 'PUBLIC-EXCLUDED' : `Retained evidence ${index}` }));
  const selection: GroundingSelection = { schemaVersion: 'sutura-grounding-selection-v1', mode: 'assist', applied: true, reason: 'grounding-applied', originals,
    selectedIds: ids.slice(0, 2), excluded: [{ id: ids[2]!, reason: 'irrelevant-insufficient' }],
    judgments: [{ id: ids[0]!, relevance: 'relevant', support: 'supports' }, { id: ids[1]!, relevance: 'relevant', support: 'contradicts' }, { id: ids[2]!, relevance: 'irrelevant', support: 'insufficient' }],
    versionComparisons: [{ id: ids[1]!, package: 'pkg', expectedVersion: '2.0.0', mentionedVersion: '1.0.0', matches: false }] };
  return { class: 'dep-upstream-breaking', confidence: .75, signals: ['mechanical'], failingCmd: 'pnpm test', errorExcerpt: 'Observed failure',
    grounding: { query: 'pkg error', skipped: false, citations: originals.slice(0, 2).map(({ title, url, snippet }) => ({ title, url, snippet })), selection } };
}
it('keeps only selected source content and index-bound judgments in repair prompts', () => {
  const value = fixture(), before = JSON.stringify(value);
  const prompt = diagnosisForRepairPrompt(value); const serialized = JSON.stringify(prompt);
  expect(serialized).not.toContain('PUBLIC-EXCLUDED'); expect(serialized).not.toContain('originals'); expect(serialized).not.toContain('excluded');
  expect(serialized).toContain('contradicts'); expect(serialized).toContain('supports'); expect(serialized).toContain('"matches":false');
  expect(serialized).toContain('"citationIndex":1'); expect(JSON.stringify(value)).toBe(before);
});
it.each(['shadow', 'assist'] as const)('preserves exact native prompt data for %s baseline fallback', mode => {
  const value = fixture(), grounding = value.grounding!, selection = grounding.selection!;
  selection.mode = mode; selection.applied = false; selection.selectedIds = selection.originals.map(c => c.id); selection.excluded = [];
  selection.judgments = selection.originals.map(c => ({ id: c.id, relevance: 'unknown', support: 'unknown' }));
  grounding.citations = selection.originals.map(({ title, url, snippet }) => ({ title, url, snippet }));
  const original = structuredClone(grounding); delete original.selection;
  expect(diagnosisForRepairPrompt(value)).toEqual({ ...value, grounding: original });
});
it('does not transmit malformed metadata and leaves legacy diagnoses untouched', () => {
  const value = fixture(); Object.assign(value.grounding!.selection!, { privateState: 'PRIVATE-INPUT' });
  expect(JSON.stringify(diagnosisForRepairPrompt(value))).not.toContain('PRIVATE-INPUT');
  delete value.grounding!.selection;
  expect(diagnosisForRepairPrompt(value)).toBe(value);
});
