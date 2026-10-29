const TAR_BLOCK_BYTES = 512;
const TAR_LONG_NAME_BYTES = 100;
/** End-of-archive blocks plus padding to tar's default 10 KiB record. */
export const OVERLAY_TAR_TRAILER_BYTES = 10_240;

export interface OverlayChunkFile {
  path: string;
  /** Data bytes of a regular file; 0 for a symlink. */
  size: number;
}

export class OverlayChunkError extends Error {
  constructor(message: string, readonly path: string, readonly size: number) {
    super(message);
    this.name = 'OverlayChunkError';
  }
}

function roundUpToBlock(bytes: number): number {
  return Math.ceil(bytes / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
}

/** Header, block-padded data and the extra header a long path needs. */
export function tarEntryBytes(path: string, size: number): number {
  const nameBytes = Buffer.byteLength(path);
  const longName = nameBytes > TAR_LONG_NAME_BYTES
    ? TAR_BLOCK_BYTES + roundUpToBlock(nameBytes + 1)
    : 0;
  return TAR_BLOCK_BYTES + roundUpToBlock(size) + longName;
}

/** Splits ordered paths into bounded tar groups; an unsplittable file is refused. */
export function planOverlayChunks(
  files: readonly OverlayChunkFile[],
  budget: number,
): string[][] {
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    throw new RangeError('Overlay chunk budget must be a positive integer');
  }
  const capacity = budget - OVERLAY_TAR_TRAILER_BYTES;
  const groups: string[][] = [];
  const placed = new Set<string>();
  let current: string[] = [];
  let used = 0;
  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
    used = 0;
  };
  for (const { path, size } of files) {
    if (placed.has(path)) continue;
    placed.add(path);
    const bytes = tarEntryBytes(path, size);
    if (bytes > capacity) {
      throw new OverlayChunkError(
        `ConTree repository overlay refuses ${path} (${size} bytes): it exceeds the ${budget}-byte overlay chunk budget and a file cannot be split`,
        path,
        size,
      );
    }
    if (used + bytes > capacity) flush();
    current.push(path);
    used += bytes;
  }
  flush();
  return groups;
}
