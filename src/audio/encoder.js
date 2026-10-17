/* Local PCM-to-MP3 encoder, bundled into the production audio Worker. */

import { Mp3Encoder } from 'lamejs/lame.min.js';
import { parseWavChunks } from './signatures.js';
import { S0_RESOURCE_LIMITS } from './capabilities.js';

const BITRATE_LADDER = Object.freeze([48, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]);
const PCM_BYTES_PER_SAMPLE = Object.freeze({ 16: 2, 24: 3, 32: 4 });
const DEFAULT_INPUT_CHUNK_BYTES = 256 * 1024;

function abortError(details = {}) {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  error.code = 'AUDIO_PROCESSING_CANCELLED';
  Object.assign(error, details);
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function clamp16(value) {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

function readPcmSample(view, offset, bitDepth) {
  if (bitDepth === 16) return view.getInt16(offset, true);
  if (bitDepth === 24) {
    let value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
    if (value & 0x800000) value |= 0xff000000;
    return value >> 8;
  }
  return view.getInt32(offset, true) >> 16;
}

function convertPcmChunk(bytes, channels, bitDepth, targetChannels) {
  const bytesPerSample = PCM_BYTES_PER_SAMPLE[bitDepth];
  const blockAlign = channels * bytesPerSample;
  const frameCount = Math.floor(bytes.byteLength / blockAlign);
  const view = new DataView(bytes.buffer, bytes.byteOffset, frameCount * blockAlign);
  if (targetChannels === 1) {
    const mono = new Int16Array(frameCount);
    for (let frame = 0; frame < frameCount; frame += 1) {
      let sum = 0;
      const frameOffset = frame * blockAlign;
      for (let channel = 0; channel < channels; channel += 1) {
        sum += readPcmSample(view, frameOffset + channel * bytesPerSample, bitDepth);
      }
      mono[frame] = clamp16(sum / channels);
    }
    return { left: mono, right: mono };
  }
  const left = new Int16Array(frameCount);
  const right = new Int16Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = frame * blockAlign;
    left[frame] = clamp16(readPcmSample(view, frameOffset, bitDepth));
    right[frame] = clamp16(readPcmSample(view, frameOffset + (channels > 1 ? bytesPerSample : 0), bitDepth));
  }
  return { left, right };
}

async function readWavHeader(file, signal) {
  throwIfAborted(signal);
  const size = Number.isFinite(file?.size) ? file.size : 0;
  const limit = Math.min(S0_RESOURCE_LIMITS.metadataReadLimitBytes, size);
  const buffer = await file.slice(0, limit).arrayBuffer();
  throwIfAborted(signal);
  const signature = parseWavChunks(new Uint8Array(buffer), size);
  if (signature?.signatureMime !== 'audio/wav') {
    const error = new Error(signature?.errorCode ?? 'AUDIO_CODEC_UNSUPPORTED');
    error.code = signature?.errorCode ?? 'AUDIO_CODEC_UNSUPPORTED';
    throw error;
  }
  return signature;
}

function choosePlan(signature, maxBytes, targetChannels) {
  const safeTargetBytes = Math.min(S0_RESOURCE_LIMITS.safeOutputBytes, maxBytes - 64 * 1024);
  const durationMs = signature.durationMs;
  const maxBitrateKbps = (safeTargetBytes * 8 * 1000) / durationMs;
  const bitrateKbps = [...BITRATE_LADDER].reverse().find((value) => value <= maxBitrateKbps) ?? null;
  if (!bitrateKbps || bitrateKbps < S0_RESOURCE_LIMITS.minimumBitrateKbps) {
    const error = new Error('AUDIO_OUTPUT_BUDGET_IMPOSSIBLE');
    error.code = 'AUDIO_OUTPUT_BUDGET_IMPOSSIBLE';
    throw error;
  }
  const estimatedBytes = Math.ceil((durationMs / 1000) * bitrateKbps * 1000 / 8);
  return {
    maxBytes,
    safeTargetBytes,
    bitrateKbps,
    targetChannels,
    estimatedBytes,
    durationMs,
    sampleRate: signature.sampleRate,
    sourceChannels: signature.channels
  };
}

/**
 * S2 adapter entry point: when the pipeline supplies the planner-authoritative
 * bitrate, use it directly.  The S0 probe keeps its internal chooser when the
 * option is absent, so probe behaviour is unchanged.
 */
function choosePlanFor(signature, maxBytes, targetChannels, bitrateKbps) {
  if (!Number.isFinite(bitrateKbps) || bitrateKbps <= 0) {
    return choosePlan(signature, maxBytes, targetChannels);
  }
  return {
    maxBytes,
    safeTargetBytes: Math.min(S0_RESOURCE_LIMITS.safeOutputBytes, maxBytes - 64 * 1024),
    bitrateKbps,
    targetChannels,
    estimatedBytes: Math.ceil((signature.durationMs / 1000) * bitrateKbps * 1000 / 8),
    durationMs: signature.durationMs,
    sampleRate: signature.sampleRate,
    sourceChannels: signature.channels
  };
}

function progressEvent(cursor, end, plan) {
  return {
    phase: 'encode',
    processedBytes: cursor - plan.audioOffset,
    totalBytes: plan.audioBytes,
    ratio: plan.audioBytes > 0 ? Math.min(1, (cursor - plan.audioOffset) / plan.audioBytes) : 1
  };
}

/**
 * Shared bounded PCM -> frozen lamejs session. WAV and S4.1 decoded inputs
 * use this exact collector/flush path so the encoder contract cannot drift.
 */
export function createMp3EncoderSession(options = {}) {
  const signal = options.signal;
  const channels = options.channels === 2 ? 2 : 1;
  const sampleRate = Number(options.sampleRate);
  const bitrateKbps = Number(options.bitrateKbps);
  if (![8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000].includes(sampleRate)
    || !BITRATE_LADDER.includes(bitrateKbps)) {
    const error = new Error('AUDIO_CODEC_UNSUPPORTED');
    error.code = 'AUDIO_CODEC_UNSUPPORTED';
    throw error;
  }
  const maxOutputBytes = Math.min(
    S0_RESOURCE_LIMITS.hardOutputBytes,
    Number.isFinite(options.maxOutputBytes) && options.maxOutputBytes > 0
      ? Math.floor(options.maxOutputBytes)
      : S0_RESOURCE_LIMITS.hardOutputBytes
  );
  const encoder = new Mp3Encoder(channels, sampleRate, bitrateKbps);
  const collectOutput = options.collectOutput !== false;
  const chunks = [];
  const pendingCallbacks = [];
  let outputBytes = 0;
  let maxChunkBytes = 0;
  let finished = false;

  const emit = (encoded) => {
    if (!encoded?.byteLength) return;
    const chunk = new Uint8Array(encoded);
    outputBytes += chunk.byteLength;
    maxChunkBytes = Math.max(maxChunkBytes, chunk.byteLength);
    if (outputBytes > maxOutputBytes) {
      const error = new Error('AUDIO_OUTPUT_SIZE_INVALID');
      error.code = 'AUDIO_OUTPUT_SIZE_INVALID';
      throw error;
    }
    if (collectOutput) chunks.push(chunk);
    const callback = options.onChunk?.(chunk);
    if (callback && typeof callback.then === 'function') pendingCallbacks.push(callback);
  };

  return Object.freeze({
    encode(left, right = left) {
      throwIfAborted(signal);
      if (finished || !(left instanceof Int16Array) || !(right instanceof Int16Array)
        || left.length !== right.length) {
        const error = new Error('AUDIO_ENCODE_FAILED');
        error.code = 'AUDIO_ENCODE_FAILED';
        throw error;
      }
      emit(encoder.encodeBuffer(left, channels === 2 ? right : left));
    },
    async finish() {
      throwIfAborted(signal);
      if (finished) {
        const error = new Error('AUDIO_ENCODE_FAILED');
        error.code = 'AUDIO_ENCODE_FAILED';
        throw error;
      }
      finished = true;
      emit(encoder.flush());
      if (pendingCallbacks.length) await Promise.all(pendingCallbacks);
      const blob = collectOutput ? new Blob(chunks, { type: 'audio/mpeg' }) : null;
      if (collectOutput && (!blob.size || blob.size !== outputBytes)) {
        const error = new Error('AUDIO_ENCODE_FAILED');
        error.code = 'AUDIO_ENCODE_FAILED';
        throw error;
      }
      return {
        blob,
        outputBytes,
        bufferedOutputBytes: collectOutput ? outputBytes : maxChunkBytes
      };
    },
    get outputBytes() { return outputBytes; },
    get channels() { return channels; },
    get sampleRate() { return sampleRate; },
    get bitrateKbps() { return bitrateKbps; }
  });
}

/** Encode a PCM WAV through bounded slices. It does not create a Worker itself. */
export async function encodeWavToMp3(file, options = {}) {
  const signal = options.signal;
  const targetChannels = options.targetChannels === 2 ? 2 : 1;
  const enforceMaxBytes = options.enforceMaxBytes !== false;
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : S0_RESOURCE_LIMITS.hardOutputBytes;
  const inputChunkBytes = Math.min(
    Number.isFinite(options.inputChunkBytes) ? options.inputChunkBytes : DEFAULT_INPUT_CHUNK_BYTES,
    S0_RESOURCE_LIMITS.inputChunkBytes
  );
  const signature = await readWavHeader(file, signal);
  const plan = {
    ...choosePlanFor(signature, maxBytes, targetChannels, options.bitrateKbps),
    audioOffset: signature.audioOffset,
    audioBytes: signature.audioBytes
  };
  let inputBytesRead = Math.min(S0_RESOURCE_LIMITS.metadataReadLimitBytes, Number.isFinite(file?.size) ? file.size : 0);
  const bytesPerSample = PCM_BYTES_PER_SAMPLE[signature.bitDepth];
  const blockAlign = signature.channels * bytesPerSample;
  const chunkBytes = Math.max(blockAlign, inputChunkBytes - (inputChunkBytes % blockAlign));
  const collectOutput = options.collectOutput !== false;
  let outputBytes = 0;
  let peakBufferedBytes = 0;
  let peakPcmBytes = 0;
  let lastProgressAt = -Infinity;
  const report = async (event, force = false) => {
    const now = (globalThis.performance?.now?.() ?? Date.now());
    if (!force && now - lastProgressAt < S0_RESOURCE_LIMITS.progressIntervalMs) return;
    lastProgressAt = now;
    await options.onProgress?.(event);
  };
  const session = createMp3EncoderSession({
    channels: targetChannels,
    sampleRate: signature.sampleRate,
    bitrateKbps: plan.bitrateKbps,
    signal,
    maxOutputBytes: S0_RESOURCE_LIMITS.hardOutputBytes,
    collectOutput,
    onChunk: options.onChunk
  });

  let cursor = signature.audioOffset;
  const end = signature.audioOffset + signature.audioBytes;
  while (cursor < end) {
    throwIfAborted(signal);
    const next = Math.min(end, cursor + chunkBytes);
    const buffer = await file.slice(cursor, next).arrayBuffer();
    throwIfAborted(signal);
    const raw = new Uint8Array(buffer);
    inputBytesRead += raw.byteLength;
    const pcm = convertPcmChunk(raw, signature.channels, signature.bitDepth, targetChannels);
    peakPcmBytes = Math.max(peakPcmBytes, raw.byteLength + pcm.left.byteLength + (targetChannels === 2 ? pcm.right.byteLength : 0));
    peakBufferedBytes = Math.max(peakBufferedBytes, peakPcmBytes + (collectOutput ? outputBytes : 0));
    session.encode(pcm.left, pcm.right);
    outputBytes = session.outputBytes;
    peakBufferedBytes = Math.max(
      peakBufferedBytes,
      collectOutput ? outputBytes : Math.max(pcm.left.byteLength, pcm.right.byteLength)
    );
    cursor = next;
    await report({
      ...progressEvent(cursor, end, { ...plan, audioOffset: signature.audioOffset, audioBytes: signature.audioBytes }),
      peakPcmBytes
    });
  }
  const encodedResult = await session.finish();
  outputBytes = encodedResult.outputBytes;
  await report(progressEvent(end, end, plan), true);
  if (!collectOutput) {
    return {
      blob: null,
      plan,
      outputBytes,
      peakBufferedBytes,
      peakPcmBytes,
      inputBytesRead,
      encodePasses: 1
    };
  }
  const blob = encodedResult.blob;
  // A caller-supplied page max is deliberately optional for the S2 adapter;
  // the pipeline owns that decision.  The frozen S0 hard ceiling remains a
  // memory/output safety bound even when page-max enforcement is disabled.
  if (blob.size <= 0
    || blob.size > S0_RESOURCE_LIMITS.hardOutputBytes
    || (enforceMaxBytes && blob.size > maxBytes)) {
    const error = new Error('AUDIO_OUTPUT_SIZE_INVALID');
    error.code = 'AUDIO_OUTPUT_SIZE_INVALID';
    throw error;
  }
  return { blob, plan, outputBytes: blob.size, peakBufferedBytes, peakPcmBytes, inputBytesRead, encodePasses: 1 };
}
