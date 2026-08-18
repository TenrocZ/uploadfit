import { bootstrap, cleanupSession } from './bootstrap.js';
import { detectCapabilities } from './capabilities.js';
import {
  injectFile,
  markUntrustedEventBlocked,
  restoreOriginal
} from './injection/file-injector.js';

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

export {
  BUILD_INFO,
  bootstrap,
  cleanupSession,
  detectCapabilities,
  injectFile,
  markUntrustedEventBlocked,
  restoreOriginal
};

if (typeof document !== 'undefined') bootstrap();
