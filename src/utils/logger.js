const SAFE_SCALAR_FIELDS = new Set([
  'taskId',
  'mediaKind',
  'mime',
  'container',
  'codec',
  'sourceContainer',
  'sourceCodec',
  'targetContainer',
  'targetCodec',
  'bytes',
  'inputBytesRead',
  'outputBytes',
  'width',
  'height',
  'durationMs',
  'bitrateKbps',
  'sampleRate',
  'channels',
  'targetChannels',
  'targetSampleRate',
  'targetMaxBytes',
  'safeTargetBytes',
  'targetBitrateKbps',
  'ratio',
  'processedMs',
  'totalMs',
  'phase',
  'workerUsed',
  'encodePasses',
  'retryCount',
  'errorCode'
]);

const SAFE_EVENTS = new Set([
  'SESSION_STARTED',
  'CAPABILITY_DETECTED',
  'UPLOADER_DISCOVERED',
  'CONTEXT_EXTRACTED',
  'RULES_PARSED_LOCAL',
  'RULES_PARSED_AI',
  'RULE_CONFLICT',
  'FILE_SELECTED',
  'FILE_VALID',
  'FILE_INVALID',
  'REJECTION_DETECTED',
  'PROCESS_STARTED',
  'CONFIRMATION_REQUIRED',
  'PROCESS_COMPLETED',
  'INJECTION_COMPLETED',
  'RETRY_TRIGGERED',
  'TASK_SUCCEEDED',
  'TASK_STOPPED',
  'AUDIO_INSPECTION_STARTED',
  'AUDIO_INSPECTION_COMPLETED',
  'AUDIO_PLAN_CREATED',
  'AUDIO_CONFIRMATION_REQUIRED',
  'AUDIO_CONFIRMATION_ACCEPTED',
  'AUDIO_CONFIRMATION_DECLINED',
  'AUDIO_PROCESSING_STARTED',
  'AUDIO_PROCESSING_PROGRESS',
  'AUDIO_PROCESSING_COMPLETED',
  'AUDIO_PROCESSING_CANCELLED',
  'AUDIO_OUTPUT_VALIDATED',
  'AUDIO_INJECTION_SUCCEEDED',
  'AUDIO_INJECTION_FAILED',
  'AUDIO_RESOURCES_CLEANED',
  'SESSION_DISPOSED'
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

const SAFE_AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/aac'
]);

const SAFE_AUDIO_CONTAINERS = new Set(['mp3', 'wav', 'mp4', 'm4a', 'aac', 'pcm']);
const SAFE_AUDIO_CODECS = new Set(['mp3', 'pcm', 'aac-lc', 'aac', 'unknown']);
const SAFE_PROGRESS_PHASES = new Set([
  'inspect',
  'read',
  'decode',
  'encode',
  'finalize',
  'processing',
  'complete'
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
    return typeof value === 'string'
      && /^(?:task|session)-(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value)
      ? value
      : undefined;
  }
  if (key === 'mime') {
    return typeof value === 'string'
      && (/^image\/(?:jpeg|png|webp)$/.test(value) || SAFE_AUDIO_MIMES.has(value))
      ? value
      : undefined;
  }
  if (key === 'mediaKind') {
    return value === 'image' || value === 'audio' ? value : undefined;
  }
  if (key === 'container') {
    return typeof value === 'string' && SAFE_AUDIO_CONTAINERS.has(value.toLowerCase())
      ? value.toLowerCase()
      : undefined;
  }
  if (key === 'codec') {
    return typeof value === 'string' && SAFE_AUDIO_CODECS.has(value.toLowerCase())
      ? value.toLowerCase()
      : undefined;
  }
  if (['sourceContainer', 'targetContainer'].includes(key)) {
    return typeof value === 'string' && SAFE_AUDIO_CONTAINERS.has(value.toLowerCase())
      ? value.toLowerCase()
      : undefined;
  }
  if (['sourceCodec', 'targetCodec'].includes(key)) {
    return typeof value === 'string' && SAFE_AUDIO_CODECS.has(value.toLowerCase())
      ? value.toLowerCase()
      : undefined;
  }
  if (['bytes', 'inputBytesRead', 'outputBytes', 'width', 'height', 'durationMs', 'sampleRate',
    'processedMs', 'totalMs']
    .includes(key)) {
    return finiteNumber(value) ? value : undefined;
  }
  if (key === 'bitrateKbps') {
    return finiteNumber(value, 0, 10_000) ? value : undefined;
  }
  if (['targetBitrateKbps'].includes(key)) {
    return finiteNumber(value, 0, 10_000) ? value : undefined;
  }
  if (['targetMaxBytes', 'safeTargetBytes'].includes(key)) {
    return finiteNumber(value, 0, 10 * 1024 * 1024 * 1024) ? value : undefined;
  }
  if (['targetSampleRate'].includes(key)) {
    return finiteNumber(value, 0, 384_000) ? Math.round(value) : undefined;
  }
  if (['targetChannels'].includes(key)) {
    return finiteNumber(value, 1, 2) ? Math.round(value) : undefined;
  }
  if (key === 'channels') {
    return finiteNumber(value, 1, 2) ? Math.round(value) : undefined;
  }
  if (key === 'ratio') {
    return finiteNumber(value, 0, 1) ? value : undefined;
  }
  if (key === 'phase') {
    return typeof value === 'string' && SAFE_PROGRESS_PHASES.has(value) ? value : undefined;
  }
  if (key === 'workerUsed') {
    return typeof value === 'boolean' ? value : undefined;
  }
  if (['encodePasses', 'retryCount'].includes(key)) {
    return finiteNumber(value, 0, 100) ? Math.round(value) : undefined;
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
      if (!enabled || !SAFE_EVENTS.has(event)) return false;
      const entry = deepFreeze({
        time: Date.now(),
        event,
        ...sanitizeFields(fields)
      });
      entries.push(entry);
      sink(entry);
      return true;
    },
    getEntries() {
      return entries.slice();
    },
    clear() {
      entries.length = 0;
    }
  };
}
