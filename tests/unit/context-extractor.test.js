import { describe, expect, it } from 'vitest';
import {
  extractRelevantContext,
  selectAiRelevantText
} from '../../src/dom/context-extractor.js';

describe('context extractor boundaries', () => {
  it('returns an empty safe bundle for an invalid input', () => {
    expect(extractRelevantContext(null)).toEqual({
      uploaderId: '',
      label: '',
      attributes: { accept: null, multiple: false, required: false },
      selectedText: null,
      nearbyTexts: [],
      alertTexts: [],
      normalizedText: '',
      truncated: false
    });
  });

  it('limits future AI text to relevant sentences only', () => {
    const text = selectAiRelevantText({
      normalizedText: '服务条款内容。PNG，最大100KB。版权信息。'
    });
    expect(text).toBe('PNG,最大100KB');
    expect(text.length).toBeLessThanOrEqual(2000);
  });
});
