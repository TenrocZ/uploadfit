import { inspectImage, validateFile } from '../image/metadata.js';
import { createProcessingPlan, resolveProcessingConfirmation } from '../image/planner.js';
import { processImage } from '../image/canvas-pipeline.js';
import { createAudioHandler } from '../audio/handler.js';

function unsupportedHandler(kind) {
  return Object.freeze({
    kind,
    supports: () => false,
    inspect: async () => ({ mediaKind: kind, errorCode: 'MEDIA_KIND_UNSUPPORTED' }),
    validate: () => ({
      valid: false,
      violations: [{ code: 'MEDIA_KIND_UNSUPPORTED', expected: ['image', 'audio'], actual: kind }],
      warnings: [],
      safeAutoFixes: [],
      requiredConfirmations: [],
      unfixable: ['MEDIA_KIND_UNSUPPORTED']
    }),
    plan: () => ({ mediaKind: kind, executable: false, unfixable: ['MEDIA_KIND_UNSUPPORTED'] }),
    resolveConfirmation: (plan) => plan,
    process: async () => { throw new Error('Media kind is unsupported.'); },
    validateOutput: () => ({ valid: false, violations: [{ code: 'MEDIA_KIND_UNSUPPORTED' }] }),
    dispose: () => {}
  });
}

function createImageAdapter(imageOptions = {}) {
  return Object.freeze({
    kind: 'image',
    supports(file, context) {
      if (context?.mediaKind && context.mediaKind !== 'image') return false;
      if (context?.multiple === true) return false;
      const type = typeof file?.type === 'string' ? file.type.toLowerCase() : '';
      return type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file?.name ?? '');
    },
    inspect: (file, options) => inspectImage(file, options),
    validate: (metadata, rules, options) => validateFile(metadata, rules, options),
    plan: (metadata, rules, options) => createProcessingPlan(metadata, rules, options),
    resolveConfirmation: (plan, confirmation) => resolveProcessingConfirmation(plan, confirmation),
    process: (file, plan, options) => processImage(file, plan, options?.onProgress, options),
    validateOutput: (metadata, rules) => validateFile(metadata, rules),
    dispose: () => {}
  });
}

/**
 * Small registry used by S2 harnesses.  It intentionally has no DOM or
 * controller dependency, and an unknown media kind never falls through to an
 * unrelated handler.
 */
export function createMediaHandlerRegistry(options = {}) {
  const handlers = new Map();
  const image = options.imageHandler ?? createImageAdapter(options.image);
  const audio = options.audioHandler ?? createAudioHandler(options.audio);
  if (image?.kind === 'image') handlers.set('image', image);
  if (audio?.kind === 'audio') handlers.set('audio', audio);
  return Object.freeze({
    register(handler) {
      if (!handler || !['image', 'audio'].includes(handler.kind)) return false;
      handlers.set(handler.kind, handler);
      return true;
    },
    get(kind) {
      return handlers.get(kind) ?? unsupportedHandler(kind);
    },
    resolve(kind, file, context) {
      const handler = handlers.get(kind);
      return handler?.supports(file, context) ? handler : unsupportedHandler(kind);
    },
    kinds() {
      return [...handlers.keys()];
    },
    dispose() {
      for (const handler of handlers.values()) {
        try { handler.dispose?.(); } catch {}
      }
      handlers.clear();
    }
  });
}

export const createMediaHandlers = createMediaHandlerRegistry;

