import { ASPECT_RATIO_TOLERANCE } from '../config.js';
import { createEmptyRuleSet } from './schema.js';
import { validateRuleCandidate, validateRuleSet } from './validators.js';
import { sanitizeText } from '../utils/text.js';

function stableCandidateKey(candidate) {
  return [
    candidate.sourceType,
    candidate.sourcePriority,
    JSON.stringify(candidate.rules),
    candidate.evidence.join('|')
  ].join('|');
}

function sortCandidates(candidates) {
  return candidates
    .filter((candidate) => validateRuleCandidate(candidate).valid)
    .slice()
    .sort((left, right) => {
      if (right.sourcePriority !== left.sourcePriority) return right.sourcePriority - left.sourcePriority;
      return stableCandidateKey(left).localeCompare(stableCandidateKey(right));
    });
}

function collectInvalidCandidates(candidates) {
  return candidates
    .map((candidate) => ({ candidate, validation: validateRuleCandidate(candidate) }))
    .filter(({ validation }) => !validation.valid)
    .sort((left, right) => {
      const leftKey = [
        left.candidate?.sourceType ?? '',
        JSON.stringify(left.validation.errors),
        JSON.stringify(safeEvidence(left.candidate?.evidence)),
        JSON.stringify(left.candidate?.rules ?? {})
      ].join('|');
      const rightKey = [
        right.candidate?.sourceType ?? '',
        JSON.stringify(right.validation.errors),
        JSON.stringify(safeEvidence(right.candidate?.evidence)),
        JSON.stringify(right.candidate?.rules ?? {})
      ].join('|');
      return leftKey.localeCompare(rightKey);
    });
}

function safeEvidence(evidence) {
  return Array.isArray(evidence)
    ? evidence.map(sanitizeText).filter(Boolean).slice(0, 32)
    : [];
}

function valueKey(value) {
  if (value && typeof value === 'object') return JSON.stringify(value);
  return `${typeof value}:${String(value)}`;
}

function uniqueValues(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const key = valueKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function valuesEqual(left, right) {
  return valueKey(left) === valueKey(right);
}

function addConflict(conflicts, conflict) {
  conflicts.push({ ...conflict, values: conflict.values?.slice?.() ?? conflict.values });
}

function collectFieldEntries(candidates, field, getValue) {
  return candidates
    .filter((candidate) => !candidate.advisoryOnly)
    .map((candidate) => ({
      priority: candidate.sourcePriority,
      sourceType: candidate.sourceType,
      evidence: candidate.evidence,
      value: getValue(candidate.rules[field], candidate.rules)
    }))
    .filter((entry) => entry.value !== null && entry.value !== undefined);
}

function chooseScalar(entries, field, conflicts) {
  if (!entries.length) return null;
  const highestPriority = Math.max(...entries.map((entry) => entry.priority));
  const highest = entries.filter((entry) => entry.priority === highestPriority);
  const values = uniqueValues(highest.map((entry) => entry.value));
  if (values.length > 1) {
    addConflict(conflicts, {
      field,
      values,
      sourcePriority: highestPriority,
      reason: 'SAME_PRIORITY_CONFLICT',
      unresolvable: true
    });
    return null;
  }
  const chosen = values[0];
  const lowerValues = uniqueValues(entries
    .filter((entry) => entry.priority < highestPriority)
    .map((entry) => entry.value));
  if (lowerValues.some((value) => !valuesEqual(value, chosen))) {
    addConflict(conflicts, {
      field,
      values: [chosen, ...lowerValues],
      sourcePriority: highestPriority,
      reason: 'HIGHER_PRIORITY_WINS',
      unresolvable: false
    });
  }
  return chosen;
}

function chooseArray(entries, field, conflicts) {
  if (!entries.length) return [];
  const highestPriority = Math.max(...entries.map((entry) => entry.priority));
  const highest = entries.filter((entry) => entry.priority === highestPriority);
  const chosen = uniqueValues(highest.flatMap((entry) => entry.value ?? []));
  const lowerValues = uniqueValues(entries
    .filter((entry) => entry.priority < highestPriority)
    .flatMap((entry) => entry.value ?? []));
  if (lowerValues.some((value) => !chosen.includes(value))) {
    addConflict(conflicts, {
      field,
      values: [...chosen, ...lowerValues],
      sourcePriority: highestPriority,
      reason: 'HIGHER_PRIORITY_WINS',
      unresolvable: false
    });
  }
  return chosen.sort();
}

function chooseDimension(dimensions, field, conflicts) {
  const result = { exact: null, min: null, max: null };
  for (const bound of ['exact', 'min', 'max']) {
    const entries = dimensions
      .filter((candidate) => !candidate.advisoryOnly)
      .map((candidate) => ({
        priority: candidate.sourcePriority,
        value: candidate.rules[field]?.[bound]
      }))
      .filter((entry) => entry.value !== null && entry.value !== undefined);
    result[bound] = chooseScalar(entries, `${field}.${bound}`, conflicts);
  }

  if (result.exact !== null) {
    if ((result.min !== null && result.exact < result.min)
      || (result.max !== null && result.exact > result.max)) {
      addConflict(conflicts, {
        field,
        values: [result.exact, result.min, result.max],
        reason: 'EXACT_VIOLATES_RANGE',
        unresolvable: true
      });
    } else {
      result.min = null;
      result.max = null;
    }
  }
  return result;
}

function collectSources(candidates) {
  return candidates.map((candidate) => ({
    type: candidate.sourceType,
    priority: candidate.sourcePriority,
    evidence: candidate.evidence.slice(),
    confidence: candidate.confidence,
    advisoryOnly: Boolean(candidate.advisoryOnly)
  }));
}

function hasExecutableRules(ruleSet) {
  return ruleSet.formats.length > 0
    || ruleSet.minBytes !== null
    || ruleSet.maxBytes !== null
    || Object.values(ruleSet.width).some((value) => value !== null)
    || Object.values(ruleSet.height).some((value) => value !== null)
    || ruleSet.aspectRatio !== null
    || ruleSet.count.max !== null;
}

function mergeAdvisories(candidates) {
  return candidates
    .filter((candidate) => candidate.advisoryOnly)
    .map((candidate) => ({
      sourceType: candidate.sourceType,
      evidence: candidate.evidence.slice(),
      rules: candidate.rules
    }));
}

function addSafetyConflicts(ruleSet, candidates) {
  const safetyFlags = [...new Set(candidates.flatMap((candidate) => candidate.safetyFlags ?? []))].sort();
  ruleSet.safetyFlags = safetyFlags;
  if (safetyFlags.length) {
    ruleSet.conflicts.push({
      field: 'safety',
      values: safetyFlags,
      reason: 'STOP_SEMANTIC',
      unresolvable: true
    });
  }
}

function checkDerivedConflicts(ruleSet) {
  if (ruleSet.width.exact !== null && ruleSet.height.exact !== null && ruleSet.aspectRatio) {
    const actual = ruleSet.width.exact / ruleSet.height.exact;
    if (Math.abs(actual - ruleSet.aspectRatio.value) > (ruleSet.aspectRatio.tolerance ?? ASPECT_RATIO_TOLERANCE)) {
      ruleSet.conflicts.push({
        field: 'aspectRatio',
        values: [ruleSet.aspectRatio.value, actual],
        reason: 'EXACT_DIMENSION_MISMATCH',
        unresolvable: true
      });
    }
  }
}

/** Merge candidates by frozen source priority and expose conflicts explicitly. */
export function resolveRules(candidates = []) {
  const inputCandidates = Array.isArray(candidates) ? candidates : [];
  const invalidCandidates = collectInvalidCandidates(inputCandidates);
  const sorted = sortCandidates(inputCandidates);
  const ruleSet = createEmptyRuleSet();
  ruleSet.sources = collectSources(sorted);
  ruleSet.advisories = mergeAdvisories(sorted);

  for (const { candidate, validation } of invalidCandidates) {
    ruleSet.conflicts.push({
      field: 'candidate',
      values: validation.errors,
      reason: 'VALIDATION_FAILED',
      sourceType: candidate?.sourceType ?? null,
      evidence: safeEvidence(candidate?.evidence),
      unresolvable: true
    });
  }

  ruleSet.formats = chooseArray(
    collectFieldEntries(sorted, 'formats', (value) => value),
    'formats',
    ruleSet.conflicts
  );
  ruleSet.extensions = chooseArray(
    collectFieldEntries(sorted, 'extensions', (value) => value),
    'extensions',
    ruleSet.conflicts
  );
  ruleSet.minBytes = chooseScalar(
    collectFieldEntries(sorted, 'minBytes', (value) => value),
    'minBytes',
    ruleSet.conflicts
  );
  ruleSet.maxBytes = chooseScalar(
    collectFieldEntries(sorted, 'maxBytes', (value) => value),
    'maxBytes',
    ruleSet.conflicts
  );
  ruleSet.width = chooseDimension(sorted, 'width', ruleSet.conflicts);
  ruleSet.height = chooseDimension(sorted, 'height', ruleSet.conflicts);
  ruleSet.aspectRatio = chooseScalar(
    collectFieldEntries(sorted, 'aspectRatio', (value) => value),
    'aspectRatio',
    ruleSet.conflicts
  );
  ruleSet.dpi = chooseScalar(
    collectFieldEntries(sorted, 'dpi', (value) => value),
    'dpi',
    ruleSet.conflicts
  );
  ruleSet.count.max = chooseScalar(
    collectFieldEntries(sorted, 'count', (value) => value?.max),
    'count.max',
    ruleSet.conflicts
  );
  ruleSet.background = chooseScalar(
    collectFieldEntries(sorted, 'background', (value) => value),
    'background',
    ruleSet.conflicts
  );
  ruleSet.semanticRequirements = chooseArray(
    collectFieldEntries(sorted, 'semanticRequirements', (value) => value),
    'semanticRequirements',
    ruleSet.conflicts
  );

  const executableCandidates = sorted.filter((candidate) => !candidate.advisoryOnly);
  ruleSet.confidence = executableCandidates.length
    ? Math.min(...executableCandidates.map((candidate) => candidate.confidence))
    : 0;
  addSafetyConflicts(ruleSet, sorted);
  checkDerivedConflicts(ruleSet);

  const validation = validateRuleSet(ruleSet);
  if (!validation.valid) {
    ruleSet.conflicts.push({
      field: 'ruleSet',
      values: validation.errors,
      reason: 'VALIDATION_FAILED',
      unresolvable: true
    });
  }
  const hasUnresolvableConflict = ruleSet.conflicts.some((conflict) => conflict.unresolvable);
  ruleSet.actionable = hasExecutableRules(ruleSet)
    && !hasUnresolvableConflict
    && ruleSet.safetyFlags.length === 0;
  return ruleSet;
}
