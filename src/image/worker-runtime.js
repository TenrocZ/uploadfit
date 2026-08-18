import {
  ENCODE_QUALITY_MAX,
  ENCODE_QUALITY_MIN,
  ENCODE_SEARCH_STEPS,
  RESIZE_RETRY_LIMIT
} from '../config.js';
import { ImageProcessingError } from './errors.js';

const WORKER_SOURCE = `
const lossy = (mime) => mime === 'image/jpeg' || mime === 'image/webp';
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const closeSource = (source) => { try { source && source.close && source.close(); } catch {} };
const colorMap = { white: '#ffffff', blue: '#1677ff', red: '#d9363e', green: '#2f9e44', black: '#000000' };
function emit(message) { self.postMessage(message); }
function drawOriented(source, width, height, orientation) {
  const swap = [5, 6, 7, 8].includes(orientation);
  const canvas = new OffscreenCanvas(swap ? height : width, swap ? width : height);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  switch (orientation) {
    case 2: context.transform(-1, 0, 0, 1, width, 0); break;
    case 3: context.transform(-1, 0, 0, -1, width, height); break;
    case 4: context.transform(1, 0, 0, -1, 0, height); break;
    case 5: context.transform(0, 1, 1, 0, 0, 0); break;
    case 6: context.transform(0, 1, -1, 0, height, 0); break;
    case 7: context.transform(0, -1, -1, 0, height, width); break;
    case 8: context.transform(0, -1, 1, 0, 0, width); break;
    default: break;
  }
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}
function dimensions(plan, scale) {
  return {
    width: Math.max(plan.minOutputWidth || 1, Math.max(1, Math.round(plan.targetWidth * scale))),
    height: Math.max(plan.minOutputHeight || 1, Math.max(1, Math.round(plan.targetHeight * scale)))
  };
}
function render(oriented, plan, scale) {
  const target = dimensions(plan, scale);
  const canvas = new OffscreenCanvas(target.width, target.height);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const crop = plan.crop || { x: 0, y: 0, width: oriented.width, height: oriented.height };
  if (plan.flattenBackground && plan.flattenBackground.color) {
    context.fillStyle = colorMap[plan.flattenBackground.color] || colorMap.white;
    context.fillRect(0, 0, target.width, target.height);
  }
  context.drawImage(oriented.source, crop.x, crop.y, crop.width, crop.height, 0, 0, target.width, target.height);
  return { canvas, width: target.width, height: target.height };
}
async function encode(canvas, mime, quality) {
  const options = { type: mime };
  if (lossy(mime) && Number.isFinite(quality)) options.quality = quality;
  const blob = await canvas.convertToBlob(options);
  if (!blob || blob.size <= 0) throw Object.assign(new Error('EMPTY_BLOB'), { code: 'PROCESSING_FAILED' });
  return blob;
}
function valid(blob, minimum, maximum) {
  return blob.size >= (minimum == null ? 0 : minimum)
    && (maximum == null || blob.size <= maximum);
}
async function optimize(oriented, plan) {
  let scale = 1;
  let lastTooLarge = null;
  for (let round = 0; round <= (plan.resizeRetryLimit || ${RESIZE_RETRY_LIMIT}); round += 1) {
    const rendered = render(oriented, plan, scale);
    const minimum = plan.targetMinBytes;
    const maximum = plan.targetMaxBytes;
    let result = null;
    if (lossy(plan.targetMime)) {
      const qualityMin = plan.qualityRange && plan.qualityRange[0] || ${ENCODE_QUALITY_MIN};
      const qualityMax = plan.qualityRange && plan.qualityRange[1] || ${ENCODE_QUALITY_MAX};
      const highest = await encode(rendered.canvas, plan.targetMime, qualityMax);
      emit({ type: 'progress', stage: 'encode', quality: qualityMax, bytes: highest.size });
      if (valid(highest, minimum, maximum)) result = { blob: highest, quality: qualityMax };
      if (!result && highest.size < (minimum == null ? 0 : minimum)
        && (maximum == null || highest.size <= maximum)) {
        throw Object.assign(new Error('FILE_TOO_SMALL'), { code: 'FILE_TOO_SMALL' });
      }
      if (!result && maximum != null && highest.size > maximum) {
        const lowest = await encode(rendered.canvas, plan.targetMime, qualityMin);
        if (valid(lowest, minimum, maximum)) result = { blob: lowest, quality: qualityMin };
        if (!result && lowest.size <= maximum && lowest.size >= (minimum == null ? 0 : minimum)) {
          let low = qualityMin;
          let high = qualityMax;
          let best = { blob: lowest, quality: qualityMin };
          for (let step = 0; step < (plan.searchSteps || ${ENCODE_SEARCH_STEPS}); step += 1) {
            const quality = (low + high) / 2;
            const blob = await encode(rendered.canvas, plan.targetMime, quality);
            emit({ type: 'progress', stage: 'encode', quality, bytes: blob.size });
            if (blob.size > maximum) high = quality;
            else {
              if (blob.size >= (minimum == null ? 0 : minimum) && quality > best.quality) best = { blob, quality };
              low = quality;
            }
          }
          if (valid(best.blob, minimum, maximum)) result = best;
        }
        if (!result && lowest.size > maximum) lastTooLarge = lowest.size;
        if (!result && lowest.size < (minimum == null ? 0 : minimum)) {
          throw Object.assign(new Error('FILE_TOO_SMALL'), { code: 'FILE_TOO_SMALL' });
        }
      }
      if (!result && maximum == null && highest.size < (minimum == null ? 0 : minimum)) {
        throw Object.assign(new Error('FILE_TOO_SMALL'), { code: 'FILE_TOO_SMALL' });
      }
    } else {
      const blob = await encode(rendered.canvas, plan.targetMime);
      emit({ type: 'progress', stage: 'encode', bytes: blob.size });
      if (valid(blob, minimum, maximum)) result = { blob, quality: null };
      if (!result && blob.size < (minimum == null ? 0 : minimum)) {
        throw Object.assign(new Error('FILE_TOO_SMALL'), { code: 'FILE_TOO_SMALL' });
      }
      if (!result) lastTooLarge = blob.size;
    }
    if (result) return { ...result, scale, width: rendered.width, height: rendered.height, resizeRounds: round };
    if (plan.allowSizeResize !== true || maximum == null || round >= (plan.resizeRetryLimit || ${RESIZE_RETRY_LIMIT})) {
      throw Object.assign(new Error('PROCESSING_FAILED'), { code: 'PROCESSING_FAILED', bytes: lastTooLarge });
    }
    const ratio = lastTooLarge > 0 ? Math.sqrt(maximum / lastTooLarge) * 0.95 : 0.5;
    scale *= clamp(ratio, 0.5, 0.95);
    emit({ type: 'progress', stage: 'resize', scale, round: round + 1 });
  }
  throw Object.assign(new Error('PROCESSING_FAILED'), { code: 'PROCESSING_FAILED' });
}
self.onmessage = async (event) => {
  let decoded;
  let orientedCanvas;
  try {
    const data = event.data;
    decoded = await createImageBitmap(data.file, { imageOrientation: 'none' });
    const orientation = data.metadata.orientation || 1;
    orientedCanvas = orientation === 1
      ? null
      : drawOriented(decoded, decoded.width, decoded.height, orientation);
    const oriented = {
      source: orientedCanvas || decoded,
      width: orientedCanvas ? orientedCanvas.width : decoded.width,
      height: orientedCanvas ? orientedCanvas.height : decoded.height
    };
    const result = await optimize(oriented, data.plan);
    emit({ type: 'result', ok: true, result });
  } catch (error) {
    emit({ type: 'result', ok: false, error: { code: error.code || 'PROCESSING_FAILED', message: error.message || 'Worker processing failed' } });
  } finally {
    closeSource(decoded);
    if (orientedCanvas) { orientedCanvas.width = 0; orientedCanvas.height = 0; }
  }
};
`;

export function canUseWorkerPipeline() {
  const OffscreenConstructor = globalThis.OffscreenCanvas;
  return typeof globalThis.Worker === 'function'
    && typeof globalThis.Blob === 'function'
    && typeof globalThis.URL?.createObjectURL === 'function'
    && typeof globalThis.URL?.revokeObjectURL === 'function'
    && typeof globalThis.createImageBitmap === 'function'
    && typeof OffscreenConstructor === 'function'
    && typeof OffscreenConstructor.prototype?.convertToBlob === 'function';
}

function workerError(error) {
  return new ImageProcessingError(
    error?.code ?? 'PROCESSING_FAILED',
    error?.message ?? 'Worker processing failed.',
    { worker: true }
  );
}

export async function runWorkerPipeline(file, plan, metadata, progress) {
  if (!canUseWorkerPipeline()) {
    throw new ImageProcessingError('PROCESSING_FAILED', 'Worker pipeline is unavailable.');
  }
  const workerBlob = new globalThis.Blob([WORKER_SOURCE], { type: 'text/javascript' });
  const workerUrl = globalThis.URL.createObjectURL(workerBlob);
  let worker;
  try {
    worker = new globalThis.Worker(workerUrl);
  } catch (error) {
    globalThis.URL.revokeObjectURL(workerUrl);
    throw workerError(error);
  }

  return await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ImageProcessingError('PROCESSING_FAILED', 'Worker timed out.', { worker: true }));
    }, 30_000);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      callback(value);
    };
    worker.onmessage = (event) => {
      const message = event.data;
      if (message?.type === 'progress') {
        try { progress?.(message); } catch {}
        return;
      }
      if (message?.type !== 'result') return;
      if (!message.ok) {
        finish(reject, workerError(message.error));
        return;
      }
      finish(resolve, { ...message.result, workerUsed: true });
    };
    worker.onerror = (event) => {
      finish(reject, workerError(event));
    };
    try {
      worker.postMessage({ file, plan, metadata });
    } catch (error) {
      finish(reject, workerError(error));
    }
  }).finally(() => {
    try { worker.terminate(); } catch {}
    globalThis.URL.revokeObjectURL(workerUrl);
  });
}
