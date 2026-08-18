const STABLE_IMAGE_ERROR_CODES = new Set([
  'FORMAT_NOT_ALLOWED',
  'FILE_TOO_LARGE',
  'FILE_TOO_SMALL',
  'WIDTH_TOO_SMALL',
  'WIDTH_TOO_LARGE',
  'HEIGHT_TOO_SMALL',
  'HEIGHT_TOO_LARGE',
  'DIMENSION_MISMATCH',
  'ASPECT_RATIO_MISMATCH',
  'ORIENTATION_MISMATCH',
  'TRANSPARENCY_WILL_BE_LOST',
  'DECODE_FAILED',
  'UNSUPPORTED_FORMAT',
  'AMBIGUOUS_RULES',
  'OFFICIAL_TOOL_REQUIRED',
  'FILE_TOO_LARGE_TO_PROCESS',
  'PIXEL_LIMIT_EXCEEDED',
  'CANVAS_LIMIT_EXCEEDED',
  'PROCESSING_FAILED',
  'OUTPUT_VALIDATION_FAILED',
  'USER_CONFIRMATION_REQUIRED',
  'DATATRANSFER_UNAVAILABLE',
  'INJECTION_FAILED',
  'UNTRUSTED_EVENT_BLOCKED',
  'INPUT_DETACHED',
  'AMBIGUOUS_REJECTION_ASSOCIATION',
  'AI_UNAVAILABLE',
  'AI_TIMEOUT',
  'AI_INVALID_OUTPUT',
  'RULE_CONFLICT',
  'USER_CANCELLED',
  'SESSION_DISPOSED'
]);

export function normalizeErrorCode(code, fallbackCode = 'PROCESSING_FAILED') {
  const fallback = typeof fallbackCode === 'string' && STABLE_IMAGE_ERROR_CODES.has(fallbackCode)
    ? fallbackCode
    : 'PROCESSING_FAILED';
  return typeof code === 'string' && STABLE_IMAGE_ERROR_CODES.has(code)
    ? code
    : fallback;
}

export class ImageProcessingError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'ImageProcessingError';
    this.code = normalizeErrorCode(code);
    this.details = details;
  }
}

export function asImageProcessingError(error, fallbackCode = 'PROCESSING_FAILED') {
  if (error instanceof ImageProcessingError) return error;
  const code = normalizeErrorCode(error?.code, fallbackCode);
  return new ImageProcessingError(
    code,
    error?.message ?? fallbackCode,
    {
      causeName: error?.name ?? 'Error',
      ...(typeof error?.code === 'string' && error.code !== code
        ? { originalCode: error.code }
        : {})
    }
  );
}

export { STABLE_IMAGE_ERROR_CODES };
