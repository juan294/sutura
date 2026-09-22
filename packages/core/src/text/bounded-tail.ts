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

function lastHeaderAtOrBefore(
  value: string,
  position: number,
  isHeader: (line: string) => boolean,
): string | undefined {
  let start = value.lastIndexOf('\n', position - 1) + 1;
  let end = value.indexOf('\n', position);
  if (end < 0) end = value.length;
  for (;;) {
    const line = value.slice(start, end).replace(/\r$/, '');
    if (isHeader(line)) return line;
    if (start === 0) return undefined;
    end = start - 1;
    start = value.lastIndexOf('\n', end - 1) + 1;
  }
}

/**
 * Bounded tail that keeps the command header governing it. A step's header is
 * head-anchored, so an unmodified tail loses it exactly when the log is most
 * verbose. When no header survives, the nearest header before the cut is
 * carried as the first line, which is the command a last-match reader of the
 * whole log would have seen. The header's cost is subtracted from every bound
 * before the tail is taken, so the result still respects all of them.
 */
export function boundedTailWithHeader(
  value: string,
  bounds: TailBounds,
  isHeader: (line: string) => boolean,
): string {
  const tail = boundedTail(value, bounds);
  if (tail.length === value.length || tail.split(/\r?\n/).some(isHeader)) return tail;
  const header = lastHeaderAtOrBefore(value, value.length - tail.length, isHeader);
  if (header === undefined) return tail;
  const carried = `${header}\n`;
  const carriedBytes = Buffer.byteLength(carried, 'utf8');
  if (bounds.maxLines < 2 || carried.length > bounds.maxCharacters || carriedBytes > bounds.maxBytes) {
    return tail;
  }
  return carried + boundedTail(value, {
    maxLines: bounds.maxLines - 1,
    maxCharacters: bounds.maxCharacters - carried.length,
    maxBytes: bounds.maxBytes - carriedBytes,
  });
}
