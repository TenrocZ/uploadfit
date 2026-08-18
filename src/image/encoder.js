import { ImageProcessingError } from './errors.js';

const LOSSY_MIMES = new Set(['image/jpeg', 'image/webp']);

function isCanvasLike(canvas) {
  return Boolean(canvas && (
    typeof canvas.toBlob === 'function' || typeof canvas.convertToBlob === 'function'
  ));
}

/**
 * Encode a canvas without using Base64 as an intermediate representation.
 */
export async function encodeCanvas(canvas, mime, quality) {
  if (!isCanvasLike(canvas)) {
    throw new ImageProcessingError('CANVAS_LIMIT_EXCEEDED', 'Canvas encoding is unavailable.');
  }
  const type = typeof mime === 'string' ? mime : 'image/png';
  const options = { type };
  if (LOSSY_MIMES.has(type) && Number.isFinite(quality)) options.quality = quality;
  try {
    let blob;
    if (typeof canvas.convertToBlob === 'function') {
      blob = await canvas.convertToBlob(options);
    } else {
      blob = await new Promise((resolve, reject) => {
        try {
          canvas.toBlob((value) => {
            if (value) resolve(value);
            else reject(new ImageProcessingError('PROCESSING_FAILED', 'Canvas returned an empty Blob.'));
          }, type, options.quality);
        } catch (error) {
          reject(error);
        }
      });
    }
    if (!blob || blob.size <= 0) {
      throw new ImageProcessingError('PROCESSING_FAILED', 'Canvas returned an empty Blob.');
    }
    return blob;
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    if (error?.name === 'IndexSizeError' || error?.name === 'InvalidStateError') {
      throw new ImageProcessingError('CANVAS_LIMIT_EXCEEDED', error.message, { causeName: error.name });
    }
    throw new ImageProcessingError('PROCESSING_FAILED', error?.message ?? 'Canvas encoding failed.', {
      causeName: error?.name ?? 'Error'
    });
  }
}

export function isLossyMime(mime) {
  return LOSSY_MIMES.has(mime);
}

