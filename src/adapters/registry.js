import { genericAdapter } from './generic.js';

const REQUIRED_METHODS = [
  'matches',
  'discoverUploaders',
  'extractContext',
  'findErrorNodes',
  'isAutoUpload',
  'beforeInjection',
  'afterInjection'
];

function isAdapter(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof value.id === 'string'
    && REQUIRED_METHODS.every((method) => typeof value[method] === 'function')
  );
}

function safeMatches(adapter, url) {
  try {
    return Boolean(adapter.matches(url));
  } catch {
    return false;
  }
}

export function createAdapterRegistry({ adapters = [] } = {}) {
  const registered = [];
  const add = (adapter) => {
    if (!isAdapter(adapter) || registered.some((item) => item.id === adapter.id)) {
      return false;
    }
    registered.push(adapter);
    return true;
  };

  for (const adapter of adapters) add(adapter);
  add(genericAdapter);

  return {
    register(adapter) {
      return add(adapter);
    },

    unregister(id) {
      const index = registered.findIndex((adapter) => adapter.id === id);
      if (index < 0 || registered[index] === genericAdapter) return false;
      registered.splice(index, 1);
      return true;
    },

    resolve(url = '') {
      return registered.find((adapter) => adapter !== genericAdapter && safeMatches(adapter, url))
        ?? genericAdapter;
    },

    list() {
      return registered.slice();
    }
  };
}

export function resolveAdapter(registry, url = '') {
  return registry?.resolve?.(url) ?? genericAdapter;
}

export { genericAdapter, isAdapter };

