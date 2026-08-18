import {
  MAX_DECODE_PIXELS,
  MAX_DIMENSION,
  MAX_INPUT_BYTES
} from '../config.js';
import {
  readBlobBytes,
  readUint16BE,
  readUint16LE,
  readUint32BE,
  readUint32LE
} from '../utils/bytes.js';
import {
  detectImageSignature,
  extensionFromMime,
  extensionFromName,
  extensionsFromMime,
  mimeAndExtensionAgree,
  normalizeMime,
  SUPPORTED_IMAGE_MIMES
} from '../utils/mime.js';
import { orientationSwapsDimensions, parseExifOrientation } from './exif.js';
import { ImageProcessingError } from './errors.js';
import { validateRuleSet } from '../rules/validators.js';

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);
const CONFIRMATION_TYPES = new Set(['CROP', 'FLATTEN_BACKGROUND', 'UPSCALE']);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function fileNameOf(file) {
  return typeof file?.name === 'string' ? file.name : 'uploadfit-input';
}

function safeFileSize(file) {
  return typeof file?.size === 'number' && Number.isFinite(file.size) && file.size >= 0
    ? file.size
    : null;
}

function baseMetadata(file, fields = {}) {
  const name = fileNameOf(file);
  const declaredMime = normalizeMime(file?.type) ?? null;
  const extension = extensionFromName(name);
  return {
    localName: name,
    mime: fields.mime ?? declaredMime,
    extension,
    size: safeFileSize(file),
    width: fields.width ?? null,
    height: fields.height ?? null,
    aspectRatio: fields.width && fields.height ? fields.width / fields.height : null,
    orientation: fields.orientation ?? 1,
    hasAlpha: fields.hasAlpha ?? false,
    decodable: fields.decodable ?? false,
    declaredMime,
    declaredExtension: extension,
    signatureMime: fields.signatureMime ?? null,
    signatureValid: fields.signatureValid ?? false,
    mimeConsistent: fields.mimeConsistent ?? false,
    extensionConsistent: fields.extensionConsistent ?? false,
    encodedWidth: fields.encodedWidth ?? null,
    encodedHeight: fields.encodedHeight ?? null,
    displayWidth: fields.displayWidth ?? fields.width ?? null,
    displayHeight: fields.displayHeight ?? fields.height ?? null,
    errorCode: fields.errorCode ?? null
  };
}

function failedMetadata(file, errorCode, fields = {}) {
  return Object.freeze(baseMetadata(file, { ...fields, errorCode, decodable: false }));
}

function parseJpegDimensions(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4
    || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength === null || segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (JPEG_SOF_MARKERS.has(marker) && segmentLength >= 7) {
      const data = offset + 2;
      const height = readUint16BE(bytes, data + 1);
      const width = readUint16BE(bytes, data + 3);
      if (width && height) return { width, height };
    }
    offset += segmentLength;
  }
  return null;
}

function parsePngHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 26) return null;
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  if (!width || !height) return null;
  const colorType = bytes[25];
  let hasAlpha = colorType === 4 || colorType === 6;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    if (length === null || length > bytes.length - offset - 12) break;
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    if (type === 'tRNS') hasAlpha = true;
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return { width, height, hasAlpha };
}

function readUint24LE(bytes, offset) {
  if (offset < 0 || offset + 3 > bytes.length) return null;
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
}

function parseWebpHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    const length = readUint32LE(bytes, offset + 4);
    if (length === null || length > bytes.length - offset - 8) break;
    const data = offset + 8;
    if (type === 'VP8X' && length >= 10) {
      const width = (readUint24LE(bytes, data + 4) ?? 0) + 1;
      const height = (readUint24LE(bytes, data + 7) ?? 0) + 1;
      if (width > 0 && height > 0) return {
        width,
        height,
        hasAlpha: Boolean(bytes[data] & 0x10)
      };
    }
    if (type === 'VP8 ' && length >= 10 && data + 10 <= bytes.length
      && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      const width = readUint16LE(bytes, data + 6) & 0x3fff;
      const height = readUint16LE(bytes, data + 8) & 0x3fff;
      if (width && height) return { width, height, hasAlpha: false };
    }
    if (type === 'VP8L' && length >= 5 && bytes[data] === 0x2f) {
      const bits = bytes[data + 1]
        | (bytes[data + 2] << 8)
        | (bytes[data + 3] << 16)
        | (bytes[data + 4] << 24);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >>> 14) & 0x3fff) + 1;
      if (width && height) return { width, height, hasAlpha: true };
    }
    offset += 8 + length + (length % 2);
  }
  return null;
}

function parseHeader(bytes, mime) {
  if (mime === 'image/jpeg') return parseJpegDimensions(bytes);
  if (mime === 'image/png') return parsePngHeader(bytes);
  if (mime === 'image/webp') return parseWebpHeader(bytes);
  return null;
}

function dimensionError(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'DECODE_FAILED';
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION
    || width * height > MAX_DECODE_PIXELS) return 'PIXEL_LIMIT_EXCEEDED';
  return null;
}

function closeSource(source) {
  try {
    source?.close?.();
  } catch {
    // Cleanup must remain best effort and idempotent.
  }
}

function sampleHasTransparency(source, width, height, possibleAlpha) {
  if (!possibleAlpha) return false;
  try {
    const sampleWidth = Math.max(1, Math.min(256, width));
    const sampleHeight = Math.max(1, Math.min(256, height));
    const canvas = typeof globalThis.OffscreenCanvas === 'function'
      ? new globalThis.OffscreenCanvas(sampleWidth, sampleHeight)
      : globalThis.document?.createElement?.('canvas');
    if (!canvas) return true;
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const context = canvas.getContext?.('2d');
    if (!context) return true;
    context.clearRect(0, 0, sampleWidth, sampleHeight);
    context.drawImage(source, 0, 0, sampleWidth, sampleHeight);
    const alpha = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
    for (let index = 3; index < alpha.length; index += 4) {
      if (alpha[index] < 255) return true;
    }
    return false;
  } catch {
    // A conservative true result is safer than silently losing transparent pixels.
    return true;
  }
}

/**
 * Decode without relying on page DOM. The preferred path explicitly disables
 * browser EXIF autorotation so the pipeline can apply orientation exactly once.
 */
export async function decodeImageSource(file) {
  const createBitmap = globalThis.createImageBitmap;
  if (typeof createBitmap === 'function') {
    try {
      const bitmap = await createBitmap(file, { imageOrientation: 'none' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        orientationAppliedByBrowser: false,
        close: () => closeSource(bitmap)
      };
    } catch {
      try {
        const bitmap = await createBitmap(file);
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          orientationAppliedByBrowser: true,
          close: () => closeSource(bitmap)
        };
      } catch {
        // Continue to the HTMLImageElement fallback.
      }
    }
  }

  const ImageConstructor = globalThis.Image;
  const UrlConstructor = globalThis.URL;
  if (typeof ImageConstructor !== 'function'
    || typeof UrlConstructor?.createObjectURL !== 'function') {
    throw new ImageProcessingError('DECODE_FAILED', 'No supported image decoder is available.');
  }
  const objectUrl = UrlConstructor.createObjectURL(file);
  const image = new ImageConstructor();
  image.decoding = 'async';
  try {
    image.src = objectUrl;
    if (typeof image.decode === 'function') {
      await image.decode();
    } else {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'));
      });
    }
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      orientationAppliedByBrowser: true,
      close: () => {
        image.src = '';
      }
    };
  } finally {
    UrlConstructor.revokeObjectURL?.(objectUrl);
  }
}

function confirmation(type, suggested = null) {
  return {
    id: `confirmation-${type.toLowerCase()}`,
    type,
    required: true,
    resolved: false,
    accepted: null,
    payload: null,
    ...(suggested ? { suggestedPayload: suggested } : {})
  };
}

function addUnique(list, value) {
  if (!list.includes(value)) list.push(value);
}

function addViolation(result, code, expected = null, actual = null) {
  if (!result.violations.some((item) => item.code === code)) {
    result.violations.push({ code, expected, actual });
  }
}

function addConfirmation(result, type, suggested = null) {
  if (!CONFIRMATION_TYPES.has(type)) return;
  if (!result.requiredConfirmations.some((item) => item.type === type)) {
    result.requiredConfirmations.push(confirmation(type, suggested));
  }
}

function dimensionRuleMismatch(value, rule) {
  if (!isRecord(rule)) return null;
  if (Number.isFinite(rule.exact) && value !== rule.exact) {
    return { code: 'DIMENSION_MISMATCH', expected: rule.exact, actual: value };
  }
  if (Number.isFinite(rule.min) && value < rule.min) {
    return { code: 'WIDTH_TOO_SMALL', expected: rule.min, actual: value };
  }
  if (Number.isFinite(rule.max) && value > rule.max) {
    return { code: 'WIDTH_TOO_LARGE', expected: rule.max, actual: value };
  }
  return null;
}

/**
 * Inspect only local bytes and pixels. No file name is sent anywhere; localName
 * exists solely for the caller's local naming decision.
 * @param {File|Blob} file
 * @returns {Promise<Readonly<Record<string, unknown>>>}
 */
export async function inspectImage(file) {
  const size = safeFileSize(file);
  if (!file || size === null || typeof file.slice !== 'function') {
    return failedMetadata(file, 'DECODE_FAILED');
  }
  const declaredMime = normalizeMime(file.type);
  const declaredExtension = extensionFromName(fileNameOf(file));
  if (size === 0) return failedMetadata(file, 'DECODE_FAILED');
  if (size > MAX_INPUT_BYTES) {
    return failedMetadata(file, 'FILE_TOO_LARGE_TO_PROCESS', {
      mime: declaredMime,
      signatureMime: null,
      signatureValid: false,
      mimeConsistent: false,
      extensionConsistent: false
    });
  }

  let prefix;
  try {
    prefix = await readBlobBytes(file, 0, Math.min(size, 32));
  } catch {
    return failedMetadata(file, 'DECODE_FAILED');
  }
  const signatureMime = detectImageSignature(prefix);
  if (!signatureMime || !SUPPORTED_IMAGE_MIMES.includes(signatureMime)) {
    return failedMetadata(file, SUPPORTED_IMAGE_MIMES.includes(declaredMime)
      ? 'DECODE_FAILED'
      : 'UNSUPPORTED_FORMAT', {
      mime: declaredMime,
      signatureMime,
      signatureValid: false,
      mimeConsistent: false,
      extensionConsistent: false
    });
  }

  let bytes;
  try {
    bytes = await readBlobBytes(file);
  } catch {
    return failedMetadata(file, 'DECODE_FAILED', {
      mime: signatureMime,
      signatureMime,
      signatureValid: true,
      mimeConsistent: declaredMime === signatureMime,
      extensionConsistent: mimeAndExtensionAgree(signatureMime, declaredExtension)
    });
  }

  const header = parseHeader(bytes, signatureMime);
  const orientation = signatureMime === 'image/jpeg' ? parseExifOrientation(bytes) : 1;
  const headerError = header ? dimensionError(header.width, header.height) : null;
  if (headerError === 'PIXEL_LIMIT_EXCEEDED') {
    return failedMetadata(file, headerError, {
      mime: signatureMime,
      signatureMime,
      signatureValid: true,
      mimeConsistent: declaredMime === signatureMime,
      extensionConsistent: mimeAndExtensionAgree(signatureMime, declaredExtension),
      orientation,
      encodedWidth: header.width,
      encodedHeight: header.height,
      width: orientationSwapsDimensions(orientation) ? header.height : header.width,
      height: orientationSwapsDimensions(orientation) ? header.width : header.height,
      displayWidth: orientationSwapsDimensions(orientation) ? header.height : header.width,
      displayHeight: orientationSwapsDimensions(orientation) ? header.width : header.height,
      hasAlpha: Boolean(header.hasAlpha)
    });
  }

  let decoded;
  try {
    decoded = await decodeImageSource(file);
  } catch {
    return failedMetadata(file, 'DECODE_FAILED', {
      mime: signatureMime,
      signatureMime,
      signatureValid: true,
      mimeConsistent: declaredMime === signatureMime,
      extensionConsistent: mimeAndExtensionAgree(signatureMime, declaredExtension),
      orientation,
      encodedWidth: header?.width ?? null,
      encodedHeight: header?.height ?? null,
      hasAlpha: Boolean(header?.hasAlpha)
    });
  }

  const encodedWidth = header?.width ?? decoded.width;
  const encodedHeight = header?.height ?? decoded.height;
  const decodedError = dimensionError(encodedWidth, encodedHeight);
  const displayWidth = orientationSwapsDimensions(orientation) ? encodedHeight : encodedWidth;
  const displayHeight = orientationSwapsDimensions(orientation) ? encodedWidth : encodedHeight;
  const hasAlpha = sampleHasTransparency(
    decoded.source,
    decoded.width,
    decoded.height,
    Boolean(header?.hasAlpha)
  );
  decoded.close();
  if (decodedError) {
    return failedMetadata(file, decodedError, {
      mime: signatureMime,
      signatureMime,
      signatureValid: true,
      mimeConsistent: declaredMime === signatureMime,
      extensionConsistent: mimeAndExtensionAgree(signatureMime, declaredExtension),
      orientation,
      encodedWidth,
      encodedHeight,
      width: displayWidth,
      height: displayHeight,
      displayWidth,
      displayHeight,
      hasAlpha
    });
  }

  return Object.freeze(baseMetadata(file, {
    mime: signatureMime,
    signatureMime,
    signatureValid: true,
    mimeConsistent: declaredMime === signatureMime,
    extensionConsistent: mimeAndExtensionAgree(signatureMime, declaredExtension),
    orientation,
    encodedWidth,
    encodedHeight,
    width: displayWidth,
    height: displayHeight,
    displayWidth,
    displayHeight,
    hasAlpha,
    decodable: true,
    errorCode: null
  }));
}

/**
 * Classify metadata against a validated RuleSet without reading a File.
 * @param {Record<string, unknown>} metadata
 * @param {Record<string, unknown>} rules
 * @param {{allowUpscale?: boolean}} options
 */
export function validateFile(metadata, rules, options = {}) {
  const result = {
    valid: false,
    violations: [],
    warnings: [],
    safeAutoFixes: [],
    requiredConfirmations: [],
    unfixable: []
  };
  if (!isRecord(metadata)) {
    addViolation(result, 'DECODE_FAILED');
    result.unfixable.push('DECODE_FAILED');
    return result;
  }
  const ruleValidation = validateRuleSet(rules);
  if (!ruleValidation.valid) {
    addViolation(result, 'RULE_CONFLICT', null, ruleValidation.errors);
    result.unfixable.push('RULE_CONFLICT');
    return result;
  }

  if (metadata.errorCode) {
    addViolation(result, metadata.errorCode);
    if (metadata.errorCode === 'FILE_TOO_LARGE_TO_PROCESS'
      || metadata.errorCode === 'PIXEL_LIMIT_EXCEEDED'
      || metadata.errorCode === 'UNSUPPORTED_FORMAT'
      || metadata.errorCode === 'DECODE_FAILED') {
      result.unfixable.push(metadata.errorCode);
    }
  }
  if (!metadata.decodable) addUnique(result.unfixable, 'DECODE_FAILED');
  if (!metadata.signatureValid) {
    addViolation(result, 'UNSUPPORTED_FORMAT');
    addUnique(result.unfixable, 'UNSUPPORTED_FORMAT');
  }
  if (metadata.signatureValid && (
    metadata.mimeConsistent !== true || metadata.declaredMime !== metadata.signatureMime
  )) {
    addViolation(result, 'MIME_SIGNATURE_MISMATCH', metadata.signatureMime, metadata.declaredMime);
    addUnique(result.safeAutoFixes, 'CONVERT');
  }
  if (metadata.signatureValid && (
    metadata.extensionConsistent !== true
      || !extensionsFromMime(metadata.signatureMime).includes(metadata.declaredExtension)
  )) {
    addViolation(result, 'EXTENSION_MISMATCH', extensionsFromMime(metadata.signatureMime), metadata.declaredExtension);
    addUnique(result.safeAutoFixes, 'CONVERT');
  }

  const allowedFormats = rules.formats ?? [];
  if (allowedFormats.length && !allowedFormats.includes(metadata.signatureMime)) {
    addViolation(result, 'FORMAT_NOT_ALLOWED', allowedFormats, metadata.signatureMime);
    addUnique(result.safeAutoFixes, 'CONVERT');
  }
  if (Number.isFinite(rules.maxBytes) && metadata.size > rules.maxBytes) {
    addViolation(result, 'FILE_TOO_LARGE', rules.maxBytes, metadata.size);
    addUnique(result.safeAutoFixes, 'COMPRESS');
  }
  if (Number.isFinite(rules.minBytes) && metadata.size < rules.minBytes) {
    addViolation(result, 'FILE_TOO_SMALL', rules.minBytes, metadata.size);
    addUnique(result.safeAutoFixes, 'ENCODE');
  }

  const widthMismatch = dimensionRuleMismatch(metadata.width, rules.width);
  const heightMismatch = dimensionRuleMismatch(metadata.height, rules.height);
  if (widthMismatch) {
    const code = widthMismatch.code === 'WIDTH_TOO_SMALL' ? widthMismatch.code : widthMismatch.code;
    addViolation(result, code, widthMismatch.expected, widthMismatch.actual);
    addUnique(result.safeAutoFixes, widthMismatch.code === 'WIDTH_TOO_SMALL' ? 'UPSCALE' : 'RESIZE');
  }
  if (heightMismatch) {
    const code = heightMismatch.code === 'WIDTH_TOO_SMALL'
      ? 'HEIGHT_TOO_SMALL'
      : heightMismatch.code === 'WIDTH_TOO_LARGE'
        ? 'HEIGHT_TOO_LARGE'
        : heightMismatch.code;
    addViolation(result, code, heightMismatch.expected, heightMismatch.actual);
    addUnique(result.safeAutoFixes, code === 'HEIGHT_TOO_SMALL' ? 'UPSCALE' : 'RESIZE');
  }

  const ratio = Number.isFinite(metadata.width) && Number.isFinite(metadata.height) && metadata.height
    ? metadata.width / metadata.height
    : null;
  const ratioRule = rules.aspectRatio;
  const ratioTolerance = Number.isFinite(ratioRule?.tolerance) ? ratioRule.tolerance : 0.015;
  const ratioMismatch = Number.isFinite(ratio) && Number.isFinite(ratioRule?.value)
    && Math.abs(ratio - ratioRule.value) / ratioRule.value > ratioTolerance;
  if (ratioMismatch) {
    addViolation(result, 'ASPECT_RATIO_MISMATCH', ratioRule.value, ratio);
    addUnique(result.safeAutoFixes, 'CROP');
    addConfirmation(result, 'CROP', {
      aspectRatio: ratioRule.value,
      sourceWidth: metadata.width,
      sourceHeight: metadata.height
    });
  }

  const exactMismatch = Boolean(rules.width?.exact || rules.height?.exact)
    && Boolean(widthMismatch || heightMismatch);
  if (exactMismatch && rules.width?.exact && rules.height?.exact && Number.isFinite(ratio)) {
    const exactRatio = rules.width.exact / rules.height.exact;
    if (Math.abs(ratio - exactRatio) / exactRatio > ratioTolerance) {
      addUnique(result.safeAutoFixes, 'CROP');
      addConfirmation(result, 'CROP', {
        aspectRatio: exactRatio,
        sourceWidth: metadata.width,
        sourceHeight: metadata.height
      });
    }
  }

  const needsUpscale = result.safeAutoFixes.includes('UPSCALE');
  if (needsUpscale) {
    if (options.allowUpscale === false) {
      addUnique(result.unfixable, 'UPSCALE_NOT_ALLOWED');
    } else {
      addConfirmation(result, 'UPSCALE', {
        width: rules.width?.exact ?? rules.width?.min ?? null,
        height: rules.height?.exact ?? rules.height?.min ?? null
      });
    }
  }

  const jpegOnly = allowedFormats.length > 0
    && allowedFormats.every((format) => format === 'image/jpeg');
  if (metadata.hasAlpha && jpegOnly) {
    addViolation(result, 'TRANSPARENCY_WILL_BE_LOST');
    addConfirmation(result, 'FLATTEN_BACKGROUND', { color: 'white' });
  }
  if (Array.isArray(rules.semanticRequirements)
    && rules.semanticRequirements.includes('必须使用官方工具')) {
    addViolation(result, 'OFFICIAL_TOOL_REQUIRED');
    addUnique(result.unfixable, 'OFFICIAL_TOOL_REQUIRED');
  }
  if (rules.dpi !== null && rules.dpi !== undefined) {
    result.warnings.push({ code: 'DPI_DISPLAY_ONLY', value: rules.dpi });
  }

  result.valid = result.violations.length === 0
    && result.requiredConfirmations.length === 0
    && result.unfixable.length === 0;
  return result;
}

export { parseJpegDimensions, parsePngHeader, parseWebpHeader };
