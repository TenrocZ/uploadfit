import { MAX_DIMENSION, MAX_INPUT_BYTES } from '../config.js';
import { RULE_SOURCE_TYPES, getSourcePriority } from './schema.js';

export const ALLOWED_FORMATS = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

export const ALLOWED_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'webp']);
export const ALLOWED_BACKGROUNDS = Object.freeze(['blue', 'white', 'red', 'green', 'black', 'transparent']);
export const ALLOWED_SEMANTICS = Object.freeze([
  '蓝色背景',
  '免冠',
  '近期照片',
  '清晰',
  '不得拉伸',
  '文件名需包含姓名和身份证号',
  '必须使用官方工具'
]);
export const ALLOWED_SAFETY_FLAGS = Object.freeze([
  'SYSTEM_BUSY',
  'NETWORK_OR_TIMEOUT',
  'PERMISSION_OR_LOGIN',
  'REVIEW_REJECTED',
  'OFFICIAL_TOOL_REQUIRED'
]);

const MAX_DPI = 2400;
const MAX_ASPECT_RATIO = 100;
const MAX_ASPECT_RATIO_TOLERANCE = 1;
const MAX_FILE_COUNT = 100;
const MAX_ARRAY_ITEMS = 32;
const MAX_EVIDENCE_CHARS = 6000;
const ALLOWED_RULE_FIELDS = new Set([
  'formats',
  'extensions',
  'minBytes',
  'maxBytes',
  'width',
  'height',
  'aspectRatio',
  'dpi',
  'count',
  'background',
  'semanticRequirements'
]);
const ALLOWED_CANDIDATE_FIELDS = new Set([
  'sourceType',
  'sourcePriority',
  'evidence',
  'confidence',
  'rules',
  'advisoryOnly',
  'safetyFlags'
]);
const ALLOWED_RULE_SET_FIELDS = new Set([
  ...ALLOWED_RULE_FIELDS,
  'confidence',
  'sources',
  'conflicts',
  'advisories',
  'safetyFlags',
  'actionable'
]);
const FORMAT_EXTENSIONS = Object.freeze({
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp']
});
const DIMENSION_FIELDS = new Set(['exact', 'min', 'max']);
const ASPECT_RATIO_FIELDS = new Set(['value', 'tolerance']);
const COUNT_FIELDS = new Set(['max']);
const UNSAFE_EVIDENCE_PATTERN = /https?:\/\/|(?:password|passwd|pwd|密码|口令|token|cookie|session|authorization|bearer|secret|api[_-]?key|captcha|验证码|校验码|短信码|密钥)\s*[:=：]/i;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function optionalNumber(value, maximum) {
  return value === undefined || value === null
    || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum);
}

function optionalPositiveInteger(value, maximum) {
  return value === undefined || value === null
    || (Number.isInteger(value) && value > 0 && value <= maximum);
}

function validateDimensionRule(rule, field, required = false) {
  if (rule === undefined && !required) return [];
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return [`${field}_INVALID`];
  const errors = [];
  for (const key of Object.keys(rule)) {
    if (!DIMENSION_FIELDS.has(key)) errors.push(`${field}_FIELD_${key}_UNKNOWN`);
  }
  for (const key of ['exact', 'min', 'max']) {
    if (hasOwn(rule, key) && !optionalNumber(rule[key], MAX_DIMENSION)) {
      errors.push(`${field}_${key.toUpperCase()}_INVALID`);
    }
  }
  if (rule.min !== undefined && rule.min !== null
    && rule.max !== undefined && rule.max !== null
    && rule.min > rule.max) {
    errors.push(`${field}_RANGE_REVERSED`);
  }
  return errors;
}

function validateStringArray(value, field, allowedValues, { required = false } = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) return [`${field}_INVALID`];
  const errors = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !item || item.length > 128 || !allowedValues.includes(item)) {
      errors.push(`${field}_VALUE_INVALID`);
      continue;
    }
    if (seen.has(item)) errors.push(`${field}_DUPLICATE`);
    seen.add(item);
  }
  return errors;
}

function validateFormatsAndExtensions(rules, errors) {
  const formats = rules.formats;
  const extensions = rules.extensions;
  errors.push(...validateStringArray(formats, 'FORMATS', ALLOWED_FORMATS));
  errors.push(...validateStringArray(extensions, 'EXTENSIONS', ALLOWED_EXTENSIONS));
  if (hasOwn(rules, 'formats') !== hasOwn(rules, 'extensions')) {
    errors.push('FORMATS_EXTENSIONS_PAIR_REQUIRED');
  }
  if (!Array.isArray(formats) || !Array.isArray(extensions)) return;
  const expectedExtensions = new Set(formats.flatMap((format) => FORMAT_EXTENSIONS[format] ?? []));
  const actualExtensions = new Set(extensions);
  if (actualExtensions.size !== expectedExtensions.size
    || [...actualExtensions].some((extension) => !expectedExtensions.has(extension))) {
    errors.push('FORMATS_EXTENSIONS_INCONSISTENT');
  }
}

function validateRulesObject(rules, { required = false } = {}) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return ['RULES_INVALID'];
  const errors = [];
  if (required) {
    for (const field of ALLOWED_RULE_FIELDS) {
      if (!hasOwn(rules, field)) errors.push(`RULE_${field.toUpperCase()}_MISSING`);
    }
  }
  for (const key of Object.keys(rules)) {
    if (!ALLOWED_RULE_FIELDS.has(key)) errors.push(`RULE_FIELD_${key}_UNKNOWN`);
  }
  validateFormatsAndExtensions(rules, errors);

  for (const key of ['minBytes', 'maxBytes']) {
    if (hasOwn(rules, key) && !optionalNumber(rules[key], MAX_INPUT_BYTES)) {
      errors.push(`${key.toUpperCase()}_INVALID`);
    }
  }
  if (rules.minBytes !== undefined && rules.minBytes !== null
    && rules.maxBytes !== undefined && rules.maxBytes !== null
    && rules.minBytes > rules.maxBytes) {
    errors.push('BYTES_RANGE_REVERSED');
  }

  errors.push(...validateDimensionRule(rules.width, 'WIDTH'));
  errors.push(...validateDimensionRule(rules.height, 'HEIGHT'));

  if (rules.aspectRatio !== undefined && rules.aspectRatio !== null) {
    if (!rules.aspectRatio || typeof rules.aspectRatio !== 'object' || Array.isArray(rules.aspectRatio)) {
      errors.push('ASPECT_RATIO_INVALID');
    } else {
      for (const key of Object.keys(rules.aspectRatio)) {
        if (!ASPECT_RATIO_FIELDS.has(key)) errors.push(`ASPECT_RATIO_FIELD_${key}_UNKNOWN`);
      }
      const { value, tolerance } = rules.aspectRatio;
      if (!hasOwn(rules.aspectRatio, 'value')) errors.push('ASPECT_RATIO_VALUE_MISSING');
      if (!hasOwn(rules.aspectRatio, 'tolerance')) errors.push('ASPECT_RATIO_TOLERANCE_MISSING');
      if (!optionalNumber(value, MAX_ASPECT_RATIO)) errors.push('ASPECT_RATIO_VALUE_INVALID');
      if (!optionalNumber(tolerance, MAX_ASPECT_RATIO_TOLERANCE)) errors.push('ASPECT_RATIO_TOLERANCE_INVALID');
    }
  }

  if (rules.dpi !== undefined && rules.dpi !== null && !optionalNumber(rules.dpi, MAX_DPI)) {
    errors.push('DPI_INVALID');
  }

  if (rules.count !== undefined && rules.count !== null) {
    if (!rules.count || typeof rules.count !== 'object' || Array.isArray(rules.count)) {
      errors.push('COUNT_INVALID');
    } else {
      for (const key of Object.keys(rules.count)) {
        if (!COUNT_FIELDS.has(key)) errors.push(`COUNT_FIELD_${key}_UNKNOWN`);
      }
      if (!hasOwn(rules.count, 'max')) errors.push('COUNT_MAX_MISSING');
      if (hasOwn(rules.count, 'max') && !optionalPositiveInteger(rules.count.max, MAX_FILE_COUNT)) {
        errors.push('COUNT_MAX_INVALID');
      }
    }
  }

  if (rules.background !== undefined && rules.background !== null
    && (typeof rules.background !== 'string' || !ALLOWED_BACKGROUNDS.includes(rules.background))) {
    errors.push('BACKGROUND_INVALID');
  }
  errors.push(...validateStringArray(
    rules.semanticRequirements,
    'SEMANTIC_REQUIREMENTS',
    ALLOWED_SEMANTICS
  ));
  return errors;
}

function validateEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0 || evidence.length > MAX_ARRAY_ITEMS) {
    return ['EVIDENCE_INVALID'];
  }
  const errors = [];
  let totalLength = 0;
  for (const item of evidence) {
    if (typeof item !== 'string' || !item.trim() || item.length > MAX_EVIDENCE_CHARS) {
      errors.push('EVIDENCE_VALUE_INVALID');
      continue;
    }
    if (UNSAFE_EVIDENCE_PATTERN.test(item)) errors.push('EVIDENCE_SENSITIVE');
    totalLength += item.length;
  }
  if (totalLength > MAX_EVIDENCE_CHARS) errors.push('EVIDENCE_TOO_LONG');
  return errors;
}

function validateSafetyFlags(flags, field = 'SAFETY_FLAGS') {
  return validateStringArray(flags, field, ALLOWED_SAFETY_FLAGS);
}

export function validateRuleCandidate(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, errors: ['CANDIDATE_INVALID'] };
  }
  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_CANDIDATE_FIELDS.has(key)) errors.push(`CANDIDATE_FIELD_${key}_UNKNOWN`);
  }
  if (!RULE_SOURCE_TYPES.includes(candidate.sourceType)) errors.push('SOURCE_TYPE_INVALID');
  if (!hasOwn(candidate, 'sourcePriority')) {
    errors.push('SOURCE_PRIORITY_MISSING');
  } else if (candidate.sourcePriority !== getSourcePriority(candidate.sourceType)) {
    errors.push('SOURCE_PRIORITY_INVALID');
  }
  errors.push(...validateEvidence(candidate.evidence));
  if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
    errors.push('CONFIDENCE_INVALID');
  }
  errors.push(...validateRulesObject(candidate.rules));
  if (candidate.advisoryOnly !== undefined && typeof candidate.advisoryOnly !== 'boolean') {
    errors.push('ADVISORY_ONLY_INVALID');
  }
  if (candidate.safetyFlags !== undefined) errors.push(...validateSafetyFlags(candidate.safetyFlags));
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function validateSources(sources) {
  if (!Array.isArray(sources)) return ['SOURCES_INVALID'];
  const errors = [];
  for (const source of sources) {
    if (!source || typeof source !== 'object'
      || !RULE_SOURCE_TYPES.includes(source.type)
      || source.priority !== getSourcePriority(source.type)
      || !Array.isArray(source.evidence)) {
      errors.push('SOURCE_VALUE_INVALID');
    }
  }
  return errors;
}

function validateConflicts(conflicts) {
  if (!Array.isArray(conflicts)) return ['CONFLICTS_INVALID'];
  return conflicts.every((conflict) => conflict && typeof conflict === 'object')
    ? []
    : ['CONFLICT_VALUE_INVALID'];
}

export function validateRuleSet(ruleSet) {
  const errors = [];
  if (!ruleSet || typeof ruleSet !== 'object' || Array.isArray(ruleSet)) {
    return { valid: false, errors: ['RULE_SET_INVALID'] };
  }
  for (const key of Object.keys(ruleSet)) {
    if (!ALLOWED_RULE_SET_FIELDS.has(key)) errors.push(`RULE_SET_FIELD_${key}_UNKNOWN`);
  }
  for (const field of ['confidence', 'sources', 'conflicts', 'advisories', 'safetyFlags', 'actionable']) {
    if (!hasOwn(ruleSet, field)) errors.push(`RULE_SET_${field.toUpperCase()}_MISSING`);
  }
  const ruleFields = {};
  for (const field of ALLOWED_RULE_FIELDS) {
    if (hasOwn(ruleSet, field)) ruleFields[field] = ruleSet[field];
  }
  errors.push(...validateRulesObject(ruleFields, { required: true }));
  if (!Number.isFinite(ruleSet.confidence) || ruleSet.confidence < 0 || ruleSet.confidence > 1) {
    errors.push('CONFIDENCE_INVALID');
  }
  errors.push(...validateSources(ruleSet.sources));
  errors.push(...validateConflicts(ruleSet.conflicts));
  if (!Array.isArray(ruleSet.advisories)) errors.push('ADVISORIES_INVALID');
  errors.push(...validateSafetyFlags(ruleSet.safetyFlags));
  if (typeof ruleSet.actionable !== 'boolean') errors.push('ACTIONABLE_INVALID');
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
