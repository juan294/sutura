import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSingleFileArtifact } from './fleet-artifact.mjs';

// Standard ZIP fixtures generated independently with Python's zipfile.
const normal = Buffer.from('UEsDBBQAAAAIAAAAWV0otzZgEwAAABEAAAAMAAAAcmVjZWlwdC5qc29uq1ZKzs8tyEktSVWyKikqTa0FAFBLAQIUAxQAAAAIAAAAWV0otzZgEwAAABEAAAAMAAAAAAAAAAAAAACkgQAAAAByZWNlaXB0Lmpzb25QSwUGAAAAAAEAAQA6AAAAPQAAAAAA', 'base64');
const bomb = Buffer.from('UEsDBBQAAAAIAAAAWV3BdxA+FAAAAAAQAAAMAAAAcmVjZWlwdC5qc29u7cEBDQAAAMKg2o9vDwcUAAAA8G5QSwECFAMUAAAACAAAAFldwXcQPhQAAAAAEAAADAAAAAAAAAAAAAAApIEAAAAAcmVjZWlwdC5qc29uUEsFBgAAAAABAAEAOgAAAD4AAAAAAA==', 'base64');
const changed = (edit) => { const bytes = Buffer.from(normal); edit(bytes, 61); return bytes; };

test('reads one standard regular-file ZIP without extracting paths', () => {
  assert.equal(decodeSingleFileArtifact(normal, 1024), '{"complete":true}');
  for (const encoded of [
    'UEsDBBQAAAAAAAAAWV0otzZgEQAAABEAAAAMAAAAcmVjZWlwdC5qc29ueyJjb21wbGV0ZSI6dHJ1ZX1QSwECFAMUAAAAAAAAAFldKLc2YBEAAAARAAAADAAAAAAAAAAAAAAApIEAAAAAcmVjZWlwdC5qc29uUEsFBgAAAAABAAEAOgAAADsAAAAAAA==',
    'UEsDBBQACAAIAAAAWV0AAAAAAAAAAAAAAAAMAAAAcmVjZWlwdC5qc29uq1ZKzs8tyEktSVWyKikqTa0FAFBLBwgotzZgEwAAABEAAABQSwECFAMUAAgACAAAAFldKLc2YBMAAAARAAAADAAAAAAAAAAAAAAApIEAAAAAcmVjZWlwdC5qc29uUEsFBgAAAAABAAEAOgAAAE0AAAAAAA==',
  ]) assert.equal(decodeSingleFileArtifact(Buffer.from(encoded, 'base64'), 1024), '{"complete":true}');
});
test('bounds compressed input and declared and actual expanded output', () => {
  assert.throws(() => decodeSingleFileArtifact(normal, 16));
  assert.throws(() => decodeSingleFileArtifact(bomb, 256));
  const lying = Buffer.from(bomb);
  lying.writeUInt32LE(1, 22); lying.writeUInt32LE(1, 62 + 24);
  assert.throws(() => decodeSingleFileArtifact(lying, 256));
});
test('rejects unsafe names, symlinks, encrypted entries and unsupported compression', () => {
  for (const edit of [
    (b, c) => { b.write('../evil.json', 30); b.write('../evil.json', c + 46); },
    (b, c) => b.writeUInt32LE((0o120777 * 65536) >>> 0, c + 38),
    (b, c) => { b.writeUInt16LE(1, 6); b.writeUInt16LE(1, c + 8); },
    (b, c) => { b.writeUInt16LE(99, 8); b.writeUInt16LE(99, c + 10); },
  ]) assert.throws(() => decodeSingleFileArtifact(changed(edit), 1024));
});
test('rejects partial, multi-file, checksum-corrupt and contradictory archives', () => {
  for (const bytes of [normal.subarray(0, -1), Buffer.concat([normal, normal]),
    changed((b, c) => b.writeUInt16LE(2, c + 58 + 10)),
    changed(b => { b[45] ^= 1; }),
    changed((b, c) => b.writeUInt32LE(5, c + 24)),
    changed((b, c) => b.writeUInt32LE(1, c + 42)),
  ]) assert.throws(() => decodeSingleFileArtifact(bytes, 1024));
});
