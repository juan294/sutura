import { inflateRawSync } from 'node:zlib';

const requireFact = (condition) => { if (!condition) throw new Error('Evidence artifact is not a bounded single regular-file ZIP'); };
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Decode in memory: never extract archive-controlled filesystem paths. ZIP64 and
 * multi-entry archives are outside this deliberately narrow evidence contract. */
export function decodeSingleFileArtifact(bytes, maximumBytes = 32 * 1024 * 1024) {
  requireFact(Buffer.isBuffer(bytes) && Number.isSafeInteger(maximumBytes) && maximumBytes > 0 &&
    maximumBytes <= 64 * 1024 * 1024 && bytes.length >= 22 && bytes.length <= maximumBytes);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  requireFact(end >= 0 && bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0 &&
    bytes.readUInt16LE(end + 8) === 1 && bytes.readUInt16LE(end + 10) === 1);
  const central = bytes.readUInt32LE(end + 16), centralSize = bytes.readUInt32LE(end + 12);
  requireFact(central + centralSize === end && centralSize >= 46 && central + 46 <= end && bytes.readUInt32LE(central) === 0x02014b50);
  const flags = bytes.readUInt16LE(central + 8), method = bytes.readUInt16LE(central + 10);
  const checksum = bytes.readUInt32LE(central + 16), compressed = bytes.readUInt32LE(central + 20), expanded = bytes.readUInt32LE(central + 24);
  const nameSize = bytes.readUInt16LE(central + 28), extraSize = bytes.readUInt16LE(central + 30), commentSize = bytes.readUInt16LE(central + 32);
  const attributes = bytes.readUInt32LE(central + 38), mode = attributes >>> 16;
  requireFact((flags & ~0x080e) === 0 && [0, 8].includes(method) && expanded <= maximumBytes && compressed <= maximumBytes &&
    centralSize === 46 + nameSize + extraSize + commentSize && bytes.readUInt16LE(central + 34) === 0 &&
    bytes.readUInt32LE(central + 42) === 0 && (mode === 0 || (mode & 0o170000) === 0o100000) && (attributes & 0x10) === 0);
  const nameBytes = bytes.subarray(central + 46, central + 46 + nameSize);
  const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
  requireFact(name.length > 0 && !/[\\\0\r\n:]/u.test(name) && !name.startsWith('/') &&
    name.split('/').every(part => part && part !== '.' && part !== '..'));
  requireFact(central >= 30 && bytes.readUInt32LE(0) === 0x04034b50 && bytes.readUInt16LE(6) === flags && bytes.readUInt16LE(8) === method &&
    bytes.readUInt16LE(26) === nameSize);
  const dataStart = 30 + nameSize + bytes.readUInt16LE(28), dataEnd = dataStart + compressed;
  requireFact(dataStart <= central && dataEnd <= central && bytes.subarray(30, 30 + nameSize).equals(nameBytes));
  if (flags & 8) {
    const descriptor = dataEnd + (central - dataEnd === 16 && bytes.readUInt32LE(dataEnd) === 0x08074b50 ? 4 : 0);
    requireFact(descriptor + 12 === central && bytes.readUInt32LE(descriptor) === checksum &&
      bytes.readUInt32LE(descriptor + 4) === compressed && bytes.readUInt32LE(descriptor + 8) === expanded);
  } else {
    requireFact(dataEnd === central && bytes.readUInt32LE(14) === checksum && bytes.readUInt32LE(18) === compressed && bytes.readUInt32LE(22) === expanded);
  }
  const payload = bytes.subarray(dataStart, dataEnd);
  const decoded = method === 0 ? payload : inflateRawSync(payload, { maxOutputLength: Math.max(1, maximumBytes) });
  requireFact(decoded.length === expanded && crc32(decoded) === checksum);
  return new TextDecoder('utf-8', { fatal: true }).decode(decoded);
}
