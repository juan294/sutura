import { Buffer } from 'node:buffer';

export interface BoundedSourceWindowLimits {
  maxLinesPerFile: number;
  maxCharactersPerFile: number;
  maxBytesPerFile: number;
}

export interface BoundedSourceWindow {
  content: string;
  startLine: number;
  truncated: boolean;
  boundaryComplete: true;
}

export class SourceWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceWindowError';
  }
}

export function selectBoundedSourceWindow(input: {
  scanned: string;
  scannedBytes: number;
  fileSize: number;
  requestedLine?: number;
  limits: Readonly<BoundedSourceWindowLimits>;
}): BoundedSourceWindow {
  const scanTruncated = input.scannedBytes < input.fileSize;
  const completeScan = scanTruncated && !input.scanned.endsWith('\n')
    ? input.scanned.slice(0, input.scanned.lastIndexOf('\n') + 1)
    : input.scanned;
  const allLines: string[] = [];
  let lineStart = 0;
  for (let index = 0; index < completeScan.length; index += 1) {
    if (completeScan[index] !== '\n') continue;
    allLines.push(completeScan.slice(lineStart, index + 1));
    lineStart = index + 1;
  }
  if (lineStart < completeScan.length || completeScan.length === 0) {
    allLines.push(completeScan.slice(lineStart));
  }
  const target = Math.max(input.requestedLine ?? 1, 1);
  if (target > allLines.length) {
    throw new SourceWindowError('Referenced source line exceeds the available source window');
  }
  const halfWindow = Math.floor(input.limits.maxLinesPerFile / 2);
  const windowStart = Math.max(0, target - 1 - halfWindow);
  const windowEnd = Math.min(allLines.length, windowStart + input.limits.maxLinesPerFile);
  let selectedStart = target - 1;
  let selectedEnd = target;
  let selectedCharacters = allLines[selectedStart]?.length ?? 0;
  let selectedBytes = Buffer.byteLength(allLines[selectedStart] ?? '', 'utf8');
  if (
    selectedCharacters > input.limits.maxCharactersPerFile ||
    selectedBytes > input.limits.maxBytesPerFile
  ) {
    selectedEnd = selectedStart;
  } else {
    let preferBefore = true;
    while (selectedEnd - selectedStart < input.limits.maxLinesPerFile) {
      const indexes = preferBefore
        ? [selectedStart - 1, selectedEnd]
        : [selectedEnd, selectedStart - 1];
      const next = indexes.find((index) => {
        if (index < windowStart || index >= windowEnd) return false;
        const line = allLines[index]!;
        return selectedCharacters + line.length <= input.limits.maxCharactersPerFile &&
          selectedBytes + Buffer.byteLength(line, 'utf8') <= input.limits.maxBytesPerFile;
      });
      if (next === undefined) break;
      const line = allLines[next]!;
      selectedCharacters += line.length;
      selectedBytes += Buffer.byteLength(line, 'utf8');
      if (next < selectedStart) selectedStart = next;
      else selectedEnd = next + 1;
      preferBefore = !preferBefore;
    }
  }
  return {
    content: allLines.slice(selectedStart, selectedEnd).join(''),
    startLine: selectedStart + 1,
    truncated: selectedStart > 0 || selectedEnd < allLines.length || scanTruncated,
    boundaryComplete: true,
  };
}
