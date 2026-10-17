import { bootstrap, cleanupSession } from './bootstrap.js';
import { createTabbitAiProvider } from './providers/tabbit-ai.js';
import { startBrowserRuntime } from './browser-runtime.js';

const BUILD_INFO = Object.freeze({
  version: __UPLOADFIT_VERSION__,
  mode: __UPLOADFIT_MODE__
});

if (typeof globalThis !== 'undefined') {
  Object.defineProperty(globalThis, '__uploadfit_build_info__', {
    configurable: true,
    enumerable: false,
    value: BUILD_INFO,
    writable: false
  });
}

if (typeof document !== 'undefined') {
  startBrowserRuntime({ createRuleProvider: () => createTabbitAiProvider() });
}

export { BUILD_INFO, bootstrap, cleanupSession };
