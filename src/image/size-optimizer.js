import {
  ENCODE_QUALITY_MAX,
  ENCODE_QUALITY_MIN,
  ENCODE_SEARCH_STEPS,
  RESIZE_RETRY_LIMIT
} from '../config.js';
import { clamp } from '../utils/bytes.js';
import { ImageProcessingError } from './errors.js';
import { isLossyMime } from './encoder.js';
import { searchLossy } from './lossy-search.js';

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

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new ImageProcessingError('USER_CANCELLED', 'Image processing was aborted.', {
      reason: 'PROCESS_ABORTED'
    });
  }
}

async function encodeQuality(canvas, encode, quality, progress, signal) {
  throwIfAborted(signal);
  const blob = await encode(canvas, quality);
  throwIfAborted(signal);
  assertBlob(blob);
  report(progress, { stage: 'encode', quality, bytes: blob.size });
  return blob;
}

async function searchPng(canvas, encode, options) {
  const blob = await encodeQuality(canvas, encode, undefined, options.progress, options.signal);
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
  progress,
  signal
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
    throwIfAborted(signal);
    const rendered = await render(scale, { round, width, height });
    throwIfAborted(signal);
    const canvas = rendered?.canvas ?? rendered;
    const release = rendered?.release ?? (() => {});
    if (!canvas) throw new ImageProcessingError('PROCESSING_FAILED', 'Renderer returned no canvas.');
    try {
      const found = lossy
        ? await searchLossy({
          encode: (quality) => encodeQuality(canvas, encode, quality, progress, signal),
          targetMinBytes,
          targetMaxBytes,
          qualityMin,
          qualityMax,
          searchSteps,
          shouldAbort: () => throwIfAborted(signal)
        })
        : await searchPng(canvas, encode, {
          targetMinBytes,
          targetMaxBytes,
          progress,
          signal
        });
      throwIfAborted(signal);
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

    throwIfAborted(signal);
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
    throwIfAborted(signal);
    report(progress, { stage: 'resize', scale, width, height, round: round + 1 });
  }
  throw new ImageProcessingError('PROCESSING_FAILED', 'Size optimization exhausted its retry limit.');
}
