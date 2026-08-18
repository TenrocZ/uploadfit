import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { asImageProcessingError, ImageProcessingError } from '../../src/image/errors.js';
import { validateFile } from '../../src/image/metadata.js';

const rootDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

function metadata(overrides = {}) {
  return {
    localName: 'fixture.jpg', mime: 'image/jpeg', extension: 'jpg', size: 50_000,
    width: 390, height: 567, aspectRatio: 390 / 567, orientation: 1, hasAlpha: false,
    decodable: true, declaredMime: 'image/jpeg', declaredExtension: 'jpg',
    signatureMime: 'image/jpeg', signatureValid: true, mimeConsistent: true,
    extensionConsistent: true, encodedWidth: 390, encodedHeight: 567,
    displayWidth: 390, displayHeight: 567, errorCode: null, ...overrides
  };
}

function rules(overrides = {}) {
  return {
    formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'], minBytes: 1, maxBytes: 120_000,
    width: { exact: 390, min: null, max: null }, height: { exact: 567, min: null, max: null },
    aspectRatio: { value: 390 / 567, tolerance: 0.015 }, dpi: null, count: { max: 1 },
    background: null, semanticRequirements: [], confidence: 0.96, sources: [], conflicts: [],
    advisories: [], safetyFlags: [], actionable: true, ...overrides
  };
}

describe('S2 rework contracts', () => {
  it('Q-S2-005: primary resource errors short-circuit with one violation and no fixes', () => {
    for (const code of ['FILE_TOO_LARGE_TO_PROCESS', 'DECODE_FAILED', 'PIXEL_LIMIT_EXCEEDED', 'UNSUPPORTED_FORMAT']) {
      const result = validateFile(metadata({
        errorCode: code,
        decodable: false,
        signatureValid: false,
        signatureMime: null,
        declaredMime: 'image/jpeg'
      }), rules());
      expect(result.violations).toEqual([{ code, expected: null, actual: null }]);
      expect(result.safeAutoFixes).toEqual([]);
      expect(result.requiredConfirmations).toEqual([]);
      expect(result.unfixable).toEqual([code]);
    }
  });

  it('Q-S2-006: undecodable and untrusted metadata cannot be polluted by rule fixes', () => {
    const result = validateFile(metadata({
      errorCode: null,
      decodable: false,
      signatureValid: false,
      signatureMime: null
    }), rules({
      formats: ['image/png'],
      extensions: ['png'],
      width: { exact: 10, min: null, max: null }
    }));
    expect(result.violations).toEqual([{ code: 'DECODE_FAILED', expected: null, actual: null }]);
    expect(result.safeAutoFixes).toEqual([]);
    expect(result.requiredConfirmations).toEqual([]);
  });

  it('Q-S2-007: arbitrary, numeric, and empty error codes fall back to PROCESSING_FAILED', () => {
    expect(asImageProcessingError({ code: 'ARBITRARY', message: 'bad' }).code).toBe('PROCESSING_FAILED');
    expect(asImageProcessingError({ code: 9, message: 'bad' }).code).toBe('PROCESSING_FAILED');
    expect(asImageProcessingError({ code: '', message: 'bad' }).code).toBe('PROCESSING_FAILED');
    expect(new ImageProcessingError('ARBITRARY').code).toBe('PROCESSING_FAILED');
  });

  it('Q-S2-008: fixture generator exits nonzero for an impossible target', () => {
    const result = spawnSync(process.execPath, ['tests/fixtures/generate-fixtures.js'], {
      cwd: rootDir,
      env: { ...process.env, UPLOADFIT_FIXTURE_FORCE_FAILURE: '1' },
      encoding: 'utf8'
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('FIXTURE_TARGET_UNREACHABLE');
  });
});
