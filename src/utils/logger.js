const SAFE_SCALAR_FIELDS = new Set([
  'taskId',
  'mime',
  'bytes',
  'width',
  'height',
  'durationMs',
  'errorCode'
]);

const SAFE_FORMATS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const SAFE_SIZE_UNITS = new Set(['B', 'KB', 'MB']);
const SAFE_RULE_NUMBERS = new Set(['value', 'exact', 'min', 'max']);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function finiteNumber(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function sanitizeScalar(key, value) {
  if (key === 'errorCode') {
    if (value === null) return null;
    return typeof value === 'string' && /^[A-Z0-9_]{1,64}$/.test(value)
      ? value
      : undefined;
  }
  if (key === 'taskId') {
    return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
      ? value
      : undefined;
  }
  if (key === 'mime') {
    return typeof value === 'string' && /^image\/(?:jpeg|png|webp)$/.test(value)
      ? value
      : undefined;
  }
  if (['bytes', 'width', 'height', 'durationMs'].includes(key)) {
    return finiteNumber(value) ? value : undefined;
  }
  return SAFE_SCALAR_FIELDS.has(key) ? undefined : undefined;
}

function sanitizeRuleNumbers(value, maximum = 100_000) {
  if (!isRecord(value)) return undefined;
  const result = {};
  for (const key of SAFE_RULE_NUMBERS) {
    if (finiteNumber(value[key], 0, maximum)) result[key] = value[key];
  }
  return Object.keys(result).length ? result : undefined;
}

function sanitizeSizeRule(value) {
  if (!isRecord(value)) return undefined;
  const result = {};
  if (finiteNumber(value.value, 0, 10 * 1024 * 1024 * 1024)) {
    result.value = value.value;
  }
  if (SAFE_SIZE_UNITS.has(value.unit)) result.unit = value.unit;
  return Object.keys(result).length ? result : undefined;
}

function sanitizeRules(rules) {
  if (!isRecord(rules)) return undefined;
  const result = {};

  if (Array.isArray(rules.formats)) {
    const formats = rules.formats
      .filter((format) => typeof format === 'string' && SAFE_FORMATS.has(format.toLowerCase()))
      .map((format) => format.toLowerCase())
      .slice(0, 8);
    if (formats.length) result.formats = [...new Set(formats)];
  }

  for (const key of ['minSize', 'maxSize']) {
    const safeRule = sanitizeSizeRule(rules[key]);
    if (safeRule) result[key] = safeRule;
  }

  for (const key of ['width', 'height']) {
    const safeRule = sanitizeRuleNumbers(rules[key]);
    if (safeRule) result[key] = safeRule;
  }

  if (finiteNumber(rules.aspectRatio, 0, 1000)) result.aspectRatio = rules.aspectRatio;
  if (finiteNumber(rules.confidence, 0, 1)) result.confidence = rules.confidence;

  return Object.keys(result).length ? result : undefined;
}

function sanitizeFields(fields) {
  const safeFields = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (key === 'rules') {
      const safeRules = sanitizeRules(value);
      if (safeRules) safeFields.rules = safeRules;
      continue;
    }
    if (!SAFE_SCALAR_FIELDS.has(key)) continue;
    const safeValue = sanitizeScalar(key, value);
    if (safeValue !== undefined) safeFields[key] = safeValue;
  }
  return safeFields;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

export function createLogger({ enabled = false, sink = () => {} } = {}) {
  const entries = [];

  return {
    emit(event, fields = {}) {
      if (!enabled) return;
      const entry = deepFreeze({
        time: Date.now(),
        event,
        ...sanitizeFields(fields)
      });
      entries.push(entry);
      sink(entry);
    },
    getEntries() {
      return entries.slice();
    },
    clear() {
      entries.length = 0;
    }
  };
}
