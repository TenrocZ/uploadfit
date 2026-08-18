import { describe, expect, it } from 'vitest';
import { parseRulesDeterministically } from '../../src/rules/deterministic-parser.js';
import { normalizeRuleText } from '../../src/rules/normalizer.js';
import { resolveRules } from '../../src/rules/resolver.js';

function resolve(text) {
  return resolveRules(parseRulesDeterministically({ normalizedText: text }));
}

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
