import { describe, expect, it } from 'vitest';
import {
  isRuleRelevantText,
  joinWithinLimit,
  sanitizeText,
  selectRelevantText
} from '../../src/utils/text.js';

describe('safe text utilities', () => {
  it('normalizes and removes URLs and sensitive values', () => {
    const value = sanitizeText('  100ＫＢ； token: abc123；https://example.test?a=secret  ');
    expect(value).toBe('100KB; [REDACTED];');
    expect(value).not.toContain('abc123');
    expect(value).not.toContain('https://');
  });

  it('keeps stable order and marks bounded text as truncated', () => {
    expect(joinWithinLimit(['JPG', 'JPG', 'PNG', '123456'], 10)).toEqual({
      text: 'JPG\nPNG\n12',
      truncated: true
    });
  });

  it('selects only rule-relevant sentences', () => {
    const value = selectRelevantText('欢迎来到页面。JPG格式，最大100KB。请阅读服务条款。', 2000);
    expect(value).toBe('JPG格式,最大100KB');
    expect(isRuleRelevantText('服务条款')).toBe(false);
    expect(isRuleRelevantText('PNG 300×400')).toBe(true);
  });
});
