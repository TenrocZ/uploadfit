const guardRecords = new WeakMap();

function canUseAsKey(input) {
  return (typeof input === 'object' && input !== null) || typeof input === 'function';
}

export function armInjectionGuard(input, eventType = 'change') {
  if (!canUseAsKey(input)) throw new TypeError('Injection guard requires an object key');
  const record = { token: Symbol('uploadfit-injection'), eventType };
  guardRecords.set(input, record);
  return record.token;
}

export function consumeInjectionGuard(input, event) {
  if (!canUseAsKey(input)) return false;
  const record = guardRecords.get(input);
  if (!record?.token || event?.target !== input || event?.type !== record.eventType) return false;
  record.token = null;
  return true;
}

export function clearInjectionGuard(input) {
  if (canUseAsKey(input)) guardRecords.delete(input);
}

export function hasPendingInjectionGuard(input) {
  return canUseAsKey(input) && Boolean(guardRecords.get(input)?.token);
}
