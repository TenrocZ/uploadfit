import { inspectAudio } from './metadata.js';
import {
  createAudioProcessingPlan,
  resolveAudioConfirmation
} from './planner.js';
import { createAudioPipeline } from './pipeline.js';
import {
  validateAudioMetadata,
  validateAudioOutput,
  validateAudioOutputFile
} from './validators.js';

function isAudioContext(context) {
  if (!context || typeof context !== 'object') return true;
  if (context.mediaKind && context.mediaKind !== 'audio') return false;
  if (context.multiple === true) return false;
  const tokens = Array.isArray(context.acceptTokens) ? context.acceptTokens : [];
  const hasImage = tokens.some((token) => String(token).toLowerCase().startsWith('image/'));
  const hasAudio = tokens.some((token) => String(token).toLowerCase().startsWith('audio/'));
  return !(hasImage && hasAudio);
}

function isAudioLike(file) {
  const type = typeof file?.type === 'string' ? file.type.toLowerCase().split(';', 1)[0] : '';
  const name = typeof file?.name === 'string' ? file.name.toLowerCase() : '';
  return type.startsWith('audio/') || /\.(mp3|m4a|wav|aac|webm)$/.test(name);
}

/** Build the S2 audio MediaHandler without touching the upload controller/UI. */
export function createAudioHandler(options = {}) {
  let disposed = false;
  const pipelineOptions = { ...options };
  const pipeline = createAudioPipeline(pipelineOptions);
  return Object.freeze({
    kind: 'audio',
    supports(file, uploaderContext) {
      if (disposed || !isAudioContext(uploaderContext)) return false;
      return isAudioLike(file);
    },
    inspect(file, inspectOptions = {}) {
      if (disposed) return Promise.reject(new Error('Audio handler is disposed.'));
      return inspectAudio(file, { ...inspectOptions, signal: inspectOptions.signal ?? options.signal });
    },
    validate(metadata, rules, validateOptions = {}) {
      return validateAudioMetadata(metadata, rules, validateOptions);
    },
    plan(metadata, rules, planOptions = {}) {
      return createAudioProcessingPlan(metadata, rules, planOptions);
    },
    resolveConfirmation(plan, confirmation) {
      return resolveAudioConfirmation(plan, confirmation);
    },
    process(file, plan, processOptions = {}) {
      if (disposed) return Promise.reject(new Error('Audio handler is disposed.'));
      return pipeline.process(file, plan, {
        ...processOptions,
        rules: processOptions.rules ?? options.rules
      });
    },
    validateOutput(metadata, rules, plan, sourceMetadata, validateOptions = {}) {
      return validateAudioOutput(metadata, rules, plan, sourceMetadata, validateOptions);
    },
    validateOutputFile(file, rules, plan, sourceMetadata, validateOptions = {}) {
      return validateAudioOutputFile(file, rules, plan, sourceMetadata, validateOptions);
    },
    dispose() {
      disposed = true;
      try { pipeline.dispose(); } catch {}
    }
  });
}

export const audioHandler = createAudioHandler();

export default audioHandler;
