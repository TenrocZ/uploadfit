/*
 * V2-S0 capability probe.
 *
 * This module only asks the current runtime what it can do.  It never decodes
 * a user file, allocates a PCM buffer proportional to a file, loads a codec,
 * or performs network I/O.  The production audio handler is intentionally not
 * coupled to this probe until S0 has an independently accepted codec choice.
 */

export const AUDIO_PROBE_SCHEMA_VERSION = 1;

export const S0_AUDIO_INPUT_SUBSET = Object.freeze({
  mp3: Object.freeze({
    container: 'mp3',
    codec: 'mp3',
    required: true,
    variants: ['CBR', 'VBR-Xing-or-VBRI', 'ID3v2']
  }),
  wav: Object.freeze({
    container: 'wav',
    codec: 'pcm',
    required: true,
    variants: ['pcm16', 'mono-or-stereo'],
    optionalVariants: ['pcm24']
  }),
  m4a: Object.freeze({
    container: 'mp4',
    codec: 'aac-lc',
    required: true,
    variants: ['aac-lc-esds'],
    rejectedVariants: ['he-aac', 'alac', 'spatial-audio']
  }),
  webm: Object.freeze({
    container: 'webm',
    codec: 'opus',
    required: false,
    status: 'not-in-s1-freeze'
  })
});

export const S0_RESOURCE_LIMITS = Object.freeze({
  inputChunkBytes: 4 * 1024 * 1024,
  pcmBufferBudgetBytes: 32 * 1024 * 1024,
  metadataReadLimitBytes: 1 * 1024 * 1024,
  progressIntervalMs: 100,
  heartbeatTargetMs: 500,
  cancelDeadlineMs: 1000,
  maxEncodePasses: 2,
  hardOutputBytes: 100_000_000,
  safeOutputBytes: 95_000_000,
  minimumBitrateKbps: 48
});

const CODEC_CONFIGS = Object.freeze({
  decoder: Object.freeze({
    mp3: Object.freeze({ codec: 'mp3', sampleRate: 48_000, numberOfChannels: 2 }),
    aacLc: Object.freeze({ codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2 }),
    opus: Object.freeze({ codec: 'opus', sampleRate: 48_000, numberOfChannels: 2 })
  }),
  encoder: Object.freeze({
    mp3: Object.freeze({ codec: 'mp3', sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 }),
    aacLc: Object.freeze({ codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 }),
    opus: Object.freeze({ codec: 'opus', sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 })
  })
});

function safeName(error) {
  return typeof error?.name === 'string' && error.name.length <= 80
    ? error.name
    : 'Error';
}

function safeMessage(error) {
  if (typeof error?.message !== 'string') return null;
  const value = error.message.replace(/[\r\n]+/g, ' ').trim();
  return value.length > 160 ? `${value.slice(0, 157)}...` : value || null;
}

function resultBase(config) {
  return { config: { ...config }, available: false, supported: false, errorName: null, errorMessage: null };
}

async function probeCodec(Constructor, config) {
  const result = resultBase(config);
  if (typeof Constructor !== 'function') {
    result.errorName = 'API_UNAVAILABLE';
    return result;
  }
  result.available = true;
  if (typeof Constructor.isConfigSupported !== 'function') {
    result.errorName = 'IS_CONFIG_SUPPORTED_UNAVAILABLE';
    return result;
  }
  try {
    const supported = await Constructor.isConfigSupported(config);
    result.supported = Boolean(supported?.supported);
    if (supported?.config && typeof supported.config === 'object') {
      result.resolvedConfig = { ...supported.config };
    }
  } catch (error) {
    result.errorName = safeName(error);
    result.errorMessage = safeMessage(error);
  }
  return result;
}

function probeTransferables(globalRef) {
  const result = {
    messageChannel: typeof globalRef.MessageChannel === 'function',
    structuredClone: typeof globalRef.structuredClone === 'function',
    transferableArrayBuffer: false,
    errorName: null
  };
  if (!result.messageChannel) return result;
  try {
    const channel = new globalRef.MessageChannel();
    const buffer = new ArrayBuffer(8);
    channel.port1.postMessage(buffer, [buffer]);
    result.transferableArrayBuffer = buffer.byteLength === 0;
    channel.port1.close?.();
    channel.port2.close?.();
  } catch (error) {
    result.errorName = safeName(error);
  }
  return result;
}

function probeWasm(globalRef) {
  const result = { api: typeof globalRef.WebAssembly === 'object', instantiateApi: false, errorName: null };
  if (!result.api) return result;
  // Minimal empty WebAssembly module.  This checks the host API only; it is not
  // an audio codec and is deliberately not used to claim codec feasibility.
  const emptyModule = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  try {
    result.instantiateApi = typeof globalRef.WebAssembly.instantiate === 'function';
    // Validate is synchronous where exposed and avoids retaining a module.
    result.validatesEmptyModule = globalRef.WebAssembly.validate?.(emptyModule) === true;
  } catch (error) {
    result.errorName = safeName(error);
  }
  return result;
}

async function probeBlobWorker(globalRef, timeoutMs = 750) {
  const result = {
    api: typeof globalRef.Worker === 'function'
      && typeof globalRef.Blob === 'function'
      && typeof globalRef.URL?.createObjectURL === 'function'
      && typeof globalRef.URL?.revokeObjectURL === 'function',
    started: false,
    message: false,
    terminated: false,
    revoked: false,
    errorName: null
  };
  if (!result.api) return result;
  const source = 'self.postMessage({ type: "S0_READY" });';
  let url = null;
  let worker = null;
  try {
    url = globalRef.URL.createObjectURL(new globalRef.Blob([source], { type: 'text/javascript' }));
    worker = new globalRef.Worker(url);
    result.started = true;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timeout = globalRef.setTimeout(finish, timeoutMs);
      worker.onmessage = (event) => {
        if (event.data?.type === 'S0_READY') result.message = true;
        globalRef.clearTimeout(timeout);
        finish();
      };
      worker.onerror = (error) => {
        result.errorName = safeName(error);
        globalRef.clearTimeout(timeout);
        finish();
      };
    });
  } catch (error) {
    result.errorName = safeName(error);
  } finally {
    try {
      worker?.terminate?.();
      result.terminated = Boolean(worker);
    } catch (error) {
      result.errorName ??= safeName(error);
    }
    try {
      if (url) {
        globalRef.URL.revokeObjectURL(url);
        result.revoked = true;
      }
    } catch (error) { result.errorName ??= safeName(error); }
  }
  return result;
}

function apiMatrix(globalRef) {
  const filePrototype = globalRef.File?.prototype;
  return {
    file: typeof globalRef.File === 'function',
    blob: typeof globalRef.Blob === 'function',
    fileStream: typeof filePrototype?.stream === 'function',
    readableStream: typeof globalRef.ReadableStream === 'function',
    transformStream: typeof globalRef.TransformStream === 'function',
    worker: typeof globalRef.Worker === 'function',
    blobWorkerPrerequisites: typeof globalRef.Worker === 'function'
      && typeof globalRef.URL?.createObjectURL === 'function',
    webAssembly: typeof globalRef.WebAssembly === 'object',
    audioDecoder: typeof globalRef.AudioDecoder === 'function',
    audioEncoder: typeof globalRef.AudioEncoder === 'function',
    audioContext: typeof globalRef.AudioContext === 'function',
    offlineAudioContext: typeof globalRef.OfflineAudioContext === 'function'
  };
}

/** Probe only runtime capabilities; safe to execute in a page or Worker. */
export async function probeAudioCapabilities(globalRef = globalThis, options = {}) {
  const signal = options.signal;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const api = apiMatrix(globalRef);
  const decoder = {};
  const encoder = {};
  for (const [name, config] of Object.entries(CODEC_CONFIGS.decoder)) {
    decoder[name] = await probeCodec(globalRef.AudioDecoder, config);
  }
  for (const [name, config] of Object.entries(CODEC_CONFIGS.encoder)) {
    encoder[name] = await probeCodec(globalRef.AudioEncoder, config);
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const worker = await probeBlobWorker(globalRef, options.workerTimeoutMs ?? 750);
  return {
    schemaVersion: AUDIO_PROBE_SCHEMA_VERSION,
    api,
    transfer: probeTransferables(globalRef),
    wasm: probeWasm(globalRef),
    blobWorker: worker,
    webCodecs: { decoder, encoder },
    resourceLimits: { ...S0_RESOURCE_LIMITS },
    inputSubset: JSON.parse(JSON.stringify(S0_AUDIO_INPUT_SUBSET)),
    probeScope: 'capability-only; no user file, PCM, network or persistent storage'
  };
}

export { CODEC_CONFIGS };
