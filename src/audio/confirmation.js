/*
 * Confirmation identity is shared by the planner and metadata validator.
 * Keeping the canonical JSON and hash here prevents the two S2 surfaces from
 * minting ids that look valid to one another but are not bound to the same
 * proposal.
 */

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

/** JSON with object keys in a deterministic order for confirmation payloads. */
export function stableJson(value) {
  try {
    return JSON.stringify(stableValue(value));
  } catch {
    return '';
  }
}

function fnv1a32(value, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Two FNV-1a rounds keep the short id deterministic without a crypto
 * dependency.  The second round includes the first digest, so changing any
 * payload byte changes both halves of the fingerprint.
 */
export function confirmationFingerprint(value) {
  const json = typeof value === 'string' ? value : stableJson(value);
  const first = fnv1a32(json);
  const second = fnv1a32(`${first.toString(16)}:${json}`);
  return `${first.toString(36)}${second.toString(36)}`;
}

export function confirmationId(type, payload) {
  return `confirmation-${String(type ?? '').toLowerCase()}-${confirmationFingerprint(payload)}`;
}

