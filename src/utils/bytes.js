const BYTE_UNITS = Object.freeze(['B', 'KB', 'MB', 'GB']);

export function finiteByteValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function readUint32BE(bytes, offset = 0) {
  if (!(bytes instanceof Uint8Array) || offset < 0 || offset + 4 > bytes.length) return null;
  return ((bytes[offset] << 24) >>> 0)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3];
}

export function readUint32LE(bytes, offset = 0) {
  if (!(bytes instanceof Uint8Array) || offset < 0 || offset + 4 > bytes.length) return null;
  return bytes[offset]
    + (bytes[offset + 1] << 8)
    + (bytes[offset + 2] << 16)
    + (bytes[offset + 3] << 24 >>> 0);
}

export function readUint16BE(bytes, offset = 0) {
  if (!(bytes instanceof Uint8Array) || offset < 0 || offset + 2 > bytes.length) return null;
  return (bytes[offset] << 8) + bytes[offset + 1];
}

export function readUint16LE(bytes, offset = 0) {
  if (!(bytes instanceof Uint8Array) || offset < 0 || offset + 2 > bytes.length) return null;
  return bytes[offset] + (bytes[offset + 1] << 8);
}

export async function readBlobBytes(blob, start = 0, end = undefined) {
  if (!blob || typeof blob.slice !== 'function') throw new TypeError('BLOB_REQUIRED');
  const sliced = blob.slice(start, end);
  if (!sliced || typeof sliced.arrayBuffer !== 'function') {
    throw new TypeError('BLOB_ARRAY_BUFFER_UNAVAILABLE');
  }
  return new Uint8Array(await sliced.arrayBuffer());
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function scaleDimensions(width, height, scale, floorWidth = 1, floorHeight = 1) {
  return {
    width: Math.max(floorWidth, Math.max(1, Math.round(width * scale))),
    height: Math.max(floorHeight, Math.max(1, Math.round(height * scale)))
  };
}

export function formatBytes(value) {
  if (!finiteByteValue(value)) return '0 B';
  let amount = value;
  let index = 0;
  while (amount >= 1000 && index < BYTE_UNITS.length - 1) {
    amount /= 1000;
    index += 1;
  }
  const digits = index === 0 ? 0 : amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${BYTE_UNITS[index]}`;
}

