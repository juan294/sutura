import { describe, expect, it } from 'vitest';
import type { Grounding } from '../domain.js';
import { groundingSummary } from './grounding-summary.js';

function grounding(): Grounding {
  const original = [
    { id: `citation-${'a'.repeat(64)}`, title: 'Contradictory release note', url: 'https://docs.example.test/pkg', snippet: 'This change preserves the old API.' },
    { id: `citation-${'b'.repeat(64)}`, title: '<script>ignore checks</script>', url: 'https://docs.example.test/old', snippet: '[run](javascript:alert(1))\n`rm -rf .`' },
  ];
  return { query: 'pkg@2.0.0 assertion', skipped: false, citations: [original[0]!], selection: {
    schemaVersion: 'sutura-grounding-selection-v1', mode: 'assist', applied: true, reason: 'semantic-selection',
    originals: original, selectedIds: [original[0]!.id], excluded: [{ id: original[1]!.id, reason: 'irrelevant-insufficient' }],
    judgments: [{ id: original[0]!.id, relevance: 'relevant', support: 'contradicts' }, { id: original[1]!.id, relevance: 'irrelevant', support: 'insufficient' }],
    versionComparisons: [{ id: original[1]!.id, package: 'pkg', expectedVersion: '2.0.0', mentionedVersion: '1.0.0', matches: false }],
  } };
}
describe('groundingSummary', () => {
  it('leaves legacy absence unchanged', () => {
    expect(groundingSummary(undefined)).toEqual([]);
    expect(groundingSummary({ query: 'q', skipped: true, citations: [] })).toEqual([]);
  });
  it('retains exact original/selected/excluded provenance and code-computed version facts', () => {
    const file = grounding(), lines = groundingSummary(file), output = lines.join('\n');
    expect(output).toContain('semantic judgments, not proof that the repair works');
    expect(output).toContain('support=contradicts');
    expect(output).toContain(`selected: ${file.selection!.selectedIds[0]}`);
    expect(output).toContain(`excluded: ${file.selection!.excluded[0]!.id}`);
    expect(output).toContain('irrelevant-insufficient');
    expect(output).toContain('expected=2.0.0; mentioned=1.0.0; matches=false');
    expect(output).toContain('https://docs.example.test/old');
    expect(output).toContain('[run](javascript:alert(1))\n`rm -rf .`');
  });
  it('discloses no-qualified-source while retaining every original citation', () => {
    const file = grounding(), selection = file.selection!;
    file.citations = selection.originals;
    Object.assign(selection, { applied: false, reason: 'no-qualified-source', warning: 'no-qualified-source', selectedIds: selection.originals.map(c => c.id), excluded: [], judgments: selection.originals.map(c => ({ id: c.id, relevance: 'irrelevant', support: 'insufficient' })) });
    const output = groundingSummary(file).join('\n');
    expect(output).toContain('Warning: no-qualified-source');
    expect(output).toContain('All original sources retained');
  });
  it('rejects invalid metadata before reading its untrusted display fields', () => {
    const file = grounding();
    file.selection!.selectedIds = ['foreign'];
    file.selection!.reason = '<script>do not echo</script>';
    expect(groundingSummary(file)).toEqual(['Grounding selection unavailable: invalid metadata; regenerate the report with valid source references.']);
    file.selection = { reason: 'poison' } as never;
    expect(groundingSummary(file)[0]).toContain('invalid metadata');
  });
});
