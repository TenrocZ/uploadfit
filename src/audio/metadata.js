import { AUDIO_METADATA_READ_LIMIT } from '../config.js';
import { AudioMetadataError } from './errors.js';
import {
  detectAudioSignature,
  parseMp3Header,
  parseM4aSignature
} from './signatures.js';

const AUDIO_MIME_BY_EXTENSION = Object.freeze({
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  webm: 'audio/webm'
});

function safeSize(file) {
  return Number.isFinite(file?.size) && file.size >= 0 ? file.size : null;
}

function declaredType(file) {
  return typeof file?.type === 'string' && file.type.trim()
    ? file.type.trim().toLowerCase().split(';', 1)[0]
    : null;
}

function extensionOf(file) {
  const name = typeof file?.name === 'string' ? file.name : '';
  const match = name.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw new AudioMetadataError('AUDIO_PROCESSING_CANCELLED');
}

async function readRange(file, start, end, state, signal) {
  throwIfAborted(signal);
  if (typeof file?.slice !== 'function' || !Number.isFinite(start) || !Number.isFinite(end)
    || start < 0 || end < start) throw new AudioMetadataError('AUDIO_DECODE_FAILED');
  const length = end - start;
  if (state.read + length > state.limit) {
    throw new AudioMetadataError('AUDIO_MEMORY_BUDGET_EXCEEDED');
  }
  const blob = file.slice(start, end);
  if (typeof blob?.arrayBuffer !== 'function') throw new AudioMetadataError('AUDIO_DECODE_FAILED');
  const buffer = await blob.arrayBuffer();
  throwIfAborted(signal);
  const bytes = new Uint8Array(buffer);
  state.read += bytes.byteLength;
  return bytes;
}

async function readBounded(file, limit, signal) {
  const size = safeSize(file);
  if (size === null) throw new AudioMetadataError('AUDIO_DECODE_FAILED');
  const state = { read: 0, limit };
  if (size <= limit) {
    const bytes = await readRange(file, 0, size, state, signal);
    return { bytes, head: bytes, tail: null, inspectedBytes: state.read };
  }
  const headLength = Math.floor(limit / 2);
  const tailLength = limit - headLength;
  const head = await readRange(file, 0, headLength, state, signal);
  const tail = await readRange(file, size - tailLength, size, state, signal);
  return { bytes: null, head, tail, inspectedBytes: state.read };
}

function baseMetadata(file, fields = {}) {
  return {
    mediaKind: 'audio',
    fileType: declaredType(file),
    signatureMime: null,
    container: null,
    codec: null,
    size: safeSize(file) ?? 0,
    durationMs: null,
    sampleRate: null,
    channels: null,
    bitDepth: null,
    averageBitrate: null,
    variableBitrate: null,
    seekable: false,
    inspectedBytes: 0,
    errorCode: null,
    warnings: [],
    ...fields
  };
}

function uniqueWarnings(warnings) {
  return [...new Set((warnings ?? [])
    .map((item) => typeof item === 'string' ? item : item?.code)
    .filter((code) => typeof code === 'string' && code))]
    .map((code) => ({ code }));
}

function inspectDeclaredConsistency(file, signatureMime, warnings) {
  const type = declaredType(file);
  if (type && signatureMime && type !== signatureMime) warnings.push('AUDIO_MIME_SIGNATURE_MISMATCH');
  const extension = extensionOf(file);
  const expected = extension ? AUDIO_MIME_BY_EXTENSION[extension] : null;
  if (expected && signatureMime && expected !== signatureMime) {
    warnings.push('AUDIO_EXTENSION_SIGNATURE_MISMATCH');
  }
}

function scanMp3Frames(bytes, firstFrame, fileSize) {
  if (!(bytes instanceof Uint8Array) || !firstFrame) return {
    complete: false, frameCount: 0, samples: 0, bitrates: []
  };
  const bitrates = [];
  let offset = firstFrame.offset;
  let frameCount = 0;
  let samples = 0;
  let lastEnd = offset;
  while (offset + 4 <= bytes.length && frameCount < 250000) {
    const frame = parseMp3Header(bytes, offset);
    if (!frame || offset + frame.frameLength > bytes.length) break;
    frameCount += 1;
    samples += frame.samplesPerFrame;
    if (!bitrates.includes(frame.bitrateKbps)) bitrates.push(frame.bitrateKbps);
    lastEnd = offset + frame.frameLength;
    offset = lastEnd;
  }
  const trailingId3 = fileSize >= 128 && bytes.length === fileSize
    && bytes.length >= 128
    && String.fromCharCode(...bytes.slice(bytes.length - 128, bytes.length - 125)) === 'TAG';
  const complete = bytes.length === fileSize
    && (lastEnd >= fileSize - (trailingId3 ? 128 : 0));
  return { complete, frameCount, samples, bitrates, lastEnd };
}

function enrichMp3Metadata(file, readResult, signature, warnings) {
  const bytes = readResult.bytes ?? readResult.head;
  const frame = signature.firstFrame;
  const scan = scanMp3Frames(bytes, frame, safeSize(file));
  const indexedFrames = signature.xing?.frames ?? signature.vbri?.frames ?? null;
  const isVbr = Boolean(signature.variableBitrate || scan.bitrates.length > 1);
  let durationMs = null;
  if (indexedFrames && Number.isFinite(indexedFrames) && indexedFrames > 0) {
    durationMs = (indexedFrames * frame.samplesPerFrame / frame.sampleRate) * 1000;
  } else if (scan.complete && scan.samples > 0) {
    durationMs = (scan.samples / frame.sampleRate) * 1000;
  } else if (!isVbr && frame.bitrateKbps > 0) {
    const trailingId3 = safeSize(file) >= 128 && (safeSize(file) ?? 0) > bytes.length
      ? 128
      : 0;
    const audioBytes = Math.max(0, (safeSize(file) ?? 0) - signature.audioOffset - trailingId3);
    durationMs = (audioBytes * 8 / (frame.bitrateKbps * 1000)) * 1000;
  } else {
    warnings.push('MP3_VBR_INDEX_UNAVAILABLE');
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { errorCode: 'AUDIO_METADATA_INVALID' };
  }
  const audioBytes = Math.max(0, (safeSize(file) ?? 0) - signature.audioOffset);
  const averageBitrate = Math.round((audioBytes * 8 * 1000) / durationMs);
  return {
    ...signature,
    durationMs,
    averageBitrate: Number.isFinite(averageBitrate) && averageBitrate > 0
      ? averageBitrate
      : frame.bitrateKbps * 1000,
    variableBitrate: isVbr,
    seekable: true
  };
}

/**
 * Inspect a supported audio container using at most AUDIO_METADATA_READ_LIMIT
 * bytes by default.  The returned object is a safe metadata record: it never
 * contains a File, Blob, name, tags, PCM or raw bytes.
 */
export async function inspectAudio(file, options = {}) {
  const signal = options.signal;
  throwIfAborted(signal);
  const size = safeSize(file);
  if (size === null || size <= 0) {
    return Object.freeze(baseMetadata(file, { errorCode: 'AUDIO_DECODE_FAILED' }));
  }
  const limit = Number.isInteger(options.maxReadBytes) && options.maxReadBytes > 0
    ? Math.min(options.maxReadBytes, AUDIO_METADATA_READ_LIMIT)
    : AUDIO_METADATA_READ_LIMIT;
  let readResult;
  try {
    readResult = await readBounded(file, limit, signal);
  } catch (error) {
    if (error?.code === 'AUDIO_PROCESSING_CANCELLED') throw error;
    return Object.freeze(baseMetadata(file, {
      inspectedBytes: error?.details?.inspectedBytes ?? 0,
      errorCode: error?.code ?? 'AUDIO_DECODE_FAILED'
    }));
  }
  throwIfAborted(signal);
  const warnings = [];
  const source = readResult.bytes ?? readResult.head;
  let signature;
  try {
    signature = detectAudioSignature(source, size);
    if (source?.[4] === 0x66 && source?.[5] === 0x74 && source?.[6] === 0x79 && source?.[7] === 0x70) {
      signature = parseM4aSignature({ head: readResult.head, tail: readResult.tail }, size);
    }
    if (signature?.signatureMime === 'audio/mpeg') {
      signature = enrichMp3Metadata(file, readResult, signature, warnings);
    }
  } catch (error) {
    signature = { errorCode: error?.code ?? 'AUDIO_METADATA_INVALID' };
  }
  if (!signature?.signatureMime) {
    return Object.freeze(baseMetadata(file, {
      inspectedBytes: readResult.inspectedBytes,
      errorCode: signature?.errorCode ?? 'AUDIO_CODEC_UNSUPPORTED',
      warnings: uniqueWarnings(warnings)
    }));
  }
  inspectDeclaredConsistency(file, signature.signatureMime, warnings);
  const errorCode = signature.errorCode
    ?? (!Number.isFinite(signature.durationMs) || signature.durationMs <= 0
      ? 'AUDIO_METADATA_INVALID'
      : null);
  return Object.freeze(baseMetadata(file, {
    ...signature,
    fileType: declaredType(file),
    size,
    inspectedBytes: readResult.inspectedBytes,
    errorCode,
    warnings: uniqueWarnings([...warnings, ...(signature.warnings ?? [])])
  }));
}

/** Safe UI/controller projection; deliberately excludes File/name/raw data. */
export function audioMetadataSnapshot(metadata, progress = 0) {
  if (!metadata || typeof metadata !== 'object') return null;
  const ratio = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return {
    mediaKind: 'audio',
    mime: metadata.signatureMime ?? metadata.fileType ?? null,
    container: metadata.container ?? null,
    codec: metadata.codec ?? null,
    size: Number.isFinite(metadata.size) ? metadata.size : null,
    durationMs: Number.isFinite(metadata.durationMs) ? metadata.durationMs : null,
    sampleRate: Number.isFinite(metadata.sampleRate) ? metadata.sampleRate : null,
    channels: Number.isFinite(metadata.channels) ? metadata.channels : null,
    bitrateKbps: Number.isFinite(metadata.averageBitrate)
      ? Math.round(metadata.averageBitrate / 1000)
      : null,
    progress: ratio,
    errorCode: metadata.errorCode ?? null
  };
}

export function audioFileTypeForExtension(extension) {
  return AUDIO_MIME_BY_EXTENSION[String(extension ?? '').toLowerCase()] ?? null;
}

export { readBounded as readBoundedAudioBytes };
