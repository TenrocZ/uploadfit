import { describe, expect, it } from 'vitest';
import { parseRulesDeterministically } from '../../src/rules/deterministic-parser.js';
import { normalizeRuleText } from '../../src/rules/normalizer.js';
import { resolveRules } from '../../src/rules/resolver.js';

function resolve(text) {
  return resolveRules(parseRulesDeterministically({ normalizedText: text }));
}

const ZENT_V7_UPLOAD_URL = 'https://youzan.github.io/zent-v7/zh/component/upload';

describe('deterministic Chinese rule baseline R01-R30', () => {
  const cases = [
    ['R01 max bytes', '不超过100KB', (rules) => expect(rules.maxBytes).toBe(100000)],
    ['R02 min bytes', '大于30KB', (rules) => expect(rules.minBytes).toBe(30720)],
    ['R03 byte range', '30KB—120KB', (rules) => expect(rules).toMatchObject({ minBytes: 30720, maxBytes: 120000 })],
    ['R04 jpeg formats', '仅支持JPG/JPEG', (rules) => expect(rules.formats).toEqual(['image/jpeg'])],
    ['R05 multiple formats', '支持jpg、png格式', (rules) => expect(rules.formats).toEqual(['image/jpeg', 'image/png'])],
    ['R06 exact dimensions pair', '390×567像素', (rules) => expect(rules).toMatchObject({ width: { exact: 390 }, height: { exact: 567 } })],
    ['R07 exact dimensions axes', '宽390像素，高567像素', (rules) => expect(rules).toMatchObject({ width: { exact: 390 }, height: { exact: 567 } })],
    ['R08 minimum dimensions', '不低于295×413', (rules) => expect(rules).toMatchObject({ width: { min: 295 }, height: { min: 413 } })],
    ['R09 ratio', '比例3:4', (rules) => expect(rules.aspectRatio.value).toBeCloseTo(0.75)],
    ['R10 vague size', '图片不要太大', (rules) => expect(rules.actionable).toBe(false)],
    ['R11 upload failure', '上传失败', (rules) => expect(rules.actionable).toBe(false)],
    ['R12 busy max is blocked', '系统繁忙，图片最大100KB', (rules) => expect(rules).toMatchObject({ maxBytes: 100000, actionable: false })],
    ['R13 advisory max is not executable', '建议小于2MB', (rules) => expect(rules).toMatchObject({ maxBytes: null, actionable: false })],
    ['R14 forced max', '必须小于2MB', (rules) => expect(rules.maxBytes).toBe(2000000)],
    ['R15 fullwidth unit', '100ＫＢ（全角）', (rules) => expect(rules.actionable).toBe(false)],
    ['R16 one megabyte', '最多1M', (rules) => expect(rules.maxBytes).toBe(1000000)],
    ['R17 max dimensions', '宽度≤1920，高度≤1080', (rules) => expect(rules).toMatchObject({ width: { max: 1920 }, height: { max: 1080 } })],
    ['R18 dpi display only', '300dpi', (rules) => expect(rules).toMatchObject({ dpi: 300, actionable: false })],
    ['R19 semantic display', '蓝底免冠', (rules) => expect(rules).toMatchObject({ background: 'blue', actionable: false })],
    ['R20 official tool blocked', '必须用官方工具处理', (rules) => expect(rules).toMatchObject({ actionable: false, safetyFlags: ['OFFICIAL_TOOL_REQUIRED'] })],
    ['R21 jpeg and max', 'JPEG，大小不得高于1.5MB', (rules) => expect(rules).toMatchObject({ formats: ['image/jpeg'], maxBytes: 1500000 })],
    ['R22 min and max', '至少50KB，最多2MB', (rules) => expect(rules).toMatchObject({ minBytes: 51200, maxBytes: 2000000 })],
    ['R23 ratio four three', '宽高比4：3', (rules) => expect(rules.aspectRatio.value).toBeCloseTo(4 / 3)],
    ['R24 dimension ranges', '宽300至600，高400至800像素', (rules) => expect(rules).toMatchObject({ width: { min: 300, max: 600 }, height: { min: 400, max: 800 } })],
    ['R25 one png', '只可上传一张PNG图片', (rules) => expect(rules).toMatchObject({ formats: ['image/png'], count: { max: 1 } })],
    ['R26 jpeg webp max', 'JPG或WebP，≤500 KB', (rules) => expect(rules).toMatchObject({ formats: ['image/jpeg', 'image/webp'], maxBytes: 500000 })],
    ['R27 advisory format forced max', '建议JPG，必须小于1MB', (rules) => expect(rules).toMatchObject({ formats: [], maxBytes: 1000000, actionable: true })],
    ['R28 same priority conflict', '最大100KB；最大200KB', (rules) => expect(rules).toMatchObject({ maxBytes: null, actionable: false })],
    ['R29 min max dimensions', '不低于800×600且不超过1920×1080', (rules) => expect(rules).toMatchObject({ width: { min: 800, max: 1920 }, height: { min: 600, max: 1080 } })],
    ['R30 naming semantic', '文件名须含姓名和身份证号', (rules) => expect(rules).toMatchObject({ actionable: false })]
  ];

  for (const [name, text, assertion] of cases) {
    it(name, () => assertion(resolve(text)));
  }
});

it('normalizes the R15 fullwidth unit without inventing a comparator', () => {
  expect(normalizeRuleText('100ＫＢ（全角）')).toBe('100kb(全角)');
});

it('keeps evidence and source priority on parsed candidates', () => {
  const [candidate] = parseRulesDeterministically({
    attributes: { accept: 'image/png' },
    normalizedText: '必须小于2MB'
  });
  expect(candidate).toMatchObject({
    sourceType: 'html-attribute',
    sourcePriority: 500,
    evidence: ['accept: image/png']
  });
});

it('preserves a stop semantic even when it has no executable number', () => {
  const result = resolveRules(parseRulesDeterministically({ normalizedText: '网络超时，请稍后重试' }));
  expect(result.actionable).toBe(false);
  expect(result.safetyFlags).toEqual(['NETWORK_OR_TIMEOUT']);
  expect(result.conflicts).toContainEqual(expect.objectContaining({
    field: 'safety',
    reason: 'STOP_SEMANTIC'
  }));
});

it('does not mistake a network-image source option for a network failure', () => {
  const result = resolve('上传至分组：请选择 网络图片：本地图片：仅支持 gif、jpeg、png、bmp 4种格式，大小不超过1.0 MB');
  expect(result).toMatchObject({
    formats: ['image/jpeg', 'image/png'],
    maxBytes: 1000000,
    safetyFlags: [],
    actionable: true
  });
});

it(`keeps the copied upload rules actionable for ${ZENT_V7_UPLOAD_URL}`, () => {
  const result = resolve('上传至分组：请选择 网络图片：本地图片：仅支持 gif、jpeg、png、bmp 4种格式，大小不超过1.0 MB');
  expect(result).toMatchObject({
    formats: ['image/jpeg', 'image/png'],
    maxBytes: 1_000_000,
    safetyFlags: [],
    actionable: true
  });
});

it('rejects physical and display-context dimension pairs without losing pixel rules', () => {
  for (const text of [
    '证件照尺寸3.5x4.9厘米',
    '照片尺寸35x49毫米',
    '分辨率1920x1080下显示最佳'
  ]) {
    expect(resolve(text).width).toEqual({ exact: null, min: null, max: null });
    expect(resolve(text).height).toEqual({ exact: null, min: null, max: null });
  }
  expect(resolve('照片尺寸390x567像素')).toMatchObject({
    width: { exact: 390 },
    height: { exact: 567 }
  });
});

it('keeps format lists with an 等-format denial out of the allow list', () => {
  expect(resolve('支持jpg，gif、png等格式不支持').formats).toEqual(['image/jpeg']);
});

it('stops on review and connection-failure equivalents without matching 网络图片', () => {
  expect(resolve('审核未通过：图片模糊').safetyFlags).toEqual(['REVIEW_REJECTED']);
  expect(resolve('网络连接失败，请重试').safetyFlags).toEqual(['NETWORK_OR_TIMEOUT']);
  expect(resolve('网络图片：请选择').safetyFlags).toEqual([]);
});

it('does not infer a format from examples, filenames, paths, or URLs', () => {
  for (const text of [
    '示例文件名 avatar.jpg',
    '下载 /assets/avatar.jpg',
    'https://example.test/avatar.png'
  ]) {
    const result = resolve(text);
    expect(result.formats).toEqual([]);
    expect(result.actionable).toBe(false);
  }
});

it('Q-S1-027 keeps only explicitly allowed formats for prefix and suffix denials', () => {
  expect(resolve('不支持PNG，只支持JPG').formats).toEqual(['image/jpeg']);
  expect(resolve('不支持PNG但允许JPG').formats).toEqual(['image/jpeg']);
  expect(resolve('PNG不支持，只支持JPG').formats).toEqual(['image/jpeg']);
  expect(resolve('PNG格式不支持，请使用JPG').formats).toEqual(['image/jpeg']);
  expect(resolve('JPG允许，PNG禁用').formats).toEqual(['image/jpeg']);
  expect(resolve('禁止WebP').formats).toEqual([]);
  expect(resolve('WebP禁止使用').formats).toEqual([]);
  expect(resolve('禁止WebP').actionable).toBe(false);
});

it('Q-S1-028 keeps advisory semantics isolated between bounded source items', () => {
  const result = resolveRules(parseRulesDeterministically({
    nearbyTexts: ['建议JPG', '图片最大100KB']
  }));
  expect(result).toMatchObject({
    formats: [],
    maxBytes: 100000,
    actionable: true
  });
  expect(result.advisories).toContainEqual(expect.objectContaining({
    rules: expect.objectContaining({ formats: ['image/jpeg'] })
  }));
});

it('Q-S1-031 emits the complete canonical extension set for JPEG tokens', () => {
  expect(resolve('仅支持JPEG').extensions).toEqual(['jpeg', 'jpg']);
  expect(resolve('仅支持JPG').extensions).toEqual(['jpeg', 'jpg']);
});

it('supports star dimensions without confusing slash ratios', () => {
  const star = resolve('390*567像素');
  const multiplication = resolve('390×567像素');
  expect(star.width).toEqual(multiplication.width);
  expect(star.height).toEqual(multiplication.height);
  expect(resolve('宽高比3/4').aspectRatio.value).toBeCloseTo(0.75);
  expect(resolve('390/567像素').width).toEqual({ exact: null, min: null, max: null });
});

it('keeps safe original evidence while matching normalized text', () => {
  const [candidate] = parseRulesDeterministically({ normalizedText: '390×567像素' });
  expect(candidate.evidence).toEqual(['390×567像素']);
  expect(candidate.rules.width.exact).toBe(390);
  expect(candidate.rules.height.exact).toBe(567);
});

it('retains full-width source evidence while normalizing its numeric rule', () => {
  const [candidate] = parseRulesDeterministically({ normalizedText: '不超过100ＫＢ（全角）' });
  expect(candidate.evidence).toEqual(['不超过100ＫＢ（全角）']);
  expect(candidate.rules.maxBytes).toBe(100000);
});

it('sanitizes evidence before parsing and before retaining a candidate', () => {
  const candidates = parseRulesDeterministically({
    normalizedText: '支持JPG，token:secret，https://example.test/?key=secret'
  });
  expect(candidates.map((candidate) => candidate.evidence.join(' ')).join(' ')).not.toContain('secret');
});

it('applies one deterministic 6000-character parse budget across all text sources', () => {
  const context = {
    nearbyTexts: [`必须小于100KB。${'N'.repeat(20000)}`],
    alertTexts: [`必须小于200KB。${'A'.repeat(20000)}`],
    selectedText: `必须小于300KB。${'S'.repeat(20000)}`
  };
  const first = parseRulesDeterministically(context);
  const second = parseRulesDeterministically(context);
  const evidenceLength = first.reduce(
    (total, candidate) => total + candidate.evidence.join('').length,
    0
  );
  expect(evidenceLength).toBeLessThanOrEqual(6000);
  expect(second).toEqual(first);
  expect(first[0].sourceType).toBe('nearby-text');
  expect(first.some((candidate) => candidate.sourceType === 'rejection')).toBe(false);
});
