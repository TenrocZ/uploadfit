import { MAX_DIMENSION, MAX_INPUT_BYTES } from '../config.js';
import { RULE_SOURCE_TYPES, getSourcePriority } from './schema.js';

function validNumber(value, maximum) {
  return value === null || value === undefined
    || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum);
}

function validateDimensionRule(rule, field) {
  if (!rule || typeof rule !== 'object') return [`${field}_INVALID`];
  const errors = [];
  for (const key of ['exact', 'min', 'max']) {
    if (!validNumber(rule[key], MAX_DIMENSION)) errors.push(`${field}_${key.toUpperCase()}_INVALID`);
  }
  if (rule.min !== null && rule.max !== null && rule.min > rule.max) {
    errors.push(`${field}_RANGE_REVERSED`);
  }
  return errors;
}

export function validateRuleCandidate(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== 'object') return { valid: false, errors: ['CANDIDATE_INVALID'] };
  if (!RULE_SOURCE_TYPES.includes(candidate.sourceType)) errors.push('SOURCE_TYPE_INVALID');
  if (!Object.prototype.hasOwnProperty.call(candidate, 'sourcePriority')) {
    errors.push('SOURCE_PRIORITY_MISSING');
  } else if (candidate.sourcePriority !== getSourcePriority(candidate.sourceType)) {
    errors.push('SOURCE_PRIORITY_INVALID');
  }
  if (!Array.isArray(candidate.evidence)) errors.push('EVIDENCE_INVALID');
  if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
    errors.push('CONFIDENCE_INVALID');
  }
  if (!candidate.rules || typeof candidate.rules !== 'object' || Array.isArray(candidate.rules)) {
    errors.push('RULES_INVALID');
  }
  const rules = candidate.rules ?? {};
  if (!validNumber(rules.minBytes, MAX_INPUT_BYTES)) errors.push('MIN_BYTES_INVALID');
  if (!validNumber(rules.maxBytes, MAX_INPUT_BYTES)) errors.push('MAX_BYTES_INVALID');
  if (rules.minBytes !== null && rules.maxBytes !== null && rules.minBytes > rules.maxBytes) {
    errors.push('BYTES_RANGE_REVERSED');
  }
  errors.push(...validateDimensionRule(rules.width ?? { exact: null, min: null, max: null }, 'WIDTH'));
  errors.push(...validateDimensionRule(rules.height ?? { exact: null, min: null, max: null }, 'HEIGHT'));
  if (rules.aspectRatio && (!Number.isFinite(rules.aspectRatio.value) || rules.aspectRatio.value <= 0)) {
    errors.push('ASPECT_RATIO_INVALID');
  }
  return { valid: errors.length === 0, errors };
}

export function validateRuleSet(ruleSet) {
  const errors = [];
  if (!ruleSet || typeof ruleSet !== 'object') return { valid: false, errors: ['RULE_SET_INVALID'] };
  if (!validNumber(ruleSet.minBytes, MAX_INPUT_BYTES)) errors.push('MIN_BYTES_INVALID');
  if (!validNumber(ruleSet.maxBytes, MAX_INPUT_BYTES)) errors.push('MAX_BYTES_INVALID');
  if (ruleSet.minBytes !== null && ruleSet.maxBytes !== null && ruleSet.minBytes > ruleSet.maxBytes) {
    errors.push('BYTES_RANGE_REVERSED');
  }
  errors.push(...validateDimensionRule(ruleSet.width, 'WIDTH'));
  errors.push(...validateDimensionRule(ruleSet.height, 'HEIGHT'));
  if (ruleSet.aspectRatio && (!Number.isFinite(ruleSet.aspectRatio.value) || ruleSet.aspectRatio.value <= 0)) {
    errors.push('ASPECT_RATIO_INVALID');
  }
  return { valid: errors.length === 0, errors };
}
