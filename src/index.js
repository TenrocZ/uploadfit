import { bootstrap, cleanupSession } from './bootstrap.js';
import { detectCapabilities } from './capabilities.js';
import {
  extractRelevantContext,
  selectAiRelevantText
} from './dom/context-extractor.js';
import { genericAdapter } from './adapters/generic.js';
import { parseRulesDeterministically } from './rules/deterministic-parser.js';
import { normalizeRuleText } from './rules/normalizer.js';
import { resolveRules } from './rules/resolver.js';
import {
  createUploaderDiscovery,
  discoverUploaders,
  findFileInputFromEvent,
  isImageUploader
} from './dom/input-discovery.js';
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
  createUploaderDiscovery,
  detectCapabilities,
  discoverUploaders,
  extractRelevantContext,
  findFileInputFromEvent,
  genericAdapter,
  injectFile,
  isImageUploader,
  markUntrustedEventBlocked,
  normalizeRuleText,
  parseRulesDeterministically,
  restoreOriginal,
  resolveRules,
  selectAiRelevantText
};

if (typeof document !== 'undefined') bootstrap();
