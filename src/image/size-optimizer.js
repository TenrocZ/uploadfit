import {
  ENCODE_QUALITY_MAX,
  ENCODE_QUALITY_MIN,
  ENCODE_SEARCH_STEPS,
  RESIZE_RETRY_LIMIT
} from '../config.js';
import { clamp } from '../utils/bytes.js';
import { ImageProcessingError } from './errors.js';
import { isLossyMime } from './encoder.js';

function assertBlob(blob) {
  if (!blob || typeof blob.size !== 'number' || blob.size <= 0) {
    throw new ImageProcessingError('PROCESSING_FAILED', 'Encoder returned an empty Blob.');
  }
}

function report(progress, event) {
  if (typeof progress !== 'function') return;
  try {
    progress(event);
  } catch {
    // A progress observer cannot break image processing.
  }
}

function validSize(blob, minimum, maximum) {
  return blob.size >= (minimum ?? 0) && (maximum === null || maximum === undefined || blob.size <= maximum);
}

async function encodeQuality(canvas, encode, quality, progress) {
  const blob = await encode(canvas, quality);
  assertBlob(blob);
  report(progress, { stage: 'encode', quality, bytes: blob.size });
  return blob;
}

async function searchLossy(canvas, encode, options) {
  const minimum = options.targetMinBytes;
  const maximum = options.targetMaxBytes;
  const qualityMin = clamp(options.qualityMin, 0.01, 1);
  const qualityMax = clamp(options.qualityMax, qualityMin, 1);
  const steps = Math.max(1, Math.min(16, options.searchSteps));
  const highest = await encodeQuality(canvas, encode, qualityMax, options.progress);
  if (maximum === null || highest.size <= maximum) {
    if (highest.size >= (minimum ?? 0)) return { blob: highest, quality: qualityMax };
    return { blob: null, quality: qualityMax, belowMinimum: true };
  }

  const lowest = await encodeQuality(canvas, encode, qualityMin, options.progress);
  if (lowest.size > maximum) {
    return { blob: null, quality: qualityMin, overMaximum: true, reference: lowest };
  }
  if (lowest.size < (minimum ?? 0)) {
    return { blob: null, quality: qualityMin, belowMinimum: true };
  }

  let low = qualityMin;
  let high = qualityMax;
  let best = { blob: lowest, quality: qualityMin };
  for (let step = 0; step < steps; step += 1) {
    const quality = (low + high) / 2;
    const blob = await encodeQuality(canvas, encode, quality, options.progress);
    if (blob.size > maximum) {
      high = quality;
    } else {
      if (blob.size >= (minimum ?? 0) && quality > best.quality) {
        best = { blob, quality };
      }
      low = quality;
    }
  }
  if (!validSize(best.blob, minimum, maximum)) {
    return { blob: null, quality: best.quality, belowMinimum: best.blob.size < (minimum ?? 0) };
  }
  return best;
}

async function searchPng(canvas, encode, options) {
  const blob = await encodeQuality(canvas, encode, undefined, options.progress);
  if (validSize(blob, options.targetMinBytes, options.targetMaxBytes)) {
    return { blob, quality: null };
  }
  if (options.targetMinBytes !== null && blob.size < options.targetMinBytes) {
    return { blob: null, quality: null, belowMinimum: true };
  }
  if (options.targetMaxBytes !== null && blob.size > options.targetMaxBytes) {
    return { blob: null, quality: null, overMaximum: true, reference: blob };
  }
  return { blob: null, quality: null };
}

/**
 * Optimize one rendered canvas. `render(scale)` must return a fresh canvas and
 * an optional release callback. It is deliberately injectable for deterministic
 * unit tests and for the Worker-equivalent runtime.
 */
export async function optimizeEncodedOutput({
  mime,
  render,
  encode,
  targetMinBytes = null,
  targetMaxBytes = null,
  qualityMin = ENCODE_QUALITY_MIN,
  qualityMax = ENCODE_QUALITY_MAX,
  searchSteps = ENCODE_SEARCH_STEPS,
  resizeRetryLimit = RESIZE_RETRY_LIMIT,
  allowResize = true,
  minWidth = 1,
  minHeight = 1,
  initialWidth,
  initialHeight,
  progress
}) {
  if (typeof render !== 'function' || typeof encode !== 'function') {
    throw new ImageProcessingError('PROCESSING_FAILED', 'Optimizer callbacks are required.');
  }
  const lossy = isLossyMime(mime);
  let scale = 1;
  let width = initialWidth;
  let height = initialHeight;
  let lastTooLargeBytes = null;

  for (let round = 0; round <= resizeRetryLimit; round += 1) {
    const rendered = await render(scale, { round, width, height });
    const canvas = rendered?.canvas ?? rendered;
    const release = rendered?.release ?? (() => {});
    if (!canvas) throw new ImageProcessingError('PROCESSING_FAILED', 'Renderer returned no canvas.');
    try {
      const found = lossy
        ? await searchLossy(canvas, encode, {
          targetMinBytes,
          targetMaxBytes,
          qualityMin,
          qualityMax,
          searchSteps,
          progress
        })
        : await searchPng(canvas, encode, {
          targetMinBytes,
          targetMaxBytes,
          progress
        });
      if (found.blob && validSize(found.blob, targetMinBytes, targetMaxBytes)) {
        return {
          blob: found.blob,
          quality: found.quality,
          scale,
          width: rendered?.width ?? width,
          height: rendered?.height ?? height,
          resizeRounds: round
        };
      }
      if (found.belowMinimum) {
        throw new ImageProcessingError('FILE_TOO_SMALL', 'Encoded output cannot reach the minimum byte size.', {
          targetMinBytes,
          actualBytes: found.reference?.size ?? null
        });
      }
      if (!found.overMaximum) {
        throw new ImageProcessingError('PROCESSING_FAILED', 'No encoded output satisfies the byte range.');
      }
      lastTooLargeBytes = found.reference?.size ?? lastTooLargeBytes;
    } finally {
      release();
    }

    if (!allowResize || round >= resizeRetryLimit || targetMaxBytes === null) {
      throw new ImageProcessingError('PROCESSING_FAILED', 'Encoded output remains above the maximum size.', {
        targetMaxBytes,
        actualBytes: lastTooLargeBytes
      });
    }
    const ratio = lastTooLargeBytes > 0 ? Math.sqrt(targetMaxBytes / lastTooLargeBytes) * 0.95 : 0.5;
    const requestedScale = clamp(ratio, 0.5, 0.95);
    const nextScale = scale * requestedScale;
    const nextWidth = Math.max(minWidth, Math.round(initialWidth * nextScale));
    const nextHeight = Math.max(minHeight, Math.round(initialHeight * nextScale));
    if (nextWidth >= width && nextHeight >= height) {
      throw new ImageProcessingError('PROCESSING_FAILED', 'Image dimensions cannot be reduced further.', {
        targetMaxBytes,
        actualBytes: lastTooLargeBytes
      });
    }
    scale = nextScale;
    width = nextWidth;
    height = nextHeight;
    report(progress, { stage: 'resize', scale, width, height, round: round + 1 });
  }
  throw new ImageProcessingError('PROCESSING_FAILED', 'Size optimization exhausted its retry limit.');
}

