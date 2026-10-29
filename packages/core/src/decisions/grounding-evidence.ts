export interface GroundingCitation { title: string; url: string; snippet: string }
export interface GroundingJudgment {
  id: string;
  relevance: 'relevant' | 'irrelevant' | 'unknown';
  support: 'supports' | 'contradicts' | 'insufficient' | 'unknown';
}
export interface GroundingVersionComparison {
  id: string; package: string; expectedVersion: string; mentionedVersion: string; matches: boolean;
}
/** Public retrieved-source provenance; labels never establish repair correctness. */
export interface GroundingSelection {
  schemaVersion: 'sutura-grounding-selection-v1';
  mode: 'shadow' | 'assist'; applied: boolean; reason: string;
  originals: Array<GroundingCitation & { id: string }>;
  selectedIds: string[];
  excluded: Array<{ id: string; reason: 'irrelevant-insufficient' }>;
  judgments: GroundingJudgment[];
  versionComparisons: GroundingVersionComparison[];
  warning?: 'no-qualified-source';
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).length === allowed.length && allowed.every(k => Object.hasOwn(v, k));
const text = (v: unknown, max: number, empty = false): v is string => typeof v === 'string' && (empty || v.length > 0) && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(v);
const citationId = (v: unknown): v is string => typeof v === 'string' && /^citation-[a-f0-9]{64}$/u.test(v);
const version = (v: unknown): v is string => text(v, 120) && /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/u.test(v);
function webUrl(v: unknown): v is string {
  if (!text(v, 2048)) return false;
  try { const url = new URL(v); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
/** Browser-safe strict validation; actual selected citations must match their originals. */
export function validateGroundingSelection(value: unknown, selectedCitations?: unknown): value is GroundingSelection {
  if (!object(value) || Object.keys(value).some(k => !['schemaVersion', 'mode', 'applied', 'reason', 'originals', 'selectedIds', 'excluded', 'judgments', 'versionComparisons', 'warning'].includes(k)) ||
    value.schemaVersion !== 'sutura-grounding-selection-v1' || !['shadow', 'assist'].includes(value.mode as string) || typeof value.applied !== 'boolean' || !text(value.reason, 160)) return false;
  if (!Array.isArray(value.originals) || value.originals.length === 0 || value.originals.length > 32 ||
    !value.originals.every(c => object(c) && keys(c, ['id', 'title', 'url', 'snippet']) && citationId(c.id) && text(c.title, 512) && webUrl(c.url) && text(c.snippet, 2000, true))) return false;
  const originals = value.originals as GroundingSelection['originals'];
  const ids = originals.map(c => c.id); const known = new Set(ids);
  if (known.size !== ids.length) return false;
  if (!Array.isArray(value.selectedIds) || value.selectedIds.length === 0 || value.selectedIds.length > ids.length ||
    !value.selectedIds.every(id => typeof id === 'string' && known.has(id)) || new Set(value.selectedIds).size !== value.selectedIds.length) return false;
  const selected = value.selectedIds as string[];
  if (!Array.isArray(value.excluded) || value.excluded.length > ids.length || !value.excluded.every(e => object(e) && keys(e, ['id', 'reason']) && typeof e.id === 'string' && known.has(e.id) && !selected.includes(e.id) && e.reason === 'irrelevant-insufficient')) return false;
  const excluded = value.excluded as GroundingSelection['excluded'];
  if (new Set(excluded.map(e => e.id)).size !== excluded.length || selected.length + excluded.length !== ids.length) return false;
  if (!Array.isArray(value.judgments) || value.judgments.length !== ids.length || !value.judgments.every(j => object(j) && keys(j, ['id', 'relevance', 'support']) && typeof j.id === 'string' && known.has(j.id) && ['relevant', 'irrelevant', 'unknown'].includes(j.relevance as string) && ['supports', 'contradicts', 'insufficient', 'unknown'].includes(j.support as string))) return false;
  const judgments = value.judgments as GroundingJudgment[];
  if (new Set(judgments.map(j => j.id)).size !== ids.length) return false;
  if (value.applied) {
    if (value.mode !== 'assist' || judgments.some(j => j.relevance === 'unknown' || j.support === 'unknown' || j.relevance === 'irrelevant' && j.support !== 'insufficient') ||
      judgments.some(j => (j.relevance === 'irrelevant' && j.support === 'insufficient') !== excluded.some(e => e.id === j.id))) return false;
  } else if (excluded.length > 0 || selected.some((id, index) => id !== ids[index])) return false;
  if (value.warning !== undefined && (value.warning !== 'no-qualified-source' || value.applied || !judgments.every(j => j.relevance === 'irrelevant' && j.support === 'insufficient'))) return false;
  if (!Array.isArray(value.versionComparisons) || value.versionComparisons.length > 128 || !value.versionComparisons.every(v => object(v) && keys(v, ['id', 'package', 'expectedVersion', 'mentionedVersion', 'matches']) && typeof v.id === 'string' && known.has(v.id) && text(v.package, 160) && /^@?[a-z0-9][\w./-]*$/iu.test(v.package) && version(v.expectedVersion) && version(v.mentionedVersion) && typeof v.matches === 'boolean' && v.matches === (v.expectedVersion === v.mentionedVersion))) return false;
  if (selectedCitations !== undefined) {
    if (!Array.isArray(selectedCitations) || selectedCitations.length !== selected.length || !selectedCitations.every((c, index) => {
      const original = originals.find(o => o.id === selected[index]);
      return object(c) && original !== undefined && c.title === original.title && c.url === original.url && c.snippet === original.snippet;
    })) return false;
  }
  return true;
}
