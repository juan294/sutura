import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { selectBoundedSourceWindow } from './source-window.js';

const limits = {
  maxLinesPerFile: 5,
  maxCharactersPerFile: 20,
  maxBytesPerFile: 20,
};

describe('selectBoundedSourceWindow', () => {
  it('keeps complete target-centered lines and omits a partial scanned tail', () => {
    const scanned = 'one\ntwo\nthree\npartial';
    expect(selectBoundedSourceWindow({
      scanned, scannedBytes: Buffer.byteLength(scanned), fileSize: 100,
      requestedLine: 2, limits,
    })).toEqual({
      content: 'one\ntwo\nthree\n', startLine: 1, truncated: true, boundaryComplete: true,
    });
  });

  it('preserves a complete no-final-newline EOF after omitting earlier lines', () => {
    const scanned = 'one\ntwo\nfinal';
    expect(selectBoundedSourceWindow({
      scanned, scannedBytes: Buffer.byteLength(scanned), fileSize: Buffer.byteLength(scanned),
      requestedLine: 3, limits: { ...limits, maxLinesPerFile: 1 },
    })).toEqual({
      content: 'final', startLine: 3, truncated: true, boundaryComplete: true,
    });
  });

  it('returns no target when one complete line exceeds either output bound', () => {
    const scanned = 'a line that cannot fit\n';
    expect(selectBoundedSourceWindow({
      scanned, scannedBytes: Buffer.byteLength(scanned), fileSize: Buffer.byteLength(scanned),
      limits: { ...limits, maxCharactersPerFile: 5, maxBytesPerFile: 5 },
    })).toEqual({ content: '', startLine: 1, truncated: true, boundaryComplete: true });
  });
});
