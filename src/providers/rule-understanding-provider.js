import { AI_TEXT_LIMIT, ASPECT_RATIO_TOLERANCE } from '../config.js';
import { normalizeRuleText, normalizeFormats, toBytes } from '../rules/normalizer.js';
import { createRuleCandidate } from '../rules/schema.js';
import { ALLOWED_SEMANTICS, validateRuleCandidate } from '../rules/validators.js';

const ALLOWED_OUTPUT_FIELDS = new Set([
  'formats',
  'minSize',
  'maxSize',
  'width',
  'height',
  'aspectRatio',
  'semanticRequirements',
  'evidence',
  'confidence'
]);
const ALLOWED_DIMENSION_FIELDS = new Set(['exact', 'min', 'max']);
const ALLOWED_SIZE_FIELDS = new Set(['value', 'unit']);
const ALLOWED_ASPECT_RATIO_FIELDS = new Set(['value', 'tolerance']);
const AI_MAX_DIMENSION = 100000;
const AI_MAX_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_EVIDENCE_ITEMS = 32;
const MAX_EVIDENCE_CHARS = 6000;
const MAX_SEMANTIC_ITEMS = 32;

// AI 输入的敏感模式：命中即阻止调用平台 API（任务书 50-S4 §10.1/§10.2）。
const SENSITIVE_AI_INPUT_PATTERNS = [
  { name: 'CREDENTIAL_ASSIGNMENT', pattern: /(?:password|passwd|pwd|token|cookie|session|authorization|bearer|secret|api[_-]?key|captcha|密码|口令|密钥|验证码|校验码|短信码)\s*[:=：]/i },
  { name: 'URL_WITH_QUERY', pattern: /https?:\/\/[^\s]*\?/i },
  { name: 'DATA_URI', pattern: /data:[\w/+.-]+;base64/i },
  { name: 'LONG_DIGIT_RUN', pattern: /\d{15,}/ },
  { name: 'BASE64_BLOB', pattern: /(?:[A-Za-z0-9+/]{40,}={0,2}){2,}/ }
];

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function invalid(errors) {
  return { ok: false, errorCode: 'AI_INVALID_OUTPUT', errors: [...new Set(errors)] };
}

const NUMBER_TOKEN_PATTERN = /(?<![\d.])\d+(?:[.,]\d+)?(?![\d.])/g;
const BYTE_TOKEN_PATTERN = /(\d+(?:[.,]\d+)?)\s*(mb|m\b|kb|k\b|b)\b/gi;
const RATIO_TOKEN_PATTERN = /(\d+(?:[.,]\d+)?)\s*[:\/]\s*(\d+(?:[.,]\d+)?)/g;
const CONTEXTUAL_RATIO_PATTERN = /(?:宽高比|(?:图片|照片|图像)?比例|aspect\s*ratio)\s*(?:为|是|=|:|：)?\s*(\d+(?:[.,]\d+)?)/gi;

function normalizedNumber(value) {
  const number = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function numericTokens(value) {
  const normalized = normalizeRuleText(String(value ?? ''));
  return [...normalized.matchAll(NUMBER_TOKEN_PATTERN)]
    .map((match) => normalizedNumber(match[0]))
    .filter((number) => Number.isFinite(number));
}

function byteValue(number, unit, kind) {
  const value = normalizedNumber(number);
  const token = String(unit ?? 'B').toUpperCase();
  if (!Number.isFinite(value)) return null;
  const multiplier = token === 'MB' || token === 'M'
    ? (kind === 'min' ? 1024 ** 2 : 1000 ** 2)
    : token === 'KB' || token === 'K'
      ? (kind === 'min' ? 1024 : 1000)
      : 1;
  return Math.round(value * multiplier);
}

function byteValuesFromText(text, kind) {
  return [...normalizeRuleText(text).matchAll(BYTE_TOKEN_PATTERN)]
    .map((match) => byteValue(match[1], match[2], kind))
    .filter((value) => Number.isFinite(value));
}

function ratioValuesFromText(text) {
  const values = [];
  for (const match of normalizeRuleText(text).matchAll(RATIO_TOKEN_PATTERN)) {
    const numerator = normalizedNumber(match[1]);
    const denominator = normalizedNumber(match[2]);
    if (numerator > 0 && denominator > 0) values.push(numerator / denominator);
  }
  return values;
}

function contextualRatioValuesFromText(text) {
  return [...normalizeRuleText(text).matchAll(CONTEXTUAL_RATIO_PATTERN)]
    .map((match) => normalizedNumber(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function numberMatches(actual, source) {
  return Number.isFinite(actual)
    && Number.isFinite(source)
    && Math.abs(actual - source) <= Math.max(1e-9, Math.abs(actual) * 1e-9);
}

/**
 * Detect credential-like, URL-query, Base64 or identifier content that must never
 * reach the AI provider. Returns the first matched pattern name or null.
 */
export function findSensitiveAiInput(text) {
  const value = typeof text === 'string' ? text : '';
  for (const { name, pattern } of SENSITIVE_AI_INPUT_PATTERNS) {
    if (pattern.test(value)) return name;
  }
  return null;
}

export function containsSensitiveAiInput(text) {
  return findSensitiveAiInput(text) !== null;
}

function readSizeRule(value, field, kind, errors) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    errors.push(`${field}_INVALID`);
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_SIZE_FIELDS.has(key)) errors.push(`${field}_FIELD_${key}_UNKNOWN`);
  }
  const size = value.value;
  const unit = value.unit;
  if (!Number.isFinite(size) || size <= 0) {
    errors.push(`${field}_VALUE_INVALID`);
    return null;
  }
  const unitToken = String(unit ?? 'B').toUpperCase();
  if (!['B', 'K', 'KB', 'M', 'MB'].includes(unitToken)) {
    // GB/TB 等超上限单位直接拒绝（任务书：文件上限 ≤10GB）。
    errors.push(`${field}_OUT_OF_RANGE`);
    return null;
  }
  const bytes = toBytes(size, unit, kind);
  if (bytes === null || bytes > AI_MAX_BYTES) {
    errors.push(`${field}_OUT_OF_RANGE`);
    return null;
  }
  return bytes;
}

function readDimensionRule(value, field, errors) {
  if (value === undefined || value === null) return { exact: null, min: null, max: null };
  if (!isPlainObject(value)) {
    errors.push(`${field}_INVALID`);
    return null;
  }
  const result = { exact: null, min: null, max: null };
  for (const key of Object.keys(value)) {
    if (!ALLOWED_DIMENSION_FIELDS.has(key)) {
      errors.push(`${field}_FIELD_${key}_UNKNOWN`);
      continue;
    }
    const number = value[key];
    if (number === null || number === undefined) continue;
    if (!Number.isFinite(number) || number <= 0 || number > AI_MAX_DIMENSION) {
      errors.push(`${field}_${key.toUpperCase()}_INVALID`);
      continue;
    }
    result[key] = Math.round(number);
  }
  if (result.min !== null && result.max !== null && result.min > result.max) {
    errors.push(`${field}_RANGE_REVERSED`);
  }
  return result;
}

function readFormats(value, errors) {
  if (value === undefined || value === null) return { formats: null, extensions: null, rejected: [] };
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EVIDENCE_ITEMS) {
    errors.push('FORMATS_INVALID');
    return { formats: null, extensions: null, rejected: [] };
  }
  const rejected = [];
  const known = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      errors.push('FORMATS_VALUE_INVALID');
      continue;
    }
    if (normalizeFormats([item]).formats.length === 0) {
      rejected.push(item);
      continue;
    }
    known.push(item);
  }
  if (!known.length) {
    // 全部格式都在白名单之外：格式断言不可信，整条候选拒绝（A05）。
    errors.push('FORMATS_INVALID');
    return { formats: null, extensions: null, rejected };
  }
  const normalized = normalizeFormats(known);
  return { ...normalized, rejected };
}

function readAspectRatio(value, errors) {
  if (value === undefined || value === null) return null;
  if (Number.isFinite(value)) {
    if (value <= 0 || value > 100) {
      errors.push('ASPECT_RATIO_INVALID');
      return null;
    }
    return { value, tolerance: ASPECT_RATIO_TOLERANCE };
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (!ALLOWED_ASPECT_RATIO_FIELDS.has(key)) {
        errors.push(`ASPECT_RATIO_FIELD_${key}_UNKNOWN`);
      }
    }
    const { value: ratio, tolerance } = value;
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 100) {
      errors.push('ASPECT_RATIO_INVALID');
      return null;
    }
    const resolvedTolerance = tolerance === undefined || tolerance === null
      ? ASPECT_RATIO_TOLERANCE
      : tolerance;
    if (!Number.isFinite(resolvedTolerance)
      || resolvedTolerance <= 0
      || resolvedTolerance > ASPECT_RATIO_TOLERANCE) {
      errors.push('ASPECT_RATIO_TOLERANCE_INVALID');
      return null;
    }
    return { value: ratio, tolerance: resolvedTolerance };
  }
  errors.push('ASPECT_RATIO_INVALID');
  return null;
}

function readSemanticRequirements(value, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_SEMANTIC_ITEMS) {
    errors.push('SEMANTIC_REQUIREMENTS_INVALID');
    return [];
  }
  const accepted = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      errors.push('SEMANTIC_REQUIREMENTS_VALUE_INVALID');
      continue;
    }
    const text = item.trim();
    if (ALLOWED_SEMANTICS.includes(text)) accepted.push(text);
  }
  return [...new Set(accepted)];
}

function numericClaims(rules) {
  const claims = [];
  for (const field of ['width', 'height']) {
    for (const key of ['exact', 'min', 'max']) {
      const value = rules[field]?.[key];
      if (Number.isFinite(value)) {
        claims.push({ field: `${field}.${key}`, value, kind: 'dimension' });
      }
    }
  }
  for (const field of ['minBytes', 'maxBytes']) {
    if (Number.isFinite(rules[field])) claims.push({ field, value: rules[field] });
  }
  if (Number.isFinite(rules.aspectRatio?.value)) {
    claims.push({ field: 'aspectRatio.value', value: rules.aspectRatio.value, kind: 'ratio' });
  }
  return claims;
}

function byteClaimHasSource(value, evidenceTexts, field) {
  const kind = field === 'minBytes' ? 'min' : 'max';
  return evidenceTexts.some((text) => (
    byteValuesFromText(text, kind).some((candidate) => candidate === value)
  ));
}

const DIMENSION_PAIR_SOURCE_PATTERN = /(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)(?:\s*(?:像素|px))?/gi;

function dimensionValuesFromText(text, field) {
  const normalized = normalizeRuleText(text);
  const values = [];
  const axis = field === 'width' ? '(?:宽(?:度)?|width|w)' : '(?:高(?:度)?|height|h)';
  const axisPattern = new RegExp(`${axis}\\s*(?:(?:为|是|[:=]|不低于|至少|最低|不超过|最多|最高|>=|<=|≥|≤)\\s*)?(\\d+(?:[.,]\\d+)?)`, 'gi');
  for (const match of normalized.matchAll(axisPattern)) {
    const value = normalizedNumber(match[1]);
    if (Number.isFinite(value)) values.push(value);
  }
  for (const match of normalized.matchAll(DIMENSION_PAIR_SOURCE_PATTERN)) {
    const value = normalizedNumber(field === 'width' ? match[1] : match[2]);
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

function dimensionClaimHasSource(claim, evidenceTexts) {
  const field = claim.field.split('.')[0];
  return evidenceTexts.some((text) => dimensionValuesFromText(text, field)
    .some((candidate) => numberMatches(candidate, claim.value)));
}

function claimHasSource(claim, evidenceTexts) {
  if (claim.kind === 'ratio') {
    return evidenceTexts.some((text) => (
      ratioValuesFromText(text).some((candidate) => numberMatches(candidate, claim.value))
        || contextualRatioValuesFromText(text).some((candidate) => numberMatches(candidate, claim.value))
    ));
  }
  if (claim.kind === 'dimension') return dimensionClaimHasSource(claim, evidenceTexts);
  return evidenceTexts.some((text) => numericTokens(text).some((candidate) => (
    numberMatches(candidate, claim.value)
  )));
}

function validateInternalConsistency(rules, errors) {
  for (const field of ['width', 'height']) {
    const dimension = rules[field];
    if (!dimension) continue;
    if (Number.isFinite(dimension.exact) && Number.isFinite(dimension.min)
      && dimension.exact < dimension.min) {
      errors.push(`${field.toUpperCase()}_EXACT_BELOW_MIN`);
    }
    if (Number.isFinite(dimension.exact) && Number.isFinite(dimension.max)
      && dimension.exact > dimension.max) {
      errors.push(`${field.toUpperCase()}_EXACT_ABOVE_MAX`);
    }
  }
  if (rules.aspectRatio && Number.isFinite(rules.width?.exact)
    && Number.isFinite(rules.height?.exact)) {
    const actual = rules.width.exact / rules.height.exact;
    const tolerance = Number.isFinite(rules.aspectRatio.tolerance)
      ? rules.aspectRatio.tolerance
      : 0.015;
    if (Math.abs(actual - rules.aspectRatio.value) > tolerance) {
      errors.push('ASPECT_RATIO_DIMENSION_CONFLICT');
    }
  }
}

/**
 * Validate a raw Tabbit AI response against the S4 output schema and convert it
 * into a RuleCandidate. Unknown fields, unsourced numbers, min>max ranges and
 * formats outside the whitelist are rejected before any rule can execute.
 */
export function validateAiRuleOutput(rawOutput, inputText) {
  const text = typeof inputText === 'string' ? inputText : '';
  let parsed = rawOutput;
  if (typeof rawOutput === 'string') {
    const trimmed = rawOutput.trim();
    if (!trimmed) return invalid(['EMPTY_RESPONSE']);
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return invalid(['NOT_JSON']);
    }
  }
  if (!isPlainObject(parsed)) return invalid(['NOT_OBJECT']);

  const errors = [];
  for (const key of Object.keys(parsed)) {
    if (!ALLOWED_OUTPUT_FIELDS.has(key)) errors.push(`FIELD_${key.toUpperCase()}_UNKNOWN`);
  }
  if (errors.length) return invalid(errors);

  const evidenceRaw = parsed.evidence;
  if (!Array.isArray(evidenceRaw) || evidenceRaw.length === 0 || evidenceRaw.length > MAX_EVIDENCE_ITEMS) {
    return invalid(['EVIDENCE_INVALID']);
  }
  const normalizedInput = normalizeRuleText(text);
  const evidenceTexts = [];
  let evidenceOutOfInput = 0;
  for (const item of evidenceRaw) {
    if (typeof item !== 'string' || !item.trim() || item.length > MAX_EVIDENCE_CHARS) {
      errors.push('EVIDENCE_VALUE_INVALID');
      continue;
    }
    const normalizedEvidence = normalizeRuleText(item);
    if (!normalizedEvidence || !normalizedInput.includes(normalizedEvidence)) {
      // 不在输入中的证据整体丢弃（防幻觉）；全部不可信才拒绝候选。
      evidenceOutOfInput += 1;
      continue;
    }
    evidenceTexts.push(item.trim());
  }
  if (errors.length || evidenceTexts.length === 0) {
    return invalid(errors.length ? errors : ['EVIDENCE_NOT_IN_INPUT']);
  }

  const confidence = parsed.confidence;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return invalid(['CONFIDENCE_INVALID']);
  }

  const minBytes = readSizeRule(parsed.minSize, 'MIN_SIZE', 'min', errors);
  const maxBytes = readSizeRule(parsed.maxSize, 'MAX_SIZE', 'max', errors);
  if (minBytes !== null && maxBytes !== null && minBytes > maxBytes) {
    errors.push('BYTES_RANGE_REVERSED');
  }
  const width = readDimensionRule(parsed.width, 'WIDTH', errors);
  const height = readDimensionRule(parsed.height, 'HEIGHT', errors);
  const aspectRatio = readAspectRatio(parsed.aspectRatio, errors);
  const formats = readFormats(parsed.formats, errors);
  const semanticRequirements = readSemanticRequirements(parsed.semanticRequirements, errors);
  validateInternalConsistency({ width, height, aspectRatio, minBytes, maxBytes }, errors);
  if (errors.length) return invalid(errors);

  const rules = {
    width,
    height,
    aspectRatio,
    semanticRequirements
  };
  if (formats.formats?.length) {
    rules.formats = formats.formats;
    rules.extensions = formats.extensions;
  }
  if (minBytes !== null) rules.minBytes = minBytes;
  if (maxBytes !== null) rules.maxBytes = maxBytes;

  const hasSubstantiveRule = Boolean(
    rules.formats?.length
      || rules.minBytes !== undefined
      || rules.maxBytes !== undefined
      || Number.isFinite(rules.width?.exact) || Number.isFinite(rules.width?.min) || Number.isFinite(rules.width?.max)
      || Number.isFinite(rules.height?.exact) || Number.isFinite(rules.height?.min) || Number.isFinite(rules.height?.max)
      || rules.aspectRatio !== null
      || rules.semanticRequirements.length > 0
  );
  if (!hasSubstantiveRule) return invalid(['NO_SUBSTANTIVE_RULES']);

  // 每个精确数值都必须能在 evidence 中找到来源（任务书 50-S4 §10.4）。
  const sourced = [];
  for (const claim of numericClaims(rules)) {
    const hasSource = claim.field === 'minBytes' || claim.field === 'maxBytes'
      ? byteClaimHasSource(claim.value, evidenceTexts, claim.field)
      : claimHasSource(claim, evidenceTexts);
    if (!hasSource) {
      errors.push(`NUMERIC_${claim.field.toUpperCase()}_UNSOURCED`);
    } else {
      sourced.push(claim);
    }
  }
  if (errors.length) return invalid(errors);

  const candidate = createRuleCandidate({
    sourceType: 'ai',
    evidence: evidenceTexts,
    confidence,
    rules
  });
  const validation = validateRuleCandidate(candidate);
  if (!validation.valid) return invalid(validation.errors);
  return {
    ok: true,
    candidate,
    ignored: {
      rejectedFormats: formats.rejected,
      evidenceOutOfInput
    }
  };
}

/**
 * Base provider contract (共享契约 §8.1). Only implementations may touch a
 * platform API; the base class is deliberately inert.
 */
export class RuleUnderstandingProvider {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
  }

  async isAvailable() {
    return false;
  }

  async extractRules() {
    return { ok: false, errorCode: 'AI_UNAVAILABLE', reason: 'NO_PROVIDER' };
  }

  getCallCount() {
    return 0;
  }
}

export function truncateAiText(text) {
  // 仅做长度截断：脱敏会在敏感检测之前进行，句子级筛选由调用方的
  // selectAiRelevantText 完成；此处不得改变原文（敏感检测基于原文本）。
  return typeof text === 'string' ? text.trim().slice(0, AI_TEXT_LIMIT) : '';
}
