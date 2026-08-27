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
