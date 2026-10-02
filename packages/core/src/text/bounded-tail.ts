import { Buffer } from 'node:buffer';

export interface TailBounds {
  maxLines: number;
  maxCharacters: number;
  maxBytes: number;
}

export function boundedTail(value: string, bounds: TailBounds): string {
  let start = Math.max(0, value.length - bounds.maxCharacters);

  if (Buffer.byteLength(value.slice(start), 'utf8') > bounds.maxBytes) {
    let low = start;
    let high = value.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (Buffer.byteLength(value.slice(middle), 'utf8') <= bounds.maxBytes) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    start = low;
  }

  let lines = 1;
  for (let index = value.length - 1; index >= start; index -= 1) {
    if (value[index] === '\n' && ++lines > bounds.maxLines) {
      start = index + 1;
      break;
    }
  }

  if (start < value.length && /[\uDC00-\uDFFF]/.test(value[start] ?? '')) {
    start += 1;
  }

  return value.slice(start);
}

/** Classifies a line after a carried header: inside its block, its last line, or not a block. */
export type HeaderBlockLine = 'continue' | 'end' | 'abort';

/** Lines a carried header block may span after its header. */
export const HEADER_BLOCK_LINES = 40;

interface CarriedHeader { start: number; end: number }

/** Offsets of the last header line at or before `position`, excluding its newline. */
function lastHeaderAtOrBefore(
  value: string,
  position: number,
  isHeader: (line: string) => boolean,
): CarriedHeader | undefined {
  let start = value.lastIndexOf('\n', position - 1) + 1;
  let end = value.indexOf('\n', position);
  if (end < 0) end = value.length;
  for (;;) {
    if (isHeader(value.slice(start, end).replace(/\r$/, ''))) return { start, end };
    if (start === 0) return undefined;
    end = start - 1;
    start = value.lastIndexOf('\n', end - 1) + 1;
  }
}

/** Extends a header to the end of its block when `blockLine` ends one within the line limit. */
function withBlock(
  value: string,
  header: CarriedHeader,
  blockLine: ((line: string) => HeaderBlockLine) | undefined,
): CarriedHeader | undefined {
  if (blockLine === undefined) return undefined;
  let end = header.end;
  for (let count = 0; count < HEADER_BLOCK_LINES && end < value.length; count += 1) {
    const next = value.indexOf('\n', end + 1);
    const lineEnd = next < 0 ? value.length : next;
    const kind = blockLine(value.slice(end + 1, lineEnd).replace(/\r$/, ''));
    if (kind === 'abort') return undefined;
    end = lineEnd;
    if (kind === 'end') return { start: header.start, end };
  }
  return undefined;
}

/**
 * Bounded tail that keeps the command header governing it. A step's header is
 * head-anchored, so an unmodified tail loses it exactly when the log is most
 * verbose. When no header survives, the nearest header before the cut is
 * carried as the first line, which is the command a last-match reader of the
 * whole log would have seen. The header's cost is subtracted from every bound
 * before the tail is taken, so the result still respects all of them.
 * With `blockLine`, the lines the header governs (a multi-line script echo)
 * are carried with it when they end within the line limit and fit the bounds;
 * otherwise only the header line is carried.
 */
export function boundedTailWithHeader(
  value: string,
  bounds: TailBounds,
  isHeader: (line: string) => boolean,
  blockLine?: (line: string) => HeaderBlockLine,
): string {
  const tail = boundedTail(value, bounds);
  if (tail.length === value.length || tail.split(/\r?\n/).some(isHeader)) return tail;
  const header = lastHeaderAtOrBefore(value, value.length - tail.length, isHeader);
  if (header === undefined) return tail;
  const block = withBlock(value, header, blockLine);
  return (block === undefined ? undefined : carriedTail(value, bounds, block)) ??
    carriedTail(value, bounds, header) ?? tail;
}

function carriedTail(value: string, bounds: TailBounds, carried: CarriedHeader): string | undefined {
  const text = `${value.slice(carried.start, carried.end).replace(/\r$/, '')}\n`;
  const lineCount = text.split('\n').length - 1;
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bounds.maxLines <= lineCount || text.length > bounds.maxCharacters || bytes > bounds.maxBytes) {
    return undefined;
  }
  const rest = boundedTail(value, {
    maxLines: bounds.maxLines - lineCount,
    maxCharacters: bounds.maxCharacters - text.length,
    maxBytes: bounds.maxBytes - bytes,
  });
  // The tail is shorter than the uncarried one by at least the carried size,
  // and that one started after the header, so the two never overlap.
  return text + rest;
}
