import { describe, expect, it } from 'vitest';
import { validateAudioOutput } from '../../src/audio/validators.js';

function plan(overrides = {}) {
  return {
    targetMime: 'audio/mpeg',
    targetContainer: 'mp3',
    targetCodec: 'mp3',
    targetMaxBytes: 100_000,
    safeTargetBytes: 95_000,
    targetSampleRate: 44_100,
    targetChannels: 2,
    ...overrides
  };
}

function metadata(overrides = {}) {
  return {
    mediaKind: 'audio',
    fileType: 'audio/mpeg',
    signatureMime: 'audio/mpeg',
    container: 'mp3',
    codec: 'mp3',
    size: 80_000,
    durationMs: 10_000,
    sampleRate: 44_100,
    channels: 2,
    frameCount: 24,
    ...overrides
  };
}

const rules = { maxBytes: 100_000, formats: ['audio/mpeg'], extensions: ['.mp3'] };

describe('S2 independent audio output validation', () => {
  it('accepts a representative MP3 within the page limit', () => {
    const result = validateAudioOutput(metadata(), rules, plan(), { durationMs: 10_020 });
    expect(result.valid).toBe(true);
  });

  it('rejects MIME/signature/zero/oversized and tag-only pseudo outputs', () => {
    expect(validateAudioOutput(metadata({ fileType: 'audio/wav' }), rules, plan()).valid).toBe(false);
    expect(validateAudioOutput(metadata({ signatureMime: 'audio/wav', container: 'wav' }), rules, plan()).valid)
      .toBe(false);
    expect(validateAudioOutput(metadata({ size: 0 }), rules, plan()).valid).toBe(false);
    expect(validateAudioOutput(metadata({ size: 100_001 }), rules, plan()).violations)
      .toContainEqual(expect.objectContaining({ code: 'AUDIO_OUTPUT_TOO_LARGE' }));
    expect(validateAudioOutput(metadata({ frameCount: 0 }), rules, plan()).valid).toBe(false);
  });

  it('rejects truncated duration and channel/sample-rate mismatches', () => {
    const result = validateAudioOutput(metadata({ durationMs: 6_000, channels: 1, sampleRate: 48_000 }), rules, plan(), {
      durationMs: 10_000
    });
    expect(result.valid).toBe(false);
    expect(result.violations.map((item) => item.code)).toEqual(expect.arrayContaining([
      'AUDIO_DURATION_MISMATCH',
      'AUDIO_SAMPLE_RATE_MISMATCH',
      'AUDIO_CHANNEL_MISMATCH'
    ]));
  });

  it('warns when safe margin is missed but the hard max is respected', () => {
    const result = validateAudioOutput(metadata({ size: 99_000 }), rules, plan());
    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual({ code: 'AUDIO_SAFETY_MARGIN_MISSED' });
  });

  it('rejects an error-carrying or duration-less output record', () => {
    expect(validateAudioOutput(metadata({ errorCode: 'AUDIO_DECODE_FAILED' }), rules, plan()).valid)
      .toBe(false);
    expect(validateAudioOutput(metadata({ durationMs: undefined }), rules, plan()).valid)
      .toBe(false);
    expect(validateAudioOutput(metadata({ durationMs: 0 }), rules, plan()).valid)
      .toBe(false);
  });
});

