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
  return null;
}

export function normalizeFormats(values) {
  const formats = [];
  const extensions = [];
  for (const value of values ?? []) {
    const normalized = normalizeFormatToken(value);
    if (!normalized) continue;
    if (!formats.includes(normalized.mime)) formats.push(normalized.mime);
    if (!extensions.includes(normalized.extension)) extensions.push(normalized.extension);
    if (normalized.mime === 'image/jpeg' && !extensions.includes('jpeg')) extensions.push('jpeg');
  }
  return { formats, extensions };
}

export function parseNumeric(value) {
  const number = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

export function toBytes(value, unit, kind = 'max') {
  const number = parseNumeric(value);
  if (number === null) return null;
  const normalizedUnit = String(unit ?? 'B').toUpperCase();
  const multiplier = normalizedUnit === 'MB' || normalizedUnit === 'M'
    ? (kind === 'min' ? 1024 ** 2 : 1000 ** 2)
    : normalizedUnit === 'KB' || normalizedUnit === 'K'
      ? (kind === 'min' ? 1024 : 1000)
      : 1;
  const bytes = Math.round(number * multiplier);
  return bytes > 0 && bytes <= MAX_INPUT_BYTES ? bytes : null;
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
