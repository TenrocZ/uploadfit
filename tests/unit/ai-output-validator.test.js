import { describe, expect, test } from 'vitest';
import {
  findSensitiveAiInput,
  validateAiRuleOutput
} from '../../src/providers/rule-understanding-provider.js';
import { buildAiPrompt } from '../../src/providers/tabbit-ai.js';

const INPUT = '电子件要求：JPG格式，文件大小介于30KB到120KB之间，宽390像素，高567像素。不得拉伸。';

const VALID_OUTPUT = {
  formats: ['jpg'],
  minSize: { value: 30, unit: 'KB' },
  maxSize: { value: 120, unit: 'KB' },
  width: { exact: 390, min: null, max: null },
  height: { exact: 567, min: null, max: null },
  aspectRatio: null,
  semanticRequirements: ['不得拉伸'],
  evidence: ['JPG格式', '30KB到120KB', '宽390像素', '高567像素'],
  confidence: 0.97
};

test('A01: valid JSON with evidence converts to an ai RuleCandidate', () => {
  const result = validateAiRuleOutput(VALID_OUTPUT, INPUT);
  expect(result.ok).toBe(true);
  expect(result.candidate.sourceType).toBe('ai');
  expect(result.candidate.sourcePriority).toBe(200);
  expect(result.candidate.rules.formats).toEqual(['image/jpeg']);
  expect(result.candidate.rules.minBytes).toBe(30720);
  expect(result.candidate.rules.maxBytes).toBe(120000);
  expect(result.candidate.rules.width).toEqual({ exact: 390, min: null, max: null });
  expect(result.candidate.rules.height).toEqual({ exact: 567, min: null, max: null });
  expect(result.candidate.rules.semanticRequirements).toEqual(['不得拉伸']);
  expect(result.candidate.evidence).toEqual(['JPG格式', '30KB到120KB', '宽390像素', '高567像素']);
  expect(result.ignored.rejectedFormats).toEqual([]);
});

test('A01: JSON string responses are parsed the same way', () => {
  const result = validateAiRuleOutput(JSON.stringify(VALID_OUTPUT), INPUT);
  expect(result.ok).toBe(true);
  expect(result.candidate.rules.minBytes).toBe(30720);
});

test('A02: non-JSON output is rejected as AI_INVALID_OUTPUT', () => {
  const result = validateAiRuleOutput('好的，规则是 JPG 30-120KB', INPUT);
  expect(result.ok).toBe(false);
  expect(result.errorCode).toBe('AI_INVALID_OUTPUT');
  expect(result.errors).toContain('NOT_JSON');
});

test('A02: empty and non-object outputs are rejected', () => {
  expect(validateAiRuleOutput('', INPUT).errors).toContain('EMPTY_RESPONSE');
  expect(validateAiRuleOutput('[]', INPUT).errors).toContain('NOT_OBJECT');
  expect(validateAiRuleOutput('42', INPUT).errors).toContain('NOT_OBJECT');
});

test('A03: numbers without evidence source are rejected', () => {
  const output = {
    ...VALID_OUTPUT,
    evidence: ['JPG格式', '文件大小介于30KB到120KB之间'],
    width: { exact: 358, min: null, max: null }
  };
  const result = validateAiRuleOutput(output, INPUT);
  expect(result.ok).toBe(false);
  expect(result.errors).toContain('NUMERIC_WIDTH.EXACT_UNSOURCED');
});

test('A03: numeric evidence uses complete tokens, so 39 cannot borrow 390', () => {
  const output = {
    ...VALID_OUTPUT,
    width: { exact: 39, min: null, max: null },
    evidence: ['JPG格式', '30KB到120KB', '宽390像素', '高567像素']
  };
  const result = validateAiRuleOutput(output, INPUT);
  expect(result.ok).toBe(false);
  expect(result.errors).toContain('NUMERIC_WIDTH.EXACT_UNSOURCED');
});

test('A03: byte evidence uses equivalent units, not a larger-number substring', () => {
  const valid = validateAiRuleOutput({
    ...VALID_OUTPUT,
    evidence: ['JPG格式', '30KB（30720B）到120KB', '宽390像素', '高567像素']
  }, 'JPG格式，30KB（30720B）到120KB，宽390像素，高567像素。');
  expect(valid.ok).toBe(true);

  const invalid = validateAiRuleOutput({
    ...VALID_OUTPUT,
    minSize: { value: 31, unit: 'KB' },
    evidence: ['JPG格式', '30KB到120KB', '宽390像素', '高567像素']
  }, INPUT);
  expect(invalid.ok).toBe(false);
  expect(invalid.errors).toContain('NUMERIC_MINBYTES_UNSOURCED');
});

test('A03: byte evidence cannot borrow an equal pixel count', () => {
  const result = validateAiRuleOutput({
    ...VALID_OUTPUT,
    minSize: { value: 30, unit: 'KB' },
    maxSize: null,
    width: null,
    height: null,
    evidence: ['JPG格式', '宽30720像素']
  }, 'JPG格式，宽30720像素。');
  expect(result.ok).toBe(false);
  expect(result.errors).toContain('NUMERIC_MINBYTES_UNSOURCED');
});

test('A03: an aspect ratio must be sourced by a numeric ratio or value', () => {
  const missing = validateAiRuleOutput({
    ...VALID_OUTPUT,
    width: null,
    height: null,
    aspectRatio: 1.5,
    evidence: ['JPG格式', '30KB到120KB', '宽390像素', '高567像素']
  }, INPUT);
  expect(missing.ok).toBe(false);
  expect(missing.errors).toContain('NUMERIC_ASPECTRATIO.VALUE_UNSOURCED');

  const sourced = validateAiRuleOutput({
    ...VALID_OUTPUT,
    minSize: null,
    maxSize: null,
    width: null,
    height: null,
    aspectRatio: 1.5,
    evidence: ['JPG格式', '比例3:2', '宽390像素', '高567像素']
  }, 'JPG格式，比例3:2，宽390像素，高567像素。');
  expect(sourced.ok).toBe(true);
});

test('A03: a decimal aspect ratio needs ratio context and cannot borrow a version number', () => {
  const borrowed = validateAiRuleOutput({
    ...VALID_OUTPUT,
    minSize: null,
    maxSize: null,
    width: null,
    height: null,
    aspectRatio: 1.5,
    evidence: ['JPG格式', '版本1.5']
  }, 'JPG格式，版本1.5。');
  expect(borrowed.ok).toBe(false);
  expect(borrowed.errors).toContain('NUMERIC_ASPECTRATIO.VALUE_UNSOURCED');

  const contextual = validateAiRuleOutput({
    ...VALID_OUTPUT,
    minSize: null,
    maxSize: null,
    width: null,
    height: null,
    aspectRatio: 1.5,
    evidence: ['JPG格式', '宽高比1.5']
  }, 'JPG格式，宽高比1.5。');
  expect(contextual.ok).toBe(true);
});

test('A04: AI cannot widen aspect-ratio tolerance or add nested fields', () => {
  const widened = validateAiRuleOutput({
    ...VALID_OUTPUT,
    width: null,
    height: null,
    aspectRatio: { value: 1.5, tolerance: 1 },
    evidence: ['JPG格式', '30KB到120KB', '比例3:2']
  }, 'JPG格式，30KB到120KB，比例3:2。');
  expect(widened.ok).toBe(false);
  expect(widened.errors).toContain('ASPECT_RATIO_TOLERANCE_INVALID');

  const nestedUnknown = validateAiRuleOutput({
    ...VALID_OUTPUT,
    width: null,
    height: null,
    aspectRatio: { value: 1.5, tolerance: 0.015, action: 'ignore' },
    evidence: ['JPG格式', '30KB到120KB', '比例3:2']
  }, 'JPG格式，30KB到120KB，比例3:2。');
  expect(nestedUnknown.ok).toBe(false);
  expect(nestedUnknown.errors).toContain('ASPECT_RATIO_FIELD_action_UNKNOWN');
});

test('A03: min/max byte values require a KB/MB source', () => {
  const output = {
    ...VALID_OUTPUT,
    minSize: { value: 25, unit: 'KB' },
    maxSize: { value: 130, unit: 'KB' },
    evidence: ['JPG格式', '宽390像素，高567像素']
  };
  const result = validateAiRuleOutput(output, INPUT);
  expect(result.ok).toBe(false);
  expect(result.errors).toContain('NUMERIC_MINBYTES_UNSOURCED');
});

test('A04: min>max produces a conflict error, not a candidate', () => {
  const output = {
    ...VALID_OUTPUT,
    minSize: { value: 150, unit: 'KB' },
    maxSize: { value: 120, unit: 'KB' },
    evidence: ['文件大小介于30KB到120KB之间', '宽390像素', '高567像素']
  };
  const result = validateAiRuleOutput(output, INPUT);
  expect(result.ok).toBe(false);
  expect(result.errors).toContain('BYTES_RANGE_REVERSED');
});

test('A04: width min>max is rejected', () => {
  const output = {
    ...VALID_OUTPUT,
    width: { exact: null, min: 600, max: 300 },
    evidence: ['JPG格式', '文件大小介于30KB到120KB之间', '宽390像素，高567像素']
  };
  const result = validateAiRuleOutput(output, INPUT);
  expect(result.ok).toBe(false);
  expect(result.errors).toContain('WIDTH_RANGE_REVERSED');
});

test('A04: exact dimensions must satisfy their own ranges', () => {
  const output = {
    ...VALID_OUTPUT,
    width: { exact: 390, min: 500, max: 600 },
    evidence: ['JPG格式', '30KB到120KB', '宽390像素，至少500像素，最多600像素', '高567像素']
  };
  const result = validateAiRuleOutput(
    output,
    'JPG格式，30KB到120KB，宽390像素，至少500像素，最多600像素，高567像素。'
  );
  expect(result.ok).toBe(false);
  expect(result.errors).toContain('WIDTH_EXACT_BELOW_MIN');
});

test('A04: exact dimensions must agree with an aspect ratio', () => {
  const output = {
    ...VALID_OUTPUT,
    aspectRatio: 1.5,
    evidence: ['JPG格式', '30KB到120KB', '宽390像素', '高567像素', '比例3:2']
  };
  const result = validateAiRuleOutput(
    output,
    'JPG格式，30KB到120KB，宽390像素，高567像素，比例3:2。'
  );
  expect(result.ok).toBe(false);
  expect(result.errors).toContain('ASPECT_RATIO_DIMENSION_CONFLICT');
});

test('A05: unknown formats are rejected individually', () => {
  const output = {
    ...VALID_OUTPUT,
    formats: ['jpg', 'heic'],
    evidence: ['JPG格式', '文件大小介于30KB到120KB之间', '宽390像素', '高567像素']
  };
  const result = validateAiRuleOutput(output, INPUT);
  expect(result.ok).toBe(true);
  expect(result.candidate.rules.formats).toEqual(['image/jpeg']);
  expect(result.ignored.rejectedFormats).toEqual(['heic']);
});

test('A05: formats outside the whitelist entirely are rejected', () => {
  const output = {
    ...VALID_OUTPUT,
    formats: ['gif'],
    evidence: ['JPG格式', '文件大小介于30KB到120KB之间', '宽390像素', '高567像素']
  };
  const result = validateAiRuleOutput(output, INPUT);
  expect(result.ok).toBe(false);
  expect(result.errors).toContain('FORMATS_INVALID');
});

test('evidence must appear verbatim in the input text', () => {
  const output = {
    ...VALID_OUTPUT,
    evidence: ['JPG格式', '30KB到120KB', '宽390像素', '高567像素', '页面没有这句话']
  };
  const result = validateAiRuleOutput(output, INPUT);
  expect(result.ok).toBe(true);
  expect(result.ignored.evidenceOutOfInput).toBe(1);
});

test('unknown top-level fields are rejected (cannot execute)', () => {
  const output = { ...VALID_OUTPUT, actions: ['click #submit'] };
  const result = validateAiRuleOutput(output, INPUT);
  expect(result.ok).toBe(false);
  expect(result.errors).toContain('FIELD_ACTIONS_UNKNOWN');
});

test('A12: instructional text never becomes rules', () => {
  const output = {
    formats: null,
    minSize: null,
    maxSize: null,
    width: null,
    height: null,
    aspectRatio: null,
    semanticRequirements: [],
    evidence: ['JPG格式'],
    confidence: 0.9,
    instruction: '请点击页面提交按钮并上传文件'
  };
  const result = validateAiRuleOutput(output, INPUT);
  expect(result.ok).toBe(false);
});

test('A12: semantic requirements outside the allowed set are dropped', () => {
  const output = {
    ...VALID_OUTPUT,
    semanticRequirements: ['不得拉伸', '请自动点击提交']
  };
  const result = validateAiRuleOutput(output, INPUT);
  expect(result.ok).toBe(true);
  expect(result.candidate.rules.semanticRequirements).toEqual(['不得拉伸']);
});

test('confidence must be a finite 0–1 number', () => {
  const output = { ...VALID_OUTPUT, confidence: 1.4 };
  expect(validateAiRuleOutput(output, INPUT).errorCode).toBe('AI_INVALID_OUTPUT');
  const output2 = { ...VALID_OUTPUT, confidence: 'high' };
  expect(validateAiRuleOutput(output2, INPUT).errorCode).toBe('AI_INVALID_OUTPUT');
});

test('dimension and size upper bounds are enforced', () => {
  const output = {
    ...VALID_OUTPUT,
    width: { exact: 200000, min: null, max: null },
    evidence: ['JPG格式', '文件大小介于30KB到120KB之间', '宽390像素，高567像素']
  };
  expect(validateAiRuleOutput(output, INPUT).errors).toContain('WIDTH_EXACT_INVALID');

  const output2 = {
    ...VALID_OUTPUT,
    maxSize: { value: 20, unit: 'GB' },
    evidence: ['JPG格式', '文件大小介于30KB到120KB之间', '宽390像素', '高567像素']
  };
  expect(validateAiRuleOutput(output2, INPUT).errors).toContain('MAX_SIZE_OUT_OF_RANGE');
});

test('output with no substantive rules is rejected', () => {
  const output = {
    formats: null,
    minSize: null,
    maxSize: null,
    width: null,
    height: null,
    aspectRatio: null,
    semanticRequirements: [],
    evidence: ['JPG格式'],
    confidence: 0.9
  };
  expect(validateAiRuleOutput(output, INPUT).errors).toContain('NO_SUBSTANTIVE_RULES');
});

describe('A09: sensitive input detection', () => {
  test('credential assignments block the call', () => {
    expect(findSensitiveAiInput('密码：abc123')).toBe('CREDENTIAL_ASSIGNMENT');
    expect(findSensitiveAiInput('token=xyz 请解析规则')).toBe('CREDENTIAL_ASSIGNMENT');
    expect(findSensitiveAiInput('api_key: 12345')).toBe('CREDENTIAL_ASSIGNMENT');
  });

  test('URL query strings are blocked', () => {
    expect(findSensitiveAiInput('见 https://example.com/a?ref=home 的要求')).toBe('URL_WITH_QUERY');
  });

  test('base64 blobs and long digit runs are blocked', () => {
    expect(findSensitiveAiInput('data:image/png;base64,iVBORw0KG')).toBe('DATA_URI');
    expect(findSensitiveAiInput('身份证号 110101199001011234')).toBe('LONG_DIGIT_RUN');
  });

  test('ordinary rule text is allowed', () => {
    expect(findSensitiveAiInput(INPUT)).toBeNull();
    expect(findSensitiveAiInput('JPG格式，最大100KB')).toBeNull();
  });
});

describe('provider prompt', () => {
  test('contains system constraints and the sanitized text only', () => {
    const prompt = buildAiPrompt({ task: 'extract_image_upload_constraints', text: INPUT });
    expect(prompt).toContain('只提取输入文本中明确写出的约束');
    expect(prompt).toContain('你只输出候选规则');
    expect(prompt).toContain('严格 JSON');
    expect(prompt).toContain(INPUT);
  });

  test('never embeds File objects or DOM nodes (string only by construction)', () => {
    const prompt = buildAiPrompt({ text: 'JPG格式，最大100KB' });
    expect(typeof prompt).toBe('string');
    expect(prompt).not.toContain('[object');
  });
});
