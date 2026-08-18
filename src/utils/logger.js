const SAFE_FIELDS = new Set([
  'time',
  'event',
  'taskId',
  'mime',
  'bytes',
  'width',
  'height',
  'durationMs',
  'errorCode',
  'rules'
]);

function sanitizeFields(fields) {
  const safeFields = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (SAFE_FIELDS.has(key)) safeFields[key] = value;
  }
  return safeFields;
}

export function createLogger({ enabled = false, sink = () => {} } = {}) {
  const entries = [];

  return {
    emit(event, fields = {}) {
      if (!enabled) return;
      const entry = Object.freeze({
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

