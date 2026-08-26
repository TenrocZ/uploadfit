import { describe, expect, it } from 'vitest';
import { validateAudioMetadata, isAudioPassthrough } from '../../src/audio/validators.js';

const mp3Metadata = (overrides = {}) => ({
  mediaKind: 'audio',
  fileType: 'audio/mpeg',
  signatureMime: 'audio/mpeg',
  container: 'mp3',
  codec: 'mp3',
  size: 2_000_000,
  durationMs: 120_000,
  sampleRate: 44100,
  channels: 1,
  bitDepth: null,
  averageBitrate: 128_000,
  variableBitrate: false,
  seekable: true,
  inspectedBytes: 100,
  errorCode: null,
  warnings: [],
  ...overrides
});

const rules = (overrides = {}) => ({
  mediaKind: 'audio',
  formats: ['audio/mpeg'],
  extensions: ['.mp3'],
  minBytes: null,
  maxBytes: 3_000_000,
  duration: { exactMs: null, minMs: null, maxMs: null },
  audio: { sampleRates: [], channels: [], bitDepths: [] },
  width: { exact: null, min: null, max: null },
  height: { exact: null, min: null, max: null },
  aspectRatio: null,
  dpi: null,
  count: { max: null },
  background: null,
  semanticRequirements: [],
  confidence: 0.95,
  sources: [],
  conflicts: [],
  advisories: [],
  safetyFlags: [],
  actionable: true,
  ...overrides
});

describe('audio validation boundaries', () => {
  it('passes a compliant MP3 through without a confirmation', () => {
    const metadata = mp3Metadata();
    const result = validateAudioMetadata(metadata, rules());
    expect(result).toMatchObject({ valid: true, violations: [], requiredConfirmations: [] });
    expect(isAudioPassthrough(metadata, rules(), result)).toBe(true);
  });

  it('requires lossy confirmation for verified MP3, WAV and AAC-LC M4A processing', () => {
    const overMp3 = validateAudioMetadata(mp3Metadata({ size: 4_000_000 }), rules());
    expect(overMp3.valid).toBe(false);
    expect(overMp3.safeAutoFixes).toContain('REENCODE_AUDIO');
    expect(overMp3.requiredConfirmations.map((item) => item.type)).toContain('AUDIO_LOSSY_TRANSCODE');
    expect(overMp3.unfixable).not.toContain('AUDIO_CODEC_UNSUPPORTED');
    const wav = validateAudioMetadata(mp3Metadata({
      signatureMime: 'audio/wav', container: 'wav', codec: 'pcm', size: 4_000_000
    }), rules());
    expect(wav.safeAutoFixes).toContain('TRANSCODE_AUDIO');
    expect(wav.requiredConfirmations.map((item) => item.type)).toContain('AUDIO_LOSSY_TRANSCODE');
    expect(wav.requiredConfirmations[0].id).toMatch(/^confirmation-audio_lossy_transcode-/);
    const largerWav = validateAudioMetadata(mp3Metadata({
      signatureMime: 'audio/wav', container: 'wav', codec: 'pcm', size: 5_000_000
    }), rules());
    expect(largerWav.requiredConfirmations[0].id).not.toBe(wav.requiredConfirmations[0].id);

    const m4a = validateAudioMetadata(mp3Metadata({
      signatureMime: 'audio/mp4', container: 'mp4', codec: 'aac-lc', size: 4_000_000
    }), rules());
    expect(m4a.safeAutoFixes).toContain('TRANSCODE_AUDIO');
    expect(m4a.requiredConfirmations.map((item) => item.type)).toContain('AUDIO_LOSSY_TRANSCODE');
    expect(m4a.unfixable).not.toContain('AUDIO_CODEC_UNSUPPORTED');
  });

  it('passes through allowed AAC-LC M4A and does not require MP3 output', () => {
    const metadata = mp3Metadata({
      fileType: 'audio/mp4', signatureMime: 'audio/mp4', container: 'mp4', codec: 'aac-lc'
    });
    const pageRules = rules({ formats: ['audio/mp4'], extensions: ['.m4a'] });
    const result = validateAudioMetadata(metadata, pageRules);
    expect(result).toMatchObject({ valid: true, violations: [], requiredConfirmations: [], unfixable: [] });
    expect(isAudioPassthrough(metadata, pageRules, result)).toBe(true);
  });

  it('stops when MP3/maxBytes are not explicit or when duration is the blocker', () => {
    expect(validateAudioMetadata(mp3Metadata(), rules({ formats: [], extensions: [], maxBytes: null })).unfixable)
      .toEqual(expect.arrayContaining(['RULES_INSUFFICIENT', 'AUDIO_OUTPUT_FORMAT_NOT_ALLOWED']));
    const duration = validateAudioMetadata(mp3Metadata({ durationMs: 7_200_001 }), rules({
      duration: { exactMs: null, minMs: null, maxMs: 7_200_000 }
    }));
    expect(duration.unfixable).toContain('AUDIO_DURATION_LIMIT_UNFIXABLE');
    const unsafe = validateAudioMetadata(mp3Metadata(), rules({ maxBytes: null }));
    expect(unsafe.unfixable).toContain('RULES_INSUFFICIENT');
  });

  it('stops for semantic original/lossless/official requirements and corrupt metadata', () => {
    const result = validateAudioMetadata(mp3Metadata(), rules({
      semanticRequirements: ['原始录音', '无损音频', '必须使用官方工具']
    }));
    expect(result.unfixable).toEqual(expect.arrayContaining([
      'AUDIO_ORIGINAL_REQUIRED', 'AUDIO_LOSSLESS_REQUIRED', 'OFFICIAL_TOOL_REQUIRED'
    ]));
    expect(validateAudioMetadata({ errorCode: 'AUDIO_CODEC_UNSUPPORTED' }, rules()).unfixable)
      .toContain('AUDIO_CODEC_UNSUPPORTED');
  });
});
