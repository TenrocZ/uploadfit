/*
 * Isolated S0 encoder prototype.  This file is intentionally imported only by
 * scripts/audio-probe/probe-entry.js and the inline Worker entry; production
 * UploadFit does not depend on it.
 */

import { Mp3Encoder } from 'lamejs/lame.min.js';
import { inspectAudio } from '../../src/audio/metadata.js';
import { parseMp3Header, parseWavChunks } from '../../src/audio/signatures.js';
import { S0_RESOURCE_LIMITS } from '../../src/audio/capabilities.js';

export const MP3_ENCODER_DESCRIPTOR = Object.freeze({
  package: 'lamejs',
  version: '1.2.1',
  source: 'https://github.com/zhuker/lamejs',
  licenseSpdx: 'LGPL-3.0',
  licenseNotice: 'docs/evidence/V2-S0/licenses/lamejs-1.2.1-LICENSE.txt',
  dependencyNotice: 'docs/evidence/V2-S0/licenses/use-strict-1.0.1-LICENSE.txt',
  api: 'Mp3Encoder.encodeBuffer(Int16Array[, Int16Array]) + flush()',
  streaming: true,
  workerCompatible: true
});

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

/** Encode a PCM WAV through bounded slices. It does not create a Worker itself. */
export async function encodeWavToMp3(file, options = {}) {
  const signal = options.signal;
  const targetChannels = options.targetChannels === 2 ? 2 : 1;
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
  const encoder = new Mp3Encoder(targetChannels, signature.sampleRate, plan.bitrateKbps);
  const collectOutput = options.collectOutput !== false;
  const chunks = [];
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
  const emit = async (encoded) => {
    if (!encoded?.byteLength) return;
    const chunk = new Uint8Array(encoded);
    outputBytes += chunk.byteLength;
    if (collectOutput) {
      chunks.push(chunk);
      peakBufferedBytes = Math.max(peakBufferedBytes, outputBytes);
    } else {
      peakBufferedBytes = Math.max(peakBufferedBytes, chunk.byteLength);
    }
    await options.onChunk?.(chunk);
  };

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
    await emit(encoder.encodeBuffer(pcm.left, pcm.right));
    cursor = next;
    await report({
      ...progressEvent(cursor, end, { ...plan, audioOffset: signature.audioOffset, audioBytes: signature.audioBytes }),
      peakPcmBytes
    });
  }
  await emit(encoder.flush());
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
  const blob = new Blob(chunks, { type: 'audio/mpeg' });
  if (blob.size > maxBytes || blob.size <= 0) {
    const error = new Error('AUDIO_OUTPUT_SIZE_INVALID');
    error.code = 'AUDIO_OUTPUT_SIZE_INVALID';
    throw error;
  }
  return { blob, plan, outputBytes: blob.size, peakBufferedBytes, peakPcmBytes, inputBytesRead, encodePasses: 1 };
}

async function verifyMp3Blob(blob, globalRef = globalThis, signal) {
  throwIfAborted(signal);
  const metadata = await inspectAudio(blob);
  throwIfAborted(signal);
  const result = {
    signatureMime: metadata.signatureMime ?? null,
    durationMs: Number.isFinite(metadata.durationMs) ? metadata.durationMs : null,
    sampleRate: metadata.sampleRate ?? null,
    channels: metadata.channels ?? null,
    decodable: false,
    decoder: 'not-run',
    decodedFrames: 0,
    parsedFrames: 0,
    decodedFrameSampleLimit: 1,
    errorName: metadata.errorCode ?? null
  };
  if (metadata.signatureMime !== 'audio/mpeg' || !metadata.firstFrame) return result;
  if (typeof globalRef.AudioDecoder !== 'function' || typeof globalRef.EncodedAudioChunk !== 'function') {
    result.decoder = 'WebCodecs-unavailable';
    return result;
  }
  result.decoder = 'WebCodecs-AudioDecoder';
  let decoderError = null;
  let decodedFrames = 0;
  let parsedFrames = 0;
  const decodeFrameSampleLimit = 1;
  const decoder = new globalRef.AudioDecoder({
    output: (audioData) => {
      decodedFrames += Number(audioData?.numberOfFrames ?? 0);
      audioData?.close?.();
    },
    error: (error) => { decoderError = error; }
  });
  try {
    decoder.configure({
      codec: 'mp3',
      sampleRate: metadata.sampleRate,
      numberOfChannels: metadata.channels
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let offset = metadata.audioOffset ?? 0;
    let timestamp = 0;
    while (offset + 4 <= bytes.length) {
      throwIfAborted(signal);
      const frame = parseMp3Header(bytes, offset);
      if (!frame || offset + frame.frameLength > bytes.length) break;
      const duration = (frame.samplesPerFrame / frame.sampleRate) * 1_000_000;
      if (parsedFrames < decodeFrameSampleLimit) {
        decoder.decode(new globalRef.EncodedAudioChunk({
          type: 'key',
          timestamp,
          duration,
          data: bytes.slice(offset, offset + frame.frameLength)
        }));
      }
      timestamp += duration;
      offset += frame.frameLength;
      parsedFrames += 1;
      // Keep the page heartbeat responsive while independently decoding a
      // large output. A microtask is not enough here; yield to the timer queue.
      if ((parsedFrames & 0x3ff) === 0) {
        await new Promise((resolve) => globalRef.setTimeout(resolve, 0));
      }
    }
    // Decode a bounded first-frame sample and wait briefly for output. Full
    // stream duration is independently checked by the frame scan above; a
    // large-output AudioDecoder.flush() can block a Tabbit renderer for tens
    // of seconds and would make cancellation unobservable.
    const deadline = (globalRef.performance?.now?.() ?? Date.now()) + 1000;
    while (decodedFrames === 0 && !decoderError
      && (globalRef.performance?.now?.() ?? Date.now()) < deadline) {
      throwIfAborted(signal);
      await new Promise((resolve) => globalRef.setTimeout(resolve, 25));
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    decoderError = error;
  } finally {
    try { decoder.close(); } catch {}
  }
  result.decodedFrames = decodedFrames;
  result.parsedFrames = parsedFrames;
  result.decodable = !decoderError && decodedFrames > 0;
  result.errorName = decoderError?.name ?? (result.decodable ? null : 'AUDIO_DECODE_FAILED');
  return result;
}

async function sha256Blob(blob, globalRef = globalThis) {
  if (typeof globalRef.crypto?.subtle?.digest !== 'function') return null;
  const digest = await globalRef.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function encodeWavToMp3InWorker(file, options = {}) {
  const globalRef = options.globalRef ?? globalThis;
  const workerSource = options.workerSource;
  if (typeof globalRef.Worker !== 'function' || typeof globalRef.Blob !== 'function'
    || typeof globalRef.URL?.createObjectURL !== 'function' || !workerSource) {
    const direct = await encodeWavToMp3(file, { ...options, globalRef });
    return {
      ...direct,
      workerUsed: false,
      verification: await verifyMp3Blob(direct.blob, globalRef, options.signal),
      outputSha256: await sha256Blob(direct.blob, globalRef),
      cleanup: { workerTerminated: false, objectUrlRevoked: false }
    };
  }
  const signal = options.signal;
  throwIfAborted(signal);
  const workerUrl = globalRef.URL.createObjectURL(new globalRef.Blob([workerSource], { type: 'text/javascript' }));
  const worker = new globalRef.Worker(workerUrl);
  const chunks = [];
  let outputBytes = 0;
  let peakBufferedBytes = 0;
  let peakPcmBytes = 0;
  let progress = null;
  let settled = false;
  let heartbeatTimer = null;
  let lastHeartbeat = globalRef.performance?.now?.() ?? Date.now();
  let maxHeartbeatGapMs = 0;
  let rejectPending = null;
  let cancelRequestedAt = null;
  const cleanupState = { workerTerminated: false, objectUrlRevoked: false };
  const cleanup = () => {
    if (heartbeatTimer) globalRef.clearInterval(heartbeatTimer);
    worker.terminate();
    cleanupState.workerTerminated = true;
    globalRef.URL.revokeObjectURL(workerUrl);
    cleanupState.objectUrlRevoked = true;
  };
  const abort = () => {
    if (settled) return;
    cancelRequestedAt = globalRef.performance?.now?.() ?? Date.now();
    settled = true;
    cleanup();
    const settledAt = globalRef.performance?.now?.() ?? Date.now();
    rejectPending?.(abortError({
      cleanup: { ...cleanupState },
      cancelLatencyMs: Math.max(0, settledAt - cancelRequestedAt)
    }));
  };
  const abortListener = () => abort();
  signal?.addEventListener?.('abort', abortListener, { once: true });
  heartbeatTimer = globalRef.setInterval(() => {
    const now = globalRef.performance?.now?.() ?? Date.now();
    maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastHeartbeat);
  }, 100);
  try {
    const result = await new Promise((resolve, reject) => {
      rejectPending = reject;
      worker.onmessage = (event) => {
        const data = event.data ?? {};
        if (data.type === 'chunk' && data.buffer) {
          const chunk = new Uint8Array(data.buffer);
          chunks.push(chunk);
          outputBytes += chunk.byteLength;
          peakBufferedBytes = Math.max(peakBufferedBytes, outputBytes);
        } else if (data.type === 'progress') {
          progress = data.progress;
          lastHeartbeat = globalRef.performance?.now?.() ?? Date.now();
          options.onProgress?.(progress);
          if (Number.isFinite(data.peakPcmBytes)) peakPcmBytes = Math.max(peakPcmBytes, data.peakPcmBytes);
        } else if (data.type === 'done') {
          const now = globalRef.performance?.now?.() ?? Date.now();
          maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastHeartbeat);
          if (heartbeatTimer) globalRef.clearInterval(heartbeatTimer);
          heartbeatTimer = null;
          resolve(data.result);
        } else if (data.type === 'error') {
          const error = new Error(data.message ?? 'AUDIO_WORKER_FAILED');
          error.name = data.errorName ?? 'Error';
          reject(error);
        }
      };
      worker.onerror = (error) => reject(error instanceof Error ? error : new Error('AUDIO_WORKER_FAILED'));
      worker.postMessage({
        file,
        options: {
          maxBytes: options.maxBytes,
          targetChannels: options.targetChannels,
          inputChunkBytes: options.inputChunkBytes
        }
      });
    });
    if (settled) throw abortError();
    const blob = new globalRef.Blob(chunks, { type: 'audio/mpeg' });
    if (blob.size > (options.maxBytes ?? S0_RESOURCE_LIMITS.hardOutputBytes)) {
      const error = new Error('AUDIO_OUTPUT_SIZE_INVALID');
      error.code = 'AUDIO_OUTPUT_SIZE_INVALID';
      throw error;
    }
    throwIfAborted(signal);
    const verification = await verifyMp3Blob(blob, globalRef, signal);
    throwIfAborted(signal);
    return {
      blob,
      plan: result.plan,
      outputBytes: blob.size,
      peakBufferedBytes: Math.max(peakBufferedBytes, peakPcmBytes + blob.size),
      peakPcmBytes: Math.max(peakPcmBytes, result.peakPcmBytes ?? 0),
      maxHeartbeatGapMs,
      encodePasses: result.encodePasses ?? 1,
      workerUsed: true,
      progress,
      verification,
      outputSha256: await sha256Blob(blob, globalRef),
      // The enclosing finally always terminates/revokes after the result is
      // assembled; expose the guaranteed post-return cleanup state.
      cleanup: { workerTerminated: true, objectUrlRevoked: true }
    };
  } finally {
    signal?.removeEventListener?.('abort', abortListener);
    if (!settled) {
      settled = true;
      cleanup();
    }
  }
}

export function createSyntheticWav({ durationMs = 1000, sampleRate = 48_000, channels = 2 } = {}) {
  const frames = Math.max(1, Math.round(sampleRate * durationMs / 1000));
  const dataBytes = frames * channels * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const put = (offset, value) => [...value].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
  put(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  put(36, 'data');
  view.setUint32(40, dataBytes, true);
  return new Blob([bytes], { type: 'audio/wav' });
}

export { verifyMp3Blob };
