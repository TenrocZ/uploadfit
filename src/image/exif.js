import { readUint16BE, readUint16LE, readUint32BE, readUint32LE } from '../utils/bytes.js';

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

function matches(bytes, offset, expected) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function readTiffValue(bytes, littleEndian, type, count, valueOffset) {
  if (type !== 3 || count < 1) return null;
  const read16 = littleEndian ? readUint16LE : readUint16BE;
  if (count === 1) return read16(bytes, valueOffset);
  const offset = littleEndian
    ? readUint32LE(bytes, valueOffset)
    : readUint32BE(bytes, valueOffset);
  if (offset === null) return null;
  return read16(bytes, offset);
}

function parseTiffOrientation(bytes, tiffStart, tiffLength) {
  const end = tiffStart + tiffLength;
  if (tiffStart + 8 > end) return 1;
  const littleEndian = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
  const bigEndian = bytes[tiffStart] === 0x4d && bytes[tiffStart + 1] === 0x4d;
  if (!littleEndian && !bigEndian) return 1;
  const read16 = littleEndian ? readUint16LE : readUint16BE;
  const read32 = littleEndian ? readUint32LE : readUint32BE;
  if (read16(bytes, tiffStart + 2) !== 42) return 1;
  const ifdOffset = read32(bytes, tiffStart + 4);
  if (ifdOffset === null || tiffStart + ifdOffset + 2 > end) return 1;
  const ifdStart = tiffStart + ifdOffset;
  const entries = read16(bytes, ifdStart);
  if (entries === null || entries > 1024 || ifdStart + 2 + entries * 12 > end) return 1;
  for (let index = 0; index < entries; index += 1) {
    const entry = ifdStart + 2 + index * 12;
    const tag = read16(bytes, entry);
    if (tag !== 0x0112) continue;
    const type = read16(bytes, entry + 2);
    const count = read32(bytes, entry + 4);
    const value = readTiffValue(bytes, littleEndian, type, count, entry + 8);
    return Number.isInteger(value) && value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

/**
 * Read only the EXIF orientation tag. GPS and every other EXIF field are ignored.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function parseExifOrientation(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4
    || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength === null || segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const segmentStart = offset + 2;
    const segmentLengthWithoutSize = segmentLength - 2;
    if (marker === 0xe1 && segmentLengthWithoutSize >= EXIF_HEADER.length
      && matches(bytes, segmentStart, EXIF_HEADER)) {
      return parseTiffOrientation(
        bytes,
        segmentStart + EXIF_HEADER.length,
        segmentLengthWithoutSize - EXIF_HEADER.length
      );
    }
    offset += segmentLength;
  }
  return 1;
}

export function orientationSwapsDimensions(orientation) {
  return [5, 6, 7, 8].includes(orientation);
}

