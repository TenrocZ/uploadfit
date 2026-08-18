export const SUPPORTED_IMAGE_MIMES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const MIME_BY_EXTENSION = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
});

const EXTENSION_BY_MIME = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
});

export function normalizeMime(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  return SUPPORTED_IMAGE_MIMES.includes(normalized) ? normalized : null;
}

export function extensionFromName(name) {
  if (typeof name !== 'string') return null;
  const match = /\.([a-z0-9]{1,12})$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : null;
}

export function mimeFromExtension(extension) {
  if (typeof extension !== 'string') return null;
  return MIME_BY_EXTENSION[extension.replace(/^\./, '').toLowerCase()] ?? null;
}

export function extensionFromMime(mime) {
  return EXTENSION_BY_MIME[normalizeMime(mime)] ?? null;
}

export function extensionsFromMime(mime) {
  const normalized = normalizeMime(mime);
  return normalized === 'image/jpeg'
    ? ['jpg', 'jpeg']
    : normalized
      ? [EXTENSION_BY_MIME[normalized]]
      : [];
}

function startsWithBytes(bytes, expected, offset = 0) {
  if (!(bytes instanceof Uint8Array) || offset + expected.length > bytes.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function detectImageSignature(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46])
    && startsWithBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}

export function mimeAndExtensionAgree(mime, extension) {
  const normalized = normalizeMime(mime);
  const normalizedExtension = typeof extension === 'string'
    ? extension.toLowerCase()
    : null;
  return Boolean(normalized && normalizedExtension
    && extensionsFromMime(normalized).includes(normalizedExtension));
}

