import { clamp, scaleDimensions } from '../utils/bytes.js';
import { extensionFromMime } from '../utils/mime.js';
import { decodeImageSource, inspectImage, validateFile } from './metadata.js';
import { encodeCanvas } from './encoder.js';
import {
  ImageProcessingError,
  asImageProcessingError,
  normalizeErrorCode
} from './errors.js';
import { optimizeEncodedOutput } from './size-optimizer.js';
import { createProcessingPlan } from './planner.js';
import { canUseWorkerPipeline, runWorkerPipeline } from './worker-runtime.js';

const BACKGROUND_COLORS = Object.freeze({
  white: '#ffffff',
  blue: '#1677ff',
  red: '#d9363e',
  green: '#2f9e44',
  black: '#000000'
});

function report(progress, event) {
  if (typeof progress !== 'function') return;
  try {
    progress(event);
  } catch {
    // Progress reporting is advisory and cannot change processing semantics.
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new ImageProcessingError('USER_CANCELLED', 'Image processing was aborted.', {
      reason: 'PROCESS_ABORTED'
    });
  }
}

function progressWithAbort(progress, signal) {
  if (typeof progress !== 'function' && !signal) return progress;
  return (event) => {
    throwIfAborted(signal);
    report(progress, event);
    throwIfAborted(signal);
  };
}

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

function stableEqual(first, second) {
  return JSON.stringify(stableValue(first)) === JSON.stringify(stableValue(second));
}

const AUTHORITY_FIELDS = Object.freeze([
  'targetMime',
  'targetWidth',
  'targetHeight',
  'proposedCrop',
  'proposedFlattenBackground',
  'qualityRange',
  'searchSteps',
  'resizeRetryLimit',
  'targetMinBytes',
  'targetMaxBytes',
  'hardMaxBytes',
  'minOutputWidth',
  'minOutputHeight',
  'allowSizeResize',
  'operations',
  'rules'
]);

const CONFIRMATION_TYPES = new Set(['CROP', 'FLATTEN_BACKGROUND', 'UPSCALE']);
const BACKGROUND_COLOR_NAMES = new Set(Object.keys(BACKGROUND_COLORS));

function normalizeCropPayload(payload) {
  const candidate = isRecord(payload?.crop) ? payload.crop : payload;
  if (!isRecord(candidate)) return null;
  const keys = ['x', 'y', 'width', 'height'];
  if (!keys.every((key) => Number.isFinite(candidate[key]) && candidate[key] >= 0)) return null;
  if (candidate.width <= 0 || candidate.height <= 0) return null;
  return Object.fromEntries(keys.map((key) => [key, Math.round(candidate[key])]));
}

// ADR-002：确认的裁剪矩形必须保持建议尺寸，仅允许在图像内平移（边界由 safeCrop 强制）。
function cropTranslationAllowed(crop, proposal) {
  if (!crop || !proposal) return false;
  return crop.width === proposal.width
    && crop.height === proposal.height
    && Number.isFinite(crop.x) && crop.x >= 0
    && Number.isFinite(crop.y) && crop.y >= 0;
}

function confirmationFailure(message, details = {}) {
  throw new ImageProcessingError('USER_CONFIRMATION_REQUIRED', message, details);
}

function validateResolvedPlan(metadata, plan) {
  if (!isRecord(plan) || !isRecord(plan.rules)) {
    throw new ImageProcessingError('PROCESSING_FAILED', 'Processing plan is not structurally valid.');
  }
  const authoritative = createProcessingPlan(metadata, plan.rules);
  if (authoritative.unfixable?.length) {
    throw new ImageProcessingError('PROCESSING_FAILED', 'Processing rules cannot produce an executable plan.', {
      unfixable: authoritative.unfixable
    });
  }
  for (const field of AUTHORITY_FIELDS) {
    if (!stableEqual(plan[field], authoritative[field])) {
      throw new ImageProcessingError('PROCESSING_FAILED', 'Processing plan does not match current input metadata or rules.', {
        field
      });
    }
  }

  if (!Array.isArray(plan.confirmations)
    || plan.confirmations.length !== authoritative.confirmations.length) {
    confirmationFailure('Required confirmation set does not match the current input.');
  }
  const expectedTypes = new Set(authoritative.confirmations.map((item) => item.type));
  if (!expectedTypes.has('CROP') && plan.crop !== null && plan.crop !== undefined) {
    confirmationFailure('Crop data is present without a matching required confirmation.');
  }
  if (!expectedTypes.has('FLATTEN_BACKGROUND')
    && plan.flattenBackground !== null && plan.flattenBackground !== undefined) {
    confirmationFailure('Background flattening is present without a matching required confirmation.');
  }
  if (!expectedTypes.has('UPSCALE') && plan.upscaleAccepted === true) {
    confirmationFailure('Upscale approval is present without a matching required confirmation.');
  }

  const canonical = authoritative;
  const canonicalConfirmations = [];
  for (const expected of authoritative.confirmations) {
    if (!CONFIRMATION_TYPES.has(expected.type)) {
      throw new ImageProcessingError('PROCESSING_FAILED', 'Processing plan contains an unsupported confirmation type.');
    }
    const actual = plan.confirmations.find((item) => item?.id === expected.id);
    if (!actual || actual.type !== expected.type || actual.required !== true
      || !stableEqual(actual.suggestedPayload, expected.suggestedPayload)) {
      confirmationFailure('Required confirmation identity or proposal does not match.');
    }
    if (actual.resolved === true && actual.accepted === false) {
      throw new ImageProcessingError('USER_CANCELLED', 'User confirmation was declined.');
    }
    if (actual.resolved !== true || actual.accepted !== true) {
      confirmationFailure('Required confirmation is unresolved.');
    }
    if (expected.type === 'CROP') {
      const crop = normalizeCropPayload(actual.payload);
      if (!crop || !cropTranslationAllowed(crop, authoritative.proposedCrop)
        || !stableEqual(plan.crop, crop)) {
        confirmationFailure('Crop confirmation payload is invalid or tampered.');
      }
      canonical.crop = crop;
      canonicalConfirmations.push({
        ...expected,
        resolved: true,
        accepted: true,
        payload: crop
      });
    } else if (expected.type === 'FLATTEN_BACKGROUND') {
      const color = actual.payload?.color;
      if (!isRecord(actual.payload) || !BACKGROUND_COLOR_NAMES.has(color)
        || !stableEqual(plan.flattenBackground, { color })) {
        confirmationFailure('Flatten background confirmation payload is invalid or tampered.');
      }
      canonical.flattenBackground = { color };
      canonicalConfirmations.push({
        ...expected,
        resolved: true,
        accepted: true,
        payload: { color }
      });
    } else if (expected.type === 'UPSCALE') {
      if (actual.payload?.allow !== true || plan.upscaleAccepted !== true) {
        confirmationFailure('Upscale confirmation must explicitly allow the proposed upscale.');
      }
      const proposedWidth = expected.suggestedPayload?.width;
      const proposedHeight = expected.suggestedPayload?.height;
      if ((actual.payload.width !== undefined && actual.payload.width !== proposedWidth)
        || (actual.payload.height !== undefined && actual.payload.height !== proposedHeight)) {
        confirmationFailure('Upscale confirmation target does not match the current input.');
      }
      canonical.upscaleAccepted = true;
      canonicalConfirmations.push({
        ...expected,
        resolved: true,
        accepted: true,
        payload: { allow: true }
      });
    }
  }
  if (plan.executable !== true) {
    const declined = plan.confirmations.some((item) => item?.resolved === true && item.accepted === false);
    throw new ImageProcessingError(
      declined ? 'USER_CANCELLED' : 'USER_CONFIRMATION_REQUIRED',
      declined ? 'User confirmation was declined.' : 'Required confirmation is unresolved.'
    );
  }
  canonical.confirmations = canonicalConfirmations;
  canonical.executable = true;
  return canonical;
}

function createCanvas(width, height, preferOffscreen = false) {
  if (preferOffscreen && typeof globalThis.OffscreenCanvas === 'function') {
    return new globalThis.OffscreenCanvas(width, height);
  }
  if (typeof globalThis.document?.createElement === 'function') {
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof globalThis.OffscreenCanvas === 'function') {
    return new globalThis.OffscreenCanvas(width, height);
  }
  throw new ImageProcessingError('CANVAS_LIMIT_EXCEEDED', 'Canvas is unavailable.');
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // HTMLCanvasElement and OffscreenCanvas cleanup are both best effort.
  }
}

function contextFor(canvas) {
  const context = canvas.getContext?.('2d');
  if (!context) throw new ImageProcessingError('CANVAS_LIMIT_EXCEEDED', '2D canvas context is unavailable.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return context;
}

function orientationDimensions(width, height, orientation) {
  return [5, 6, 7, 8].includes(orientation)
    ? { width: height, height: width }
    : { width, height };
}

function applyOrientationTransform(context, orientation, width, height) {
  switch (orientation) {
    case 2:
      context.transform(-1, 0, 0, 1, width, 0);
      break;
    case 3:
      context.transform(-1, 0, 0, -1, width, height);
      break;
    case 4:
      context.transform(1, 0, 0, -1, 0, height);
      break;
    case 5:
      context.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      context.transform(0, 1, -1, 0, height, 0);
      break;
    case 7:
      context.transform(0, -1, -1, 0, height, width);
      break;
    case 8:
      context.transform(0, -1, 1, 0, 0, width);
      break;
    default:
      break;
  }
}

function createOrientedSource(decoded, metadata, preferOffscreen = false) {
  const sourceWidth = decoded.width;
  const sourceHeight = decoded.height;
  const orientation = decoded.orientationAppliedByBrowser ? 1 : metadata.orientation ?? 1;
  const dimensions = orientationDimensions(sourceWidth, sourceHeight, orientation);
  if (orientation === 1) {
    return {
      source: decoded.source,
      width: sourceWidth,
      height: sourceHeight,
      release: () => {}
    };
  }
  const canvas = createCanvas(dimensions.width, dimensions.height, preferOffscreen);
  const context = contextFor(canvas);
  applyOrientationTransform(context, orientation, sourceWidth, sourceHeight);
  context.drawImage(decoded.source, 0, 0, sourceWidth, sourceHeight);
  return {
    source: canvas,
    width: dimensions.width,
    height: dimensions.height,
    release: () => releaseCanvas(canvas)
  };
}

function safeCrop(plan, width, height) {
  const candidate = plan.crop ?? { x: 0, y: 0, width, height };
  if (!candidate
    || !Number.isFinite(candidate.x)
    || !Number.isFinite(candidate.y)
    || !Number.isFinite(candidate.width)
    || !Number.isFinite(candidate.height)
    || candidate.x < 0
    || candidate.y < 0
    || candidate.width <= 0
    || candidate.height <= 0
    || candidate.x + candidate.width > width
    || candidate.y + candidate.height > height) {
    throw new ImageProcessingError('PROCESSING_FAILED', 'Crop rectangle is outside the decoded image.');
  }
  return candidate;
}

function renderPlan(oriented, plan, scale, preferOffscreen = false) {
  const baseWidth = Math.max(1, Math.round(plan.targetWidth ?? oriented.width));
  const baseHeight = Math.max(1, Math.round(plan.targetHeight ?? oriented.height));
  const dimensions = scaleDimensions(
    baseWidth,
    baseHeight,
    scale,
    plan.minOutputWidth ?? 1,
    plan.minOutputHeight ?? 1
  );
  const canvas = createCanvas(dimensions.width, dimensions.height, preferOffscreen);
  const context = contextFor(canvas);
  const crop = safeCrop(plan, oriented.width, oriented.height);
  if (plan.flattenBackground?.color) {
    const color = BACKGROUND_COLORS[plan.flattenBackground.color] ?? BACKGROUND_COLORS.white;
    context.save();
    context.fillStyle = color;
    context.fillRect(0, 0, dimensions.width, dimensions.height);
    context.restore();
  }
  context.drawImage(
    oriented.source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    dimensions.width,
    dimensions.height
  );
  return {
    canvas,
    width: dimensions.width,
    height: dimensions.height,
    release: () => releaseCanvas(canvas)
  };
}

function sanitizeStem(name) {
  const raw = typeof name === 'string' ? name : 'upload';
  const withoutExtension = raw.replace(/\.[a-z0-9]{1,12}$/i, '');
  const withoutSuffix = withoutExtension.replace(/(?:_uploadfit)+$/i, '');
  const sanitized = withoutSuffix
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return sanitized || 'upload';
}

export function createOutputFileName(localName, mime) {
  const extension = extensionFromMime(mime) ?? 'bin';
  const suffix = `_uploadfit.${extension}`;
  const maxStemLength = Math.max(1, 120 - suffix.length);
  return `${sanitizeStem(localName).slice(0, maxStemLength)}${suffix}`;
}

function createFileFromBlob(blob, name, mime, sourceFile) {
  const FileConstructor = sourceFile?.constructor?.name === 'File'
    ? sourceFile.constructor
    : globalThis.File;
  if (typeof FileConstructor !== 'function') {
    throw new ImageProcessingError('PROCESSING_FAILED', 'File constructor is unavailable.');
  }
  try {
    return new FileConstructor([blob], name, { type: mime, lastModified: 0 });
  } catch (error) {
    throw new ImageProcessingError('PROCESSING_FAILED', error?.message ?? 'File creation failed.');
  }
}

async function processOnMainThread(file, plan, metadata, progress, signal) {
  let decoded;
  let oriented;
  try {
    throwIfAborted(signal);
    report(progress, { stage: 'decode' });
    decoded = await decodeImageSource(file, { signal });
    throwIfAborted(signal);
    oriented = createOrientedSource(decoded, metadata);
    throwIfAborted(signal);
    const optimized = await optimizeEncodedOutput({
      mime: plan.targetMime,
      initialWidth: plan.targetWidth ?? oriented.width,
      initialHeight: plan.targetHeight ?? oriented.height,
      targetMinBytes: plan.targetMinBytes,
      targetMaxBytes: plan.targetMaxBytes,
      qualityMin: plan.qualityRange?.[0],
      qualityMax: plan.qualityRange?.[1],
      searchSteps: plan.searchSteps,
      resizeRetryLimit: plan.resizeRetryLimit,
      allowResize: plan.allowSizeResize,
      minWidth: plan.minOutputWidth,
      minHeight: plan.minOutputHeight,
      progress,
      signal,
      render: (scale) => {
        throwIfAborted(signal);
        const rendered = renderPlan(oriented, plan, scale);
        throwIfAborted(signal);
        return rendered;
      },
      encode: (canvas, quality) => encodeCanvas(canvas, plan.targetMime, quality)
    });
    throwIfAborted(signal);
    return { ...optimized, workerUsed: false };
  } catch (error) {
    throw asImageProcessingError(error);
  } finally {
    oriented?.release?.();
    decoded?.close?.();
  }
}

function assertExecutablePlan(plan) {
  if (!plan || plan.executable !== true) {
    const cancelled = plan?.confirmations?.some((item) => item.resolved && item.accepted === false);
    throw new ImageProcessingError(
      cancelled ? 'USER_CANCELLED' : 'USER_CONFIRMATION_REQUIRED',
      cancelled ? 'User confirmation was declined.' : 'Required confirmation is unresolved.'
    );
  }
  if (!plan.targetMime || !plan.targetWidth || !plan.targetHeight) {
    throw new ImageProcessingError('PROCESSING_FAILED', 'Processing plan has no usable target.');
  }
  if (plan.confirmations?.some((item) => item.required && (!item.resolved || item.accepted !== true))) {
    throw new ImageProcessingError('USER_CONFIRMATION_REQUIRED', 'Required confirmation is unresolved.');
  }
  if (plan.operations?.includes('CROP') && !plan.crop) {
    throw new ImageProcessingError('USER_CONFIRMATION_REQUIRED', 'Crop confirmation is unresolved.');
  }
  if (plan.operations?.includes('FLATTEN_BACKGROUND') && !plan.flattenBackground) {
    throw new ImageProcessingError('USER_CONFIRMATION_REQUIRED', 'Background confirmation is unresolved.');
  }
}

/**
 * Process a File under an already resolved plan. The original File is returned
 * unchanged for a valid passthrough plan.
 */
export async function processImage(file, plan, progressCallback, options = {}) {
  const startedAt = Date.now();
  const signal = options?.signal;
  const progress = progressWithAbort(progressCallback, signal);
  throwIfAborted(signal);
  let metadata;
  try {
    metadata = await inspectImage(file, { signal });
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    throw asImageProcessingError(error);
  }
  throwIfAborted(signal);
  if (metadata.errorCode || !metadata.decodable) {
    throw new ImageProcessingError(
      normalizeErrorCode(metadata.errorCode, 'DECODE_FAILED'),
      'Input image is not processable.'
    );
  }
  const executablePlan = validateResolvedPlan(metadata, plan);
  assertExecutablePlan(executablePlan);
  const inputValidation = validateFile(metadata, executablePlan.rules);

  if (executablePlan.passthrough && inputValidation.valid && executablePlan.operations.length === 0) {
    return {
      file,
      metadata: {
        mime: metadata.mime,
        size: metadata.size,
        width: metadata.width,
        height: metadata.height
      },
      operations: [],
      validation: inputValidation,
      durationMs: Date.now() - startedAt,
      warnings: [],
      passthrough: true,
      workerUsed: false
    };
  }

  const warnings = [...(executablePlan.warnings ?? [])];
  let optimized;
  const wantWorker = options.useWorker !== false;
  if (wantWorker && canUseWorkerPipeline()) {
    try {
      report(progress, { stage: 'worker-start' });
      optimized = await runWorkerPipeline(file, executablePlan, metadata, progress, {
        signal,
        timeoutMs: options.workerTimeoutMs
      });
    } catch (error) {
      const normalized = asImageProcessingError(error);
      if (normalized.code === 'USER_CANCELLED') throw normalized;
      warnings.push({ code: 'WORKER_FALLBACK_MAIN_THREAD' });
      report(progress, { stage: 'worker-fallback' });
      optimized = await processOnMainThread(file, executablePlan, metadata, progress, signal);
    }
  } else {
    optimized = await processOnMainThread(file, executablePlan, metadata, progress, signal);
  }
  throwIfAborted(signal);

  const outputName = createOutputFileName(file?.name, executablePlan.targetMime);
  const outputFile = createFileFromBlob(optimized.blob, outputName, executablePlan.targetMime, file);
  const outputMetadata = await inspectImage(outputFile, { signal });
  throwIfAborted(signal);
  const outputValidation = validateFile(outputMetadata, executablePlan.rules);
  if (outputMetadata.errorCode || !outputMetadata.decodable || !outputValidation.valid) {
    throw new ImageProcessingError('OUTPUT_VALIDATION_FAILED', 'Processed output failed final validation.', {
      violations: outputValidation.violations.map((item) => item.code),
      errorCode: outputMetadata.errorCode,
      bytes: outputMetadata.size,
      width: outputMetadata.width,
      height: outputMetadata.height
    });
  }
  report(progress, { stage: 'complete', bytes: outputMetadata.size });
  return {
    file: outputFile,
    metadata: {
      mime: outputMetadata.mime,
      size: outputMetadata.size,
      width: outputMetadata.width,
      height: outputMetadata.height
    },
    operations: [...(executablePlan.operations ?? [])],
    validation: outputValidation,
    durationMs: Date.now() - startedAt,
    warnings,
    passthrough: false,
    workerUsed: Boolean(optimized.workerUsed)
  };
}

export { createCanvas, releaseCanvas, renderPlan };
