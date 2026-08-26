import { describe, expect, it } from 'vitest';
import {
  classifyRejectionText,
  isExplicitRejection
} from '../../src/dom/rejection-classifier.js';

describe('S3 rejection classifier', () => {
  it('accepts only an explicit file rule with a structured candidate', () => {
    const result = classifyRejectionText('图片尺寸必须为390×567像素，请重新上传');
    expect(result.kind).toBe('explicit');
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(isExplicitRejection('仅支持 JPG、PNG 格式的图片')).toBe(true);
  });

  it('stops on system, permission, review and clarity semantics', () => {
    for (const text of [
      '系统繁忙，请稍后重试',
      '登录后才能上传图片',
      '图片审核不通过',
      '图片不清晰'
    ]) {
      expect(classifyRejectionText(text).kind).toBe('ambiguous');
    }
  });

  it('does not turn a generic failure into an executable file rule', () => {
    const result = classifyRejectionText('上传失败');
    expect(result.kind).toBe('ambiguous');
    expect(result.candidates).toEqual([]);
  });

  it('S4.1 R02 classifies an English byte-limit toast as an explicit rejection', () => {
    const result = classifyRejectionText('File exceeds 25 MB limit.');
    expect(result).toMatchObject({ kind: 'explicit', reason: 'STRUCTURED_FILE_RULE' });
    expect(result.candidates.some((candidate) => candidate.rules?.maxBytes === 25_000_000))
      .toBe(true);
  });

  it.each([
    'Uploaded successfully',
    'Upload complete',
    'Copied',
    'Saved',
    'Transcription complete',
    'Pro plan: 25 MB for $10'
  ])('S4.1 R04 ignores success and marketing notifications: %s', (text) => {
    expect(classifyRejectionText(text)).toMatchObject({ kind: 'irrelevant', candidates: [] });
  });
});
