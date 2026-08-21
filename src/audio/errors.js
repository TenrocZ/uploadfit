/** Stable V2 audio error codes shared by metadata and validation. */
export const AUDIO_ERROR_CODES = Object.freeze([
  'AUDIO_CODEC_UNSUPPORTED',
  'AUDIO_METADATA_INVALID',
  'AUDIO_DECODE_FAILED',
  'AUDIO_ENCODE_FAILED',
  'AUDIO_TARGET_UNSAFE',
  'AUDIO_OUTPUT_TOO_LARGE',
  'AUDIO_OUTPUT_FORMAT_NOT_ALLOWED',
  'AUDIO_DURATION_LIMIT_UNFIXABLE',
  'AUDIO_MEMORY_BUDGET_EXCEEDED',
  'AUDIO_WORKER_UNAVAILABLE',
  'AUDIO_PROCESSING_CANCELLED',
  // These two codes are local protocol errors.  They remain stable so a
  // harness/controller can distinguish a rejected plan from a codec failure.
  'AUDIO_CONFIRMATION_REQUIRED',
  'AUDIO_PIPELINE_BUSY',
  'AUDIO_OUTPUT_VALIDATION_FAILED'
]);

export const AUDIO_ERROR_MESSAGES = Object.freeze({
  AUDIO_CODEC_UNSUPPORTED: '当前音频编码不在支持范围内，请使用 MP3、AAC 或 PCM WAV。',
  AUDIO_METADATA_INVALID: '无法安全读取音频元数据，请检查源文件。',
  AUDIO_DECODE_FAILED: '音频文件损坏或无法解码，原文件未被修改。',
  AUDIO_ENCODE_FAILED: '音频处理失败，原文件未被修改。',
  AUDIO_TARGET_UNSAFE: '满足页面大小上限需要低于安全音质底线，未执行处理。',
  AUDIO_OUTPUT_TOO_LARGE: '生成的 MP3 仍超过页面大小上限，未回填文件。',
  AUDIO_OUTPUT_FORMAT_NOT_ALLOWED: '当前页面没有明确允许 MP3，未执行音频处理。',
  AUDIO_DURATION_LIMIT_UNFIXABLE: '当前限制是音频时长，不裁剪或分段文件。',
  AUDIO_MEMORY_BUDGET_EXCEEDED: '浏览器无法在安全内存预算内检查该音频。',
  AUDIO_WORKER_UNAVAILABLE: '后台音频处理能力不可用，未在主线程处理长文件。',
  AUDIO_PROCESSING_CANCELLED: '音频处理已取消，原文件保持不变。',
  AUDIO_CONFIRMATION_REQUIRED: '音频处理需要先完成必要确认。',
  AUDIO_PIPELINE_BUSY: '已有音频任务正在处理，请稍后重试。',
  AUDIO_OUTPUT_VALIDATION_FAILED: '生成的 MP3 未通过独立复检，原文件未被修改。'
});

export class AudioMetadataError extends Error {
  constructor(code, message = AUDIO_ERROR_MESSAGES[code] ?? code, details = {}) {
    super(message);
    this.name = 'AudioMetadataError';
    this.code = AUDIO_ERROR_CODES.includes(code) ? code : 'AUDIO_METADATA_INVALID';
    this.details = details;
  }
}

export class AudioProcessingError extends Error {
  constructor(code, message = AUDIO_ERROR_MESSAGES[code] ?? code, details = {}) {
    super(message);
    this.name = 'AudioProcessingError';
    this.code = AUDIO_ERROR_CODES.includes(code) ? code : 'AUDIO_ENCODE_FAILED';
    this.details = details;
  }
}

export function asAudioProcessingError(error, fallbackCode = 'AUDIO_ENCODE_FAILED') {
  if (error instanceof AudioProcessingError) return error;
  if (error instanceof AudioMetadataError) {
    return new AudioProcessingError(error.code, error.message, { ...error.details });
  }
  const code = AUDIO_ERROR_CODES.includes(error?.code) ? error.code : fallbackCode;
  return new AudioProcessingError(code, error?.message ?? AUDIO_ERROR_MESSAGES[code], {
    causeName: error?.name ?? 'Error',
    ...(typeof error?.code === 'string' && error.code !== code
      ? { originalCode: error.code }
      : {})
  });
}

export function isAudioErrorCode(value) {
  return AUDIO_ERROR_CODES.includes(value);
}

export function audioErrorMessage(code) {
  return AUDIO_ERROR_MESSAGES[code] ?? '音频文件无法安全处理。';
}
