import { describe, expect, it } from 'vitest';
import { MAX_INPUT_BYTES } from '../../src/config.js';
import { parseExifOrientation } from '../../src/image/exif.js';
import { inspectImage, validateFile } from '../../src/image/metadata.js';
import { detectImageSignature } from '../../src/utils/mime.js';

function metadata(overrides = {}) {
  return {
    localName: 'fixture.jpg',
    mime: 'image/jpeg',
    extension: 'jpg',
    size: 50_000,
    width: 390,
    height: 567,
    aspectRatio: 390 / 567,
    orientation: 1,
    hasAlpha: false,
    decodable: true,
    declaredMime: 'image/jpeg',
    declaredExtension: 'jpg',
    signatureMime: 'image/jpeg',
    signatureValid: true,
    mimeConsistent: true,
    extensionConsistent: true,
    encodedWidth: 390,
    encodedHeight: 567,
    displayWidth: 390,
    displayHeight: 567,
    errorCode: null,
    ...overrides
  };
}

function rules(overrides = {}) {
  return {
    formats: ['image/jpeg'],
    extensions: ['jpg', 'jpeg'],
    minBytes: 30_720,
    maxBytes: 120_000,
    width: { exact: 390, min: null, max: null },
    height: { exact: 567, min: null, max: null },
    aspectRatio: { value: 390 / 567, tolerance: 0.015 },
    dpi: null,
    count: { max: 1 },
    background: null,
    semanticRequirements: [],
    confidence: 0.96,
    sources: [],
    conflicts: [],
    advisories: [],
    safetyFlags: [],
    actionable: true,
    ...overrides
  };
}

describe('S2 image metadata and validation', () => {
  it('detects the three allowed signatures before decoding', () => {
    expect(detectImageSignature(new Uint8Array([0xff, 0xd8, 0xff, 0]))).toBe('image/jpeg');
    expect(detectImageSignature(new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    ]))).toBe('image/png');
    expect(detectImageSignature(new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50
    ]))).toBe('image/webp');
    expect(detectImageSignature(new Uint8Array([0, 1, 2, 3]))).toBeNull();
  });

  it('reads only EXIF orientation and ignores unrelated metadata', () => {
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe1, 0x00, 0x22,
      0x45, 0x78, 0x69, 0x66, 0, 0,
      0x49, 0x49, 0x2a, 0, 0x08, 0, 0, 0,
      0x01, 0,
      0x12, 0x01, 0x03, 0x00,
      0x01, 0x00, 0x00, 0x00,
      0x06, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00
    ]);
    expect(parseExifOrientation(bytes)).toBe(6);
  });

  it('passes a compliant file and keeps the validation machine-readable', () => {
    const result = validateFile(metadata(), rules());
    expect(result).toMatchObject({ valid: true, violations: [], requiredConfirmations: [] });
  });

  it('classifies format, signature and byte violations without guessing', () => {
    const result = validateFile(metadata({
      mime: 'image/png',
      signatureMime: 'image/png',
      declaredMime: 'image/jpeg',
      extensionConsistent: false,
      size: 200_000
    }), rules());
    expect(result.valid).toBe(false);
    expect(result.violations.map((item) => item.code)).toEqual(expect.arrayContaining([
      'MIME_SIGNATURE_MISMATCH',
      'EXTENSION_MISMATCH',
      'FORMAT_NOT_ALLOWED',
      'FILE_TOO_LARGE'
    ]));
    expect(result.safeAutoFixes).toEqual(expect.arrayContaining(['CONVERT', 'COMPRESS']));
  });

  it('requires explicit flatten confirmation for transparent PNG to JPEG', () => {
    const result = validateFile(metadata({
      mime: 'image/png',
      extension: 'png',
      declaredMime: 'image/png',
      declaredExtension: 'png',
      signatureMime: 'image/png',
      hasAlpha: true
    }), rules({ formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'] }));
    expect(result.valid).toBe(false);
    expect(result.requiredConfirmations).toEqual([
      expect.objectContaining({ type: 'FLATTEN_BACKGROUND', resolved: false, accepted: null })
    ]);
  });

  it('rejects process-sized and pixel-sized input before expensive decode', async () => {
    const tooLarge = {
      name: 'large.jpg',
      type: 'image/jpeg',
      size: MAX_INPUT_BYTES + 1,
      slice() {
        throw new Error('should not read bytes');
      }
    };
    await expect(inspectImage(tooLarge)).resolves.toMatchObject({
      errorCode: 'FILE_TOO_LARGE_TO_PROCESS',
      decodable: false
    });

    await expect(inspectImage({
      name: 'empty.jpg',
      type: 'image/jpeg',
      size: 0,
      slice() { return new Blob([]); }
    })).resolves.toMatchObject({ errorCode: 'DECODE_FAILED' });
  });
});
