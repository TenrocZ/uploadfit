import { describe, expect, it } from 'vitest';
import {
  AI_TEXT_LIMIT,
  AUTO_RULE_CONFIDENCE,
  MAX_AUTO_RETRIES,
  MAX_INPUT_BYTES,
  TARGET_MAX_RATIO
} from '../../src/config.js';

describe('shared configuration baseline', () => {
  it('keeps the task-book safety and budget constants', () => {
    expect(AI_TEXT_LIMIT).toBe(2000);
    expect(AUTO_RULE_CONFIDENCE).toBe(0.90);
    expect(MAX_AUTO_RETRIES).toBe(1);
    expect(MAX_INPUT_BYTES).toBe(50 * 1024 * 1024);
    expect(TARGET_MAX_RATIO).toBe(0.90);
  });
});

