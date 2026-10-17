import { AUDIO_ERROR_CODES } from './errors.js';
import { inspectAudio } from './metadata.js';
import { findMp3Frame, parseMp3Header } from './signatures.js';
import { confirmationId } from './confirmation.js';

const SUPPORTED_MIMES = Object.freeze(['audio/mpeg', 'audio/mp4', 'audio/wav']);
const SUPPORTED_CONTAINERS = Object.freeze(['mp3', 'mp4', 'wav']);
const MP3_MIMES = new Set(['audio/mpeg', 'audio/mp3']);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function addUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function violation(result, code, expected = null, actual = null) {
  if (!result.violations.some((item) => item.code === code)) {
    result.violations.push({ code, expected, actual });
  }
}

function unfixable(result, code) {
  addUnique(result.unfixable, code);
}

function confirmation(type, suggestedPayload) {
  return {
    id: confirmationId(type, suggestedPayload),
    type,
    required: true,
    resolved: false,
    accepted: null,
    payload: null,
    suggestedPayload
  };
}

function addConfirmation(result, type, payload) {
  if (!result.requiredConfirmations.some((item) => item.type === type)) {
    result.requiredConfirmations.push(confirmation(type, payload));
  }
}

function allowedFormats(rules) {
  const formats = Array.isArray(rules?.formats) ? rules.formats : [];
  const extensions = Array.isArray(rules?.extensions) ? rules.extensions : [];
  return { formats, extensions };
}

function allowsMp3(rules) {
  const { formats, extensions } = allowedFormats(rules);
  return formats.some((format) => MP3_MIMES.has(format))
    || extensions.some((extension) => String(extension).toLowerCase().replace(/^\./, '') === 'mp3');
}

function sourceAllowed(metadata, rules) {
  const { formats, extensions } = allowedFormats(rules);
  const mime = metadata?.signatureMime;
  if (!formats.length && !extensions.length) return false;
  if (formats.includes(mime)) return true;
  const extension = mime === 'audio/mpeg'
    ? 'mp3'
    : mime === 'audio/mp4'
      ? 'm4a'
      : mime === 'audio/wav'
        ? 'wav'
        : '';
  return extensions.some((item) => String(item).toLowerCase().replace(/^\./, '') === extension);
}

function supportedAudioSource(metadata) {
  const mime = metadata?.signatureMime ?? metadata?.mime;
  return (MP3_MIMES.has(mime) && metadata?.container === 'mp3' && metadata?.codec === 'mp3')
    || (mime === 'audio/mp4' && metadata?.container === 'mp4' && metadata?.codec === 'aac-lc')
    || (mime === 'audio/wav' && metadata?.container === 'wav' && metadata?.codec === 'pcm');
}

function safetyRequirements(rules) {
  const flags = new Set(Array.isArray(rules?.safetyFlags) ? rules.safetyFlags : []);
  const semantics = Array.isArray(rules?.semanticRequirements) ? rules.semanticRequirements : [];
  const text = semantics.join(' ');
  if (/(?:官方|审核工具)/.test(text)) flags.add('OFFICIAL_TOOL_REQUIRED');
  if (/(?:原始|证据原件|原文件)/.test(text)) flags.add('AUDIO_ORIGINAL_REQUIRED');
  if (/(?:无损|lossless)/i.test(text)) flags.add('AUDIO_LOSSLESS_REQUIRED');
  return flags;
}

function newResult() {
  return {
    valid: false,
    violations: [],
    warnings: [],
    safeAutoFixes: [],
    requiredConfirmations: [],
    unfixable: []
  };
}

/**
 * Validate audio metadata against only the S1-consumed RuleSet fields.  This
 * function does not encode, allocate PCM, create a Worker, or mutate a File.
 */
export function validateAudioMetadata(metadata, rules, options = {}) {
  const result = newResult();
  if (!isRecord(metadata)) {
    violation(result, 'AUDIO_DECODE_FAILED');
    unfixable(result, 'AUDIO_DECODE_FAILED');
    return result;
  }
  if (!isRecord(rules)) {
    violation(result, 'RULES_INSUFFICIENT');
    unfixable(result, 'RULES_INSUFFICIENT');
    return result;
  }

  const signatureMime = metadata.signatureMime ?? metadata.mime ?? null;
  if (metadata.errorCode) {
    const errorCode = AUDIO_ERROR_CODES.includes(metadata.errorCode)
      ? metadata.errorCode
      : 'AUDIO_METADATA_INVALID';
    violation(result, errorCode);
    unfixable(result, errorCode === 'AUDIO_METADATA_INVALID' ? 'AUDIO_DECODE_FAILED' : errorCode);
    return result;
  }
  if (!supportedAudioSource(metadata)) {
    violation(result, 'AUDIO_CODEC_UNSUPPORTED', SUPPORTED_MIMES, signatureMime);
    unfixable(result, 'AUDIO_CODEC_UNSUPPORTED');
    return result;
  }
  if (!Number.isFinite(metadata.size) || metadata.size <= 0
    || !Number.isFinite(metadata.durationMs) || metadata.durationMs <= 0
    || !Number.isFinite(metadata.sampleRate) || metadata.sampleRate <= 0
    || !Number.isInteger(metadata.channels) || metadata.channels < 1 || metadata.channels > 2) {
    violation(result, 'AUDIO_METADATA_INVALID');
    unfixable(result, 'AUDIO_METADATA_INVALID');
    return result;
  }
  if (metadata.fileType && metadata.fileType !== signatureMime) {
    result.warnings.push({ code: 'AUDIO_MIME_SIGNATURE_MISMATCH' });
  }
  if (metadata.warnings?.length) {
    for (const warning of metadata.warnings) {
      const code = typeof warning === 'string' ? warning : warning?.code;
      if (code) result.warnings.push({ code });
    }
  }

  const { formats, extensions } = allowedFormats(rules);
  const maxBytes = rules.maxBytes;
  const mp3Allowed = allowsMp3(rules);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    violation(result, 'RULES_INSUFFICIENT');
    unfixable(result, 'RULES_INSUFFICIENT');
  }
  // Preserve the accepted WAV contract: WAV is only in the product path when
  // the page also allows the MP3 output format.  S4.1's no-MP3 passthrough
  // exception is intentionally limited to an already-compliant AAC-LC M4A.
  if (!mp3Allowed && signatureMime === 'audio/wav') {
    violation(result, 'AUDIO_OUTPUT_FORMAT_NOT_ALLOWED', ['audio/mpeg', '.mp3'], formats);
    unfixable(result, 'AUDIO_OUTPUT_FORMAT_NOT_ALLOWED');
  }
  const semantics = safetyRequirements(rules);
  for (const flag of semantics) {
    if (flag === 'OFFICIAL_TOOL_REQUIRED') unfixable(result, 'OFFICIAL_TOOL_REQUIRED');
    else if (flag === 'AUDIO_ORIGINAL_REQUIRED') unfixable(result, 'AUDIO_ORIGINAL_REQUIRED');
    else if (flag === 'AUDIO_LOSSLESS_REQUIRED') unfixable(result, 'AUDIO_LOSSLESS_REQUIRED');
  }
  if (semantics.size) violation(result, 'AUDIO_SEMANTIC_STOP');

  const durationMax = rules.duration?.maxMs;
  if (Number.isFinite(durationMax) && metadata.durationMs > durationMax) {
    violation(result, 'AUDIO_DURATION_TOO_LONG', durationMax, metadata.durationMs);
    unfixable(result, 'AUDIO_DURATION_LIMIT_UNFIXABLE');
  }
  const durationMin = rules.duration?.minMs;
  if (Number.isFinite(durationMin) && metadata.durationMs < durationMin) {
    violation(result, 'AUDIO_DURATION_TOO_SHORT', durationMin, metadata.durationMs);
    unfixable(result, 'AUDIO_DURATION_LIMIT_UNFIXABLE');
  }

  const formatMismatch = !sourceAllowed(metadata, rules);
  const sizeMismatch = Number.isFinite(maxBytes) && metadata.size > maxBytes;
  const encodableSource = supportedAudioSource(metadata);
  if (formatMismatch) {
    violation(result, 'AUDIO_FORMAT_NOT_ALLOWED', formats, signatureMime);
    if (!mp3Allowed) unfixable(result, 'AUDIO_OUTPUT_FORMAT_NOT_ALLOWED');
    else if (encodableSource) {
      addUnique(result.safeAutoFixes,
        signatureMime === 'audio/mpeg' ? 'REENCODE_AUDIO' : 'TRANSCODE_AUDIO');
    }
    else unfixable(result, 'AUDIO_CODEC_UNSUPPORTED');
  }
  if (sizeMismatch) {
    violation(result, 'AUDIO_FILE_TOO_LARGE', maxBytes, metadata.size);
    if (!mp3Allowed) unfixable(result, 'AUDIO_OUTPUT_FORMAT_NOT_ALLOWED');
    else if (encodableSource) {
      addUnique(result.safeAutoFixes,
        signatureMime === 'audio/mpeg' ? 'REENCODE_AUDIO' : 'TRANSCODE_AUDIO');
    }
    else unfixable(result, 'AUDIO_CODEC_UNSUPPORTED');
  }

  const requiresTranscode = mp3Allowed && encodableSource && (formatMismatch || sizeMismatch);
  if (requiresTranscode && result.unfixable.length === 0) {
    addConfirmation(result, 'AUDIO_LOSSY_TRANSCODE', {
      fromMime: signatureMime,
      toMime: 'audio/mpeg',
      originalBytes: metadata.size,
      safeTargetBytes: Number.isFinite(maxBytes) ? Math.floor(maxBytes * 0.95) : null,
      bitrateKbps: null,
      channels: metadata.channels
    });
  }
  if (metadata.channels === 2 && options.targetChannels === 1) {
    addUnique(result.safeAutoFixes, 'DOWNMIX_MONO');
    addConfirmation(result, 'AUDIO_DOWNMIX_MONO', {
      fromMime: signatureMime,
      toMime: 'audio/mpeg',
      originalBytes: metadata.size,
      safeTargetBytes: Number.isFinite(maxBytes) ? Math.floor(maxBytes * 0.95) : null,
      bitrateKbps: null,
      channels: 1
    });
  }

  result.valid = result.violations.length === 0
    && result.requiredConfirmations.length === 0
    && result.unfixable.length === 0;
  return result;
}

export function isAudioPassthrough(metadata, rules, validation = validateAudioMetadata(metadata, rules)) {
  return Boolean(validation?.valid)
    && supportedAudioSource(metadata)
    && sourceAllowed(metadata, rules)
    && metadata.size <= rules.maxBytes;
}

export function pageAllowsMp3(rules) {
  return allowsMp3(rules);
}

export function isSupportedAudioMetadata(metadata) {
  return supportedAudioSource(metadata);
}

export { SUPPORTED_MIMES as SUPPORTED_AUDIO_MIMES, SUPPORTED_CONTAINERS as SUPPORTED_AUDIO_CONTAINERS };

function outputViolation(result, code, expected = null, actual = null) {
  if (!result.violations.some((item) => item.code === code)) {
    result.violations.push({ code, expected, actual });
  }
}

function outputResult() {
  return {
    valid: false,
    violations: [],
    warnings: [],
    safeAutoFixes: [],
    requiredConfirmations: [],
    unfixable: [],
    frameValidation: null
  };
}

function finiteDuration(value) {
  return Number.isFinite(value) && value > 0;
}

function outputFrameCount(metadata, options = {}) {
  if (metadata?.decoderSampling?.valid === true) return 3;
  if (Number.isFinite(metadata?.decodedFrames) && metadata.decodedFrames > 0) return 3;
  const candidates = [
    metadata?.representativeFrames,
    metadata?.parsedFrames,
    metadata?.frameCount,
    metadata?.frames
  ];
  const observed = candidates.filter((candidate) => Number.isFinite(candidate) && candidate >= 0);
  if (observed.length) return Math.max(...observed);
  if (metadata?.firstFrame || metadata?.audioOffset !== undefined) return 1;
  if (options.allowUninspectedFrames === true) return null;
  return 0;
}

/**
 * Validate an already-inspected MP3 record.  This is deliberately separate
 * from the encoder: callers can test or replace the encoder without making
 * it the authority for the final output decision.
 */
export function validateAudioOutput(metadata, rules, plan, sourceMetadata = null, options = {}) {
  const result = outputResult();
  if (!isRecord(metadata)) {
    outputViolation(result, 'AUDIO_METADATA_INVALID');
    result.unfixable.push('AUDIO_OUTPUT_VALIDATION_FAILED');
    return result;
  }
  const expectedMime = 'audio/mpeg';
  if (metadata.errorCode) outputViolation(result, metadata.errorCode);
  if (metadata.signatureMime !== expectedMime || metadata.container !== 'mp3'
    || metadata.codec !== 'mp3') {
    outputViolation(result, 'AUDIO_OUTPUT_FORMAT_NOT_ALLOWED', expectedMime, metadata.signatureMime);
  }
  const declaredOutputType = metadata.fileType ?? metadata.mime;
  if (options.requireFileType === true || declaredOutputType !== undefined) {
    if (declaredOutputType !== expectedMime) {
      outputViolation(result, 'AUDIO_OUTPUT_FORMAT_NOT_ALLOWED', expectedMime, declaredOutputType ?? null);
    }
  }

  const maxBytes = rules?.maxBytes;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    outputViolation(result, 'RULES_INSUFFICIENT');
    result.unfixable.push('RULES_INSUFFICIENT');
  } else if (!Number.isFinite(metadata.size) || metadata.size <= 0) {
    outputViolation(result, 'AUDIO_METADATA_INVALID', '> 0', metadata.size);
  } else if (metadata.size > maxBytes) {
    outputViolation(result, 'AUDIO_OUTPUT_TOO_LARGE', maxBytes, metadata.size);
  }

  if (!finiteDuration(metadata.durationMs)) {
    outputViolation(result, 'AUDIO_METADATA_INVALID', '> 0', metadata.durationMs);
  }
  const sourceDuration = sourceMetadata?.durationMs;
  if (finiteDuration(sourceDuration) && finiteDuration(metadata.durationMs)) {
    const tolerance = Number.isFinite(options.durationToleranceMs)
      ? Math.max(0, options.durationToleranceMs)
      : Math.max(250, sourceDuration * 0.02);
    if (Math.abs(metadata.durationMs - sourceDuration) > tolerance) {
      outputViolation(result, 'AUDIO_DURATION_MISMATCH', sourceDuration, metadata.durationMs);
    }
  }

  const targetSampleRate = plan?.targetSampleRate;
  if (Number.isFinite(targetSampleRate)
    && (!Number.isFinite(metadata.sampleRate) || metadata.sampleRate !== targetSampleRate)) {
    outputViolation(result, 'AUDIO_SAMPLE_RATE_MISMATCH', targetSampleRate, metadata.sampleRate ?? null);
  }
  const targetChannels = plan?.targetChannels;
  if ([1, 2].includes(targetChannels)
    && (!Number.isInteger(metadata.channels) || metadata.channels !== targetChannels)) {
    outputViolation(result, 'AUDIO_CHANNEL_MISMATCH', targetChannels, metadata.channels ?? null);
  }

  const frameCount = outputFrameCount(metadata, options);
  if (isRecord(metadata.frameValidation)) {
    result.frameValidation = { ...metadata.frameValidation };
  }
  if (frameCount !== null && frameCount < 2 && options.allowSingleFrame !== true) {
    outputViolation(result, 'AUDIO_NO_AUDIO_FRAMES', 2, frameCount);
  }
  if (metadata.frameValidation && metadata.frameValidation.valid !== true) {
    outputViolation(result, 'AUDIO_DECODE_FAILED');
  }
  for (const warning of metadata.warnings ?? []) {
    const code = typeof warning === 'string' ? warning : warning?.code;
    if (code && !result.warnings.some((item) => item.code === code)) result.warnings.push({ code });
  }
  if (Number.isFinite(plan?.safeTargetBytes)
    && Number.isFinite(metadata.size)
    && metadata.size > plan.safeTargetBytes
    && metadata.size <= maxBytes) {
    if (!result.warnings.some((item) => item.code === 'AUDIO_SAFETY_MARGIN_MISSED')) {
      result.warnings.push({ code: 'AUDIO_SAFETY_MARGIN_MISSED' });
    }
  }
  result.valid = result.violations.length === 0 && result.unfixable.length === 0;
  return result;
}

function representativeDecodeWorker() {
  self.onmessage = async (event) => {
    if (event.data?.type !== 'DECODE_MP3_WINDOWS') return;
    const results = [];
    let unclosedAudioData = 0;
    try {
      if (typeof AudioDecoder !== 'function' || typeof EncodedAudioChunk !== 'function') {
        throw new Error('WORKER_WEBCODECS_UNAVAILABLE');
      }
      for (const window of event.data.windows ?? []) {
        let decoder = null;
        let decoded = 0;
        try {
          decoder = new AudioDecoder({
            output(audioData) {
              unclosedAudioData += 1;
              decoded += 1;
              audioData.close();
              unclosedAudioData -= 1;
            },
            error() {}
          });
          const config = {
            codec: 'mp3',
            sampleRate: window.sampleRate,
            numberOfChannels: window.channels
          };
          const support = await AudioDecoder.isConfigSupported(config);
          if (!support?.supported) throw new Error('MP3_CONFIG_UNSUPPORTED');
          decoder.configure(config);
          const bytes = new Uint8Array(window.data);
          let offset = 0;
          let sampleOffset = 0;
          for (const frame of window.frames) {
            const data = bytes.subarray(offset, offset + frame.length);
            decoder.decode(new EncodedAudioChunk({
              type: 'key',
              timestamp: Math.round(sampleOffset * 1_000_000 / window.sampleRate),
              duration: Math.round(frame.samples * 1_000_000 / window.sampleRate),
              data
            }));
            offset += frame.length;
            sampleOffset += frame.samples;
          }
          await decoder.flush();
          if (decoded === 0) throw new Error('MP3_ZERO_OUTPUT');
          results.push({ decoded });
        } finally {
          if (decoder && decoder.state !== 'closed') decoder.close();
        }
      }
      self.postMessage({
        type: 'DECODE_RESULT',
        valid: results.length === (event.data.windows ?? []).length && results.length > 0,
        decodedWindows: results.length,
        decodedAudioData: results.reduce((sum, item) => sum + item.decoded, 0),
        unclosedAudioData
      });
    } catch (error) {
      self.postMessage({
        type: 'DECODE_RESULT', valid: false,
        decoderUnavailable: ['WORKER_WEBCODECS_UNAVAILABLE', 'MP3_CONFIG_UNSUPPORTED'].includes(error?.message),
        decodedWindows: results.length, decodedAudioData: 0, unclosedAudioData
      });
    }
  };
}

async function decodeRepresentativeWindows(windows, options = {}) {
  if (!windows.length || typeof Worker !== 'function'
    || typeof Blob !== 'function' || typeof URL?.createObjectURL !== 'function') {
    return { valid: false, decodedWindows: 0, decodedAudioData: 0, unclosedAudioData: 0, workerUsed: false };
  }
  if (options.signal?.aborted) {
    const error = new Error('Aborted');
    error.code = 'AUDIO_PROCESSING_CANCELLED';
    throw error;
  }
  const url = URL.createObjectURL(new Blob([
    `(${representativeDecodeWorker.toString()})();`
  ], { type: 'text/javascript' }));
  const worker = new Worker(url);
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const timeoutMs = Math.max(1000, Math.min(
        Number.isFinite(options.frameDecodeTimeoutMs) ? options.frameDecodeTimeoutMs : 5000,
        10_000
      ));
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener?.('abort', onAbort);
        callback(value);
      };
      const onAbort = () => {
        const error = new Error('Aborted');
        error.code = 'AUDIO_PROCESSING_CANCELLED';
        finish(reject, error);
      };
      const timer = setTimeout(() => finish(resolve, {
        valid: false, decodedWindows: 0, decodedAudioData: 0,
        unclosedAudioData: 0, workerUsed: true
      }), timeoutMs);
      worker.onmessage = (event) => {
        if (event.data?.type !== 'DECODE_RESULT') return;
        finish(resolve, {
          valid: event.data.valid === true,
          decoderUnavailable: event.data.decoderUnavailable === true,
          decodedWindows: Number.isFinite(event.data.decodedWindows) ? event.data.decodedWindows : 0,
          decodedAudioData: Number.isFinite(event.data.decodedAudioData) ? event.data.decodedAudioData : 0,
          unclosedAudioData: Number.isFinite(event.data.unclosedAudioData) ? event.data.unclosedAudioData : 0,
          workerUsed: true
        });
      };
      worker.onerror = () => finish(resolve, {
        valid: false, decodedWindows: 0, decodedAudioData: 0,
        unclosedAudioData: 0, workerUsed: true
      });
      options.signal?.addEventListener?.('abort', onAbort, { once: true });
      const transfer = windows.map((window) => window.data);
      worker.postMessage({ type: 'DECODE_MP3_WINDOWS', windows }, transfer);
    });
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}

async function inspectRepresentativeFrames(file, options = {}) {
  const size = Number.isFinite(file?.size) ? file.size : 0;
  if (!size || typeof file?.slice !== 'function') return { count: 0, valid: false };
  const defaultWindowBytes = Math.min(64 * 1024, Math.max(4096, Math.floor(size / 5)));
  const windowBytes = Math.min(size, Math.max(4096, Math.min(
    Number.isFinite(options.frameWindowBytes) ? options.frameWindowBytes : defaultWindowBytes,
    256 * 1024
  )));
  const starts = [...new Set([
    0,
    Math.max(0, Math.floor((size - windowBytes) / 2)),
    Math.max(0, size - windowBytes)
  ])];
  let count = 0;
  let valid = true;
  const windows = [];
  for (const start of starts) {
    if (options.signal?.aborted) {
      const error = new Error('Aborted');
      error.code = 'AUDIO_PROCESSING_CANCELLED';
      throw error;
    }
    try {
      const buffer = await file.slice(start, Math.min(size, start + windowBytes)).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (options.signal?.aborted) {
        const error = new Error('Aborted');
        error.code = 'AUDIO_PROCESSING_CANCELLED';
        throw error;
      }
      const frame = findMp3Frame(bytes, 0, bytes.length);
      if (!frame) {
        valid = false;
        continue;
      }
      const parsed = parseMp3Header(bytes, frame.offset);
      if (!parsed || frame.offset + parsed.frameLength > bytes.length) valid = false;
      let offset = frame.offset;
      let localCount = 0;
      const frames = [];
      const windowStart = offset;
      while (offset + 4 <= bytes.length && localCount < 8) {
        const candidate = parseMp3Header(bytes, offset);
        if (!candidate || offset + candidate.frameLength > bytes.length) break;
        frames.push({ length: candidate.frameLength, samples: candidate.samplesPerFrame });
        localCount += 1;
        offset += candidate.frameLength;
      }
      if (frames.length) {
        windows.push({
          data: bytes.slice(windowStart, offset).buffer,
          frames,
          sampleRate: parsed.sampleRate,
          channels: parsed.channels
        });
      }
      count += Math.max(1, localCount);
    } catch (error) {
      if (error?.code === 'AUDIO_PROCESSING_CANCELLED') throw error;
      valid = false;
    }
  }
  const decoded = valid
    ? await decodeRepresentativeWindows(windows, options)
    : { valid: false, decodedWindows: 0, decodedAudioData: 0, unclosedAudioData: 0, workerUsed: false };
  return {
    count,
    valid: valid && decoded.valid,
    headerValid: valid,
    decodeValid: decoded.valid,
    decoderUnavailable: decoded.decoderUnavailable === true,
    representativeWindows: windows.length,
    decodedWindows: decoded.decodedWindows,
    decodedAudioData: decoded.decodedAudioData,
    unclosedAudioData: decoded.unclosedAudioData,
    workerUsed: decoded.workerUsed
  };
}

/** Inspect a File/Blob and then run the independent final output validator. */
export async function validateAudioOutputFile(file, rules, plan, sourceMetadata = null, options = {}) {
  const result = outputResult();
  if (!file || typeof file !== 'object' || !Number.isFinite(file.size) || file.size <= 0) {
    outputViolation(result, 'AUDIO_METADATA_INVALID');
    return result;
  }
  let metadata;
  try {
    metadata = await inspectAudio(file, { signal: options.signal });
  } catch (error) {
    outputViolation(result, error?.code ?? 'AUDIO_DECODE_FAILED');
    return result;
  }
  const frameValidation = await inspectRepresentativeFrames(file, options);
  const enriched = {
    ...metadata,
    fileType: typeof file.type === 'string' ? file.type.toLowerCase() : metadata.fileType,
    frameValidation,
    representativeFrames: frameValidation.count
  };
  return validateAudioOutput(enriched, rules, plan, sourceMetadata, {
    ...options,
    requireFileType: true
  });
}

export const validateAudioOutputMetadata = validateAudioOutput;
