import { ASPECT_RATIO_TOLERANCE, MAX_DIMENSION, MAX_INPUT_BYTES } from '../config.js';

export function normalizeRuleText(value) {
  if (typeof value !== 'string') return '';
  const normalized = typeof value.normalize === 'function'
    ? value.normalize('NFKC')
    : value;
  return normalized
    .replace(/[—–−～~]/g, '-')
    .replace(/[：]/g, ':')
    .replace(/[×✕✖＊*]/g, 'x')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeFormatToken(value) {
  const token = String(value ?? '').trim().toLowerCase().replace(/^\./, '');
  if (token === 'jpg' || token === 'jpeg' || token === 'image/jpeg') {
    return { mime: 'image/jpeg', extension: token === 'jpeg' ? 'jpeg' : 'jpg' };
  }
  if (token === 'png' || token === 'image/png') return { mime: 'image/png', extension: 'png' };
  if (token === 'webp' || token === 'image/webp') return { mime: 'image/webp', extension: 'webp' };
  if (token === 'mp3' || token === 'audio/mp3' || token === 'audio/mpeg') {
    return { mime: 'audio/mpeg', extension: '.mp3', mediaKind: 'audio' };
  }
  if (token === 'm4a' || token === 'audio/m4a' || token === 'audio/mp4') {
    return { mime: 'audio/mp4', extension: '.m4a', mediaKind: 'audio' };
  }
  if (token === 'aac' || token === 'audio/aac') {
    return { mime: 'audio/aac', extension: '.aac', mediaKind: 'audio' };
  }
  if (token === 'wav' || token === 'audio/wav' || token === 'audio/x-wav') {
    return { mime: 'audio/wav', extension: '.wav', mediaKind: 'audio' };
  }
  if (token === 'webm' || token === 'audio/webm') {
    return { mime: 'audio/webm', extension: '.webm', mediaKind: 'audio' };
  }
  return null;
}

export function normalizeFormats(values) {
  const formats = [];
  const extensions = [];
  const mediaKinds = new Set();
  for (const value of values ?? []) {
    const normalized = normalizeFormatToken(value);
    if (!normalized) continue;
    mediaKinds.add(normalized.mediaKind ?? 'image');
    if (!formats.includes(normalized.mime)) formats.push(normalized.mime);
    const canonicalExtensions = normalized.mime === 'image/jpeg'
      ? ['jpg', 'jpeg']
      : [normalized.extension];
    for (const extension of canonicalExtensions) {
      if (!extensions.includes(extension)) extensions.push(extension);
    }
  }
  return {
    formats,
    extensions,
    mediaKind: mediaKinds.size === 1 ? [...mediaKinds][0] : mediaKinds.size > 1 ? 'ambiguous' : null
  };
}

export function parseNumeric(value) {
  const number = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

export function toBytes(value, unit, kind = 'max', limit = MAX_INPUT_BYTES) {
  const number = parseNumeric(value);
  if (number === null) return null;
  const normalizedUnit = String(unit ?? 'B').toUpperCase();
  const multiplier = normalizedUnit === 'MIB'
    ? 1024 ** 2
    : normalizedUnit === 'KIB'
      ? 1024
      : normalizedUnit === 'MB' || normalizedUnit === 'M'
    ? (kind === 'min' ? 1024 ** 2 : 1000 ** 2)
    : normalizedUnit === 'KB' || normalizedUnit === 'K'
      ? (kind === 'min' ? 1024 : 1000)
      : 1;
  const bytes = Math.round(number * multiplier);
  const ceiling = Number.isFinite(limit) ? limit : MAX_INPUT_BYTES;
  return bytes > 0 && bytes <= ceiling ? bytes : null;
}

export function normalizeDimension(value) {
  const number = parseNumeric(value);
  return number !== null && number > 0 && number <= MAX_DIMENSION
    ? Math.round(number)
    : null;
}

export function normalizeAspectRatio(numerator, denominator) {
  const first = parseNumeric(numerator);
  const second = parseNumeric(denominator);
  if (!first || !second || first <= 0 || second <= 0) return null;
  const value = first / second;
  return Number.isFinite(value) && value > 0 && value <= MAX_DIMENSION
    ? { value, tolerance: ASPECT_RATIO_TOLERANCE }
    : null;
}
