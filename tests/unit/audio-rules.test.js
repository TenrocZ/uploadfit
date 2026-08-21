import { describe, expect, it } from 'vitest';
import { normalizeFormatToken, normalizeFormats } from '../../src/rules/normalizer.js';
import { parseRulesDeterministically } from '../../src/rules/deterministic-parser.js';
import { resolveRules } from '../../src/rules/resolver.js';

function resolve(text, attributes = {}) {
  return resolveRules(parseRulesDeterministically({
    attributes,
    normalizedText: text
  }));
}

describe('audio rule normalization and parsing', () => {
  it('normalizes MP3 and audio extensions to the shared contract', () => {
    expect(normalizeFormatToken('.MP3')).toMatchObject({ mime: 'audio/mpeg', extension: '.mp3' });
    expect(normalizeFormats(['mp3', 'm4a', 'wav'])).toMatchObject({
      formats: ['audio/mpeg', 'audio/mp4', 'audio/wav'],
      extensions: ['.mp3', '.m4a', '.wav'],
      mediaKind: 'audio'
    });
  });

  it.each([
    '仅支持 MP3', '支持 mp3、m4a、wav', '格式：.MP3', '音频不超过 100MB',
    '音频单文件最大 100 MB', '音频大小上限 100000000 字节', '音频最大 25MiB', '音频最大 100000000 bytes',
    '允许 audio/mpeg，最大 100 MB', '支持 MP3 格式', '录音文件不超过 50MB', '上传音频，≤100MB',
    'mp3 文件大小上限 100000000B', '最大 1 GB 的 MP3', '音频格式为 wav', '允许 AAC 与 MP3',
    '请使用 .mp3', '支持 audio/mp4', '录音最大 2M', '格式 mp3，大小 100MB'
  ])('parses an audio expression: %s', (text) => {
    const rules = resolve(text);
    expect(rules.mediaKind).toBe('audio');
  });

  it('parses maxBytes and duration without creating a crop/split rule', () => {
    const rules = resolve('仅支持 MP3，单文件最大 100 MB，时长不超过 2 小时');
    expect(rules).toMatchObject({
      mediaKind: 'audio',
      formats: ['audio/mpeg'],
      maxBytes: 100_000_000,
      duration: { maxMs: 7_200_000 }
    });
    expect(rules.width).toEqual({ exact: null, min: null, max: null });
    expect(rules.actionable).toBe(true);
  });

  it('keeps duration-only and semantic-stop pages non-actionable', () => {
    expect(resolve('音频时长不超过 2 小时')).toMatchObject({ mediaKind: 'audio', actionable: false });
    expect(resolve('仅支持 MP3')).toMatchObject({ mediaKind: 'audio', actionable: false });
    expect(resolve('请上传原始录音/无损 WAV')).toMatchObject({ actionable: false });
    expect(resolve('请使用官方音频审核工具')).toMatchObject({
      actionable: false,
      safetyFlags: ['OFFICIAL_TOOL_REQUIRED']
    });
  });

  it('does not turn mixed/video/PDF contexts into an audio rule', () => {
    expect(resolve('视频支持 mp3 仅用于示例')).toMatchObject({ mediaKind: null });
    expect(resolve('application/pdf 文件不超过 100MB')).toMatchObject({ mediaKind: null });
    expect(resolve('image/*,audio/*', { accept: 'image/*,audio/*' })).toMatchObject({ mediaKind: null });
  });

  it('surfaces a nearby MP3 prohibition as an unresolvable safety conflict', () => {
    const rules = resolve('不支持 MP3', { accept: 'audio/mpeg' });
    expect(rules.actionable).toBe(false);
    expect(rules.safetyFlags).toContain('AUDIO_OUTPUT_FORMAT_NOT_ALLOWED');
    expect(rules.conflicts.some((item) => item.unresolvable === true)).toBe(true);
  });
});
