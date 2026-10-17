import { startBrowserRuntime } from './browser-runtime.js';

const BUILD_INFO = Object.freeze({
  version: __UPLOADFIT_VERSION__,
  mode: __UPLOADFIT_MODE__,
  distribution: 'userscript',
  ai: false
});

if (typeof globalThis !== 'undefined') {
  Object.defineProperty(globalThis, '__uploadfit_build_info__', {
    configurable: true, enumerable: false, value: BUILD_INFO, writable: false
  });
}

// No browser-specific bridge, account or AI API is required by this entry.
if (typeof document !== 'undefined') startBrowserRuntime();

export { BUILD_INFO };
