import { describe, expect, it } from 'vitest';
import { validateGroundingSelection, type GroundingSelection } from './grounding-evidence.js';
const id = (n: number) => `citation-${String(n).repeat(64)}`;
function selection(): GroundingSelection {
  return { schemaVersion: 'sutura-grounding-selection-v1', mode: 'assist', applied: true, reason: 'grounding-applied',
    originals: [1, 2, 3].map(n => ({ id: id(n), title: `Public source ${n}`, url: `https://example.test/${n}`, snippet: `Package evidence ${n}` })),
    selectedIds: [id(1), id(3)], excluded: [{ id: id(2), reason: 'irrelevant-insufficient' }],
    judgments: [{ id: id(1), relevance: 'relevant', support: 'supports' }, { id: id(2), relevance: 'irrelevant', support: 'insufficient' }, { id: id(3), relevance: 'relevant', support: 'contradicts' }],
    versionComparisons: [{ id: id(1), package: 'pkg', expectedVersion: '1.0.0', mentionedVersion: '1.0.0', matches: true }] };
}
describe('public grounding provenance boundary', () => {
  it('retains all originals, explicit exclusions, contradictions and exact version facts', () => {
    const value = selection();
    expect(validateGroundingSelection(value, [value.originals[0], value.originals[2]])).toBe(true);
    expect(validateGroundingSelection(value, [value.originals[0]])).toBe(false);
    expect(validateGroundingSelection(value, [{ ...value.originals[0], snippet: 'substituted' }, value.originals[2]])).toBe(false);
  });
  it.each([
    (v: GroundingSelection) => ({ ...v, state: 'private' }),
    (v: GroundingSelection) => ({ ...v, schemaVersion: 'unknown' }),
    (v: GroundingSelection) => ({ ...v, mode: 'auto' }),
    (v: GroundingSelection) => ({ ...v, applied: 1 }),
    (v: GroundingSelection) => ({ ...v, reason: '' }),
    (v: GroundingSelection) => ({ ...v, originals: [] }),
    (v: GroundingSelection) => ({ ...v, originals: [v.originals[0], v.originals[0]] }),
    (v: GroundingSelection) => ({ ...v, originals: [{ ...v.originals[0], id: 'foreign', command: 'injected' }] }),
    (v: GroundingSelection) => ({ ...v, originals: [{ ...v.originals[0], url: 'javascript:alert(1)' }, ...v.originals.slice(1)] }),
    (v: GroundingSelection) => ({ ...v, originals: [{ ...v.originals[0], url: '' }, ...v.originals.slice(1)] }),
    (v: GroundingSelection) => ({ ...v, originals: [{ ...v.originals[0], url: 'not-a-url' }, ...v.originals.slice(1)] }),
    (v: GroundingSelection) => ({ ...v, originals: [{ ...v.originals[0], title: 'x'.repeat(513) }, ...v.originals.slice(1)] }),
    (v: GroundingSelection) => ({ ...v, selectedIds: [] }),
    (v: GroundingSelection) => ({ ...v, selectedIds: [id(1), id(1)] }),
    (v: GroundingSelection) => ({ ...v, selectedIds: [id(1), id(4)] }),
    (v: GroundingSelection) => ({ ...v, excluded: [{ id: id(1), reason: 'irrelevant-insufficient' }] }),
    (v: GroundingSelection) => ({ ...v, excluded: [] }),
    (v: GroundingSelection) => ({ ...v, judgments: [] }),
    (v: GroundingSelection) => ({ ...v, judgments: [v.judgments[0], v.judgments[0], v.judgments[2]] }),
    (v: GroundingSelection) => ({ ...v, judgments: [{ ...v.judgments[0], support: 'invented' }, ...v.judgments.slice(1)] }),
    (v: GroundingSelection) => ({ ...v, judgments: [{ ...v.judgments[0], relevance: 'unknown' }, ...v.judgments.slice(1)] }),
    (v: GroundingSelection) => ({ ...v, judgments: [v.judgments[0], { ...v.judgments[1], support: 'contradicts' }, v.judgments[2]] }),
    (v: GroundingSelection) => ({ ...v, versionComparisons: [{ ...v.versionComparisons[0], matches: false }] }),
    (v: GroundingSelection) => ({ ...v, versionComparisons: [{ ...v.versionComparisons[0], id: id(4) }] }),
    (v: GroundingSelection) => ({ ...v, warning: 'model prose' }),
  ])('rejects malformed or authority-confusing metadata %#', change => {
    expect(validateGroundingSelection(change(selection()))).toBe(false);
  });
  it('represents whole-set fallback and the all-excluded warning without claiming applied labels', () => {
    const value = selection(); value.applied = false; value.selectedIds = value.originals.map(c => c.id); value.excluded = [];
    expect(validateGroundingSelection(value, value.originals)).toBe(true);
    expect(validateGroundingSelection({ ...value, selectedIds: value.selectedIds.toReversed() })).toBe(false);
    value.warning = 'no-qualified-source'; value.judgments = value.originals.map(c => ({ id: c.id, relevance: 'irrelevant', support: 'insufficient' }));
    expect(validateGroundingSelection(value)).toBe(true);
    expect(validateGroundingSelection({ ...value, applied: true })).toBe(false);
  });
});
