import { clamp, scaleDimensions } from '../utils/bytes.js';
import { extensionFromMime } from '../utils/mime.js';
import { decodeImageSource, inspectImage, validateFile } from './metadata.js';
import { encodeCanvas } from './encoder.js';
import { ImageProcessingError, asImageProcessingError } from './errors.js';
import { optimizeEncodedOutput } from './size-optimizer.js';
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

async function processOnMainThread(file, plan, metadata, progress) {
  let decoded;
  let oriented;
  try {
    report(progress, { stage: 'decode' });
    decoded = await decodeImageSource(file);
    oriented = createOrientedSource(decoded, metadata);
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
      render: (scale) => renderPlan(oriented, plan, scale),
      encode: (canvas, quality) => encodeCanvas(canvas, plan.targetMime, quality)
    });
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
  assertExecutablePlan(plan);
  const metadata = await inspectImage(file);
  const inputValidation = validateFile(metadata, plan.rules);
  if (metadata.errorCode || !metadata.decodable) {
    throw new ImageProcessingError(metadata.errorCode ?? 'DECODE_FAILED', 'Input image is not processable.');
  }

  if (plan.passthrough && inputValidation.valid && plan.operations.length === 0) {
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

  const warnings = [...(plan.warnings ?? [])];
  let optimized;
  const wantWorker = options.useWorker !== false;
  if (wantWorker && canUseWorkerPipeline()) {
    try {
      report(progressCallback, { stage: 'worker-start' });
      optimized = await runWorkerPipeline(file, plan, metadata, progressCallback);
    } catch (error) {
      warnings.push({ code: 'WORKER_FALLBACK_MAIN_THREAD' });
      report(progressCallback, { stage: 'worker-fallback' });
      optimized = await processOnMainThread(file, plan, metadata, progressCallback);
    }
  } else {
    optimized = await processOnMainThread(file, plan, metadata, progressCallback);
  }

  const outputName = createOutputFileName(file?.name, plan.targetMime);
  const outputFile = createFileFromBlob(optimized.blob, outputName, plan.targetMime, file);
  const outputMetadata = await inspectImage(outputFile);
  const outputValidation = validateFile(outputMetadata, plan.rules);
  if (outputMetadata.errorCode || !outputMetadata.decodable || !outputValidation.valid) {
    throw new ImageProcessingError('OUTPUT_VALIDATION_FAILED', 'Processed output failed final validation.', {
      violations: outputValidation.violations.map((item) => item.code),
      errorCode: outputMetadata.errorCode,
      bytes: outputMetadata.size,
      width: outputMetadata.width,
      height: outputMetadata.height
    });
  }
  report(progressCallback, { stage: 'complete', bytes: outputMetadata.size });
  return {
    file: outputFile,
    metadata: {
      mime: outputMetadata.mime,
      size: outputMetadata.size,
      width: outputMetadata.width,
      height: outputMetadata.height
    },
    operations: [...(plan.operations ?? [])],
    validation: outputValidation,
    durationMs: Date.now() - startedAt,
    warnings,
    passthrough: false,
    workerUsed: Boolean(optimized.workerUsed)
  };
}

export { createCanvas, releaseCanvas, renderPlan };

