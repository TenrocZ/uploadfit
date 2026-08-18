export function createRandomId(prefix = 'id') {
  const cryptoObject = globalThis.crypto;
  if (typeof cryptoObject?.randomUUID === 'function') {
    return `${prefix}-${cryptoObject.randomUUID()}`;
  }

  if (typeof cryptoObject?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoObject.getRandomValues(bytes);
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${prefix}-${value}`;
  }

  throw new Error('CRYPTO_UNAVAILABLE');
}

