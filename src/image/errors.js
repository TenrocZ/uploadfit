export class ImageProcessingError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'ImageProcessingError';
    this.code = code;
    this.details = details;
  }
}

export function asImageProcessingError(error, fallbackCode = 'PROCESSING_FAILED') {
  if (error instanceof ImageProcessingError) return error;
  return new ImageProcessingError(
    error?.code ?? fallbackCode,
    error?.message ?? fallbackCode,
    { causeName: error?.name ?? 'Error' }
  );
}

