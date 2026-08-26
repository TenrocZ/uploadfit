import {
  AUDIO_CANCEL_DEADLINE_MS,
  AUDIO_INPUT_CHUNK_BYTES,
  AUDIO_PCM_BUFFER_BUDGET,
  AUDIO_PROCESS_TIMEOUT_MS,
  AUDIO_PROGRESS_INTERVAL_MS
} from '../config.js';
import {
  AUDIO_ERROR_CODES,
  AudioProcessingError,
  asAudioProcessingError
} from './errors.js';
import { AUDIO_ENCODER_DESCRIPTOR, isFrozenAudioEncoderDescriptor } from './encoder-contract.js';

const STABLE_WORKER_CODES = new Set(AUDIO_ERROR_CODES);

// Production esbuild replaces this compile-time value with the S0-frozen
// lamejs/PCM adapter source.  Unit tests and harnesses intentionally leave it
// undefined and can continue supplying an explicit workerSource/source.
const BUILT_IN_IMPLEMENTATION_SOURCE = typeof __UPLOADFIT_AUDIO_IMPLEMENTATION_SOURCE__ !== 'undefined'
  ? __UPLOADFIT_AUDIO_IMPLEMENTATION_SOURCE__
  : '';

function stableWorkerCode(code, fallback = 'AUDIO_ENCODE_FAILED') {
  return STABLE_WORKER_CODES.has(code) ? code : fallback;
}

function clampRatio(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function now(globalRef) {
  return globalRef?.performance?.now?.() ?? Date.now();
}

function makeTaskId() {
  const random = globalThis.crypto?.randomUUID?.();
  return typeof random === 'string' ? random : `audio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new AudioProcessingError('AUDIO_PROCESSING_CANCELLED');
}

/**
 * The worker entry is deliberately dependency-free.  A production build can
 * append the S0-frozen lamejs implementation as `implementationSource`; the
 * protocol itself never needs to know the encoder's internals.
 */
export function createAudioWorkerSource(implementationSource = '') {
  const implementation = typeof implementationSource === 'string' ? implementationSource : '';
  return `
const AUDIO_PROGRESS_INTERVAL_MS = ${AUDIO_PROGRESS_INTERVAL_MS};
let active = null;
let disposed = false;
const stable = new Set(${JSON.stringify([...STABLE_WORKER_CODES])});
const stableCode = (code) => stable.has(code) ? code : 'AUDIO_ENCODE_FAILED';
const ratio = (value) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const emit = (message) => { try { self.postMessage(message); } catch {} };
const safeErrorCode = (error) => stableCode(error && error.code);
const implementationSource = ${JSON.stringify(implementation)};
${implementation}
async function runTask(data, state) {
  const emitProgress = (() => {
    let last = -Infinity;
    let lastRatio = 0;
    return (event = {}, force = false) => {
      const current = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      const nextRatio = Math.max(lastRatio, ratio(event.ratio));
      if (!force && current - last < AUDIO_PROGRESS_INTERVAL_MS) return;
      last = current;
      lastRatio = nextRatio;
      emit({ type: 'PROGRESS', taskId: state.taskId, phase: String(event.phase || 'encode'),
        processedMs: Number.isFinite(event.processedMs) ? Math.max(0, event.processedMs) : 0,
        totalMs: Number.isFinite(event.totalMs) ? Math.max(0, event.totalMs) : 0,
        ratio: nextRatio });
    };
  })();
  const signal = { get aborted() { return state.cancelled || disposed; }, throwIfAborted() {
    if (state.cancelled || disposed) { const error = new Error('cancelled'); error.code = 'AUDIO_PROCESSING_CANCELLED'; throw error; }
  }};
  if (typeof self.__uploadfitAudioEncode !== 'function') {
    const error = new Error('encoder unavailable'); error.code = 'AUDIO_WORKER_UNAVAILABLE'; throw error;
  }
  const result = await self.__uploadfitAudioEncode(data.file, data.plan, data.limits || {}, signal, emitProgress);
  // Finalize progress must be emitted from inside runTask: emitProgress lives
  // in this function's scope, and referencing it from the START handler raised
  // a ReferenceError that surfaced as a bogus AUDIO_ENCODE_FAILED.
  emitProgress({
    phase: 'finalize',
    ratio: 1,
    processedMs: data.plan?.durationMs,
    totalMs: data.plan?.durationMs
  }, true);
  return result;
}
self.onmessage = async (event) => {
  const data = event && event.data;
  if (!data || typeof data.taskId !== 'string') return;
  if (data.type === 'START') {
    if (disposed || (active && active.taskId !== data.taskId)) return;
    if (active) return;
    active = { taskId: data.taskId, cancelled: false };
    emit({ type: 'READY', taskId: data.taskId, capabilities: { streaming: true, encoder: 's0-frozen' } });
    try {
      const result = await runTask(data, active);
      if (active.cancelled || disposed) {
        emit({ type: 'CANCELLED', taskId: data.taskId });
      } else {
        const blob = result && result.blob instanceof Blob
          ? result.blob
          : result && result.bytes ? new Blob([result.bytes], { type: 'audio/mpeg' }) : null;
        if (!blob || !blob.size) { const error = new Error('empty output'); error.code = 'AUDIO_ENCODE_FAILED'; throw error; }
        emit({ type: 'RESULT', taskId: data.taskId, blob, stats: {
          ...(result && result.stats ? result.stats : result || {}),
          outputBytes: blob.size,
          workerUsed: true
        }});
      }
    } catch (error) {
      if (active && active.cancelled || disposed || error && error.code === 'AUDIO_PROCESSING_CANCELLED') {
        emit({ type: 'CANCELLED', taskId: data.taskId });
      } else {
        emit({ type: 'ERROR', taskId: data.taskId, errorCode: safeErrorCode(error) });
      }
    } finally {
      active = null;
    }
    return;
  }
  if (data.type === 'CANCEL') {
    if (active && active.taskId === data.taskId) active.cancelled = true;
    return;
  }
  if (data.type === 'DISPOSE') {
    if (active && active.taskId !== data.taskId) return;
    if (active) active.cancelled = true;
    disposed = true;
    emit({ type: 'DISPOSED', taskId: data.taskId, released: true });
  }
};`;
}

export function canUseAudioWorker(globalRef = globalThis) {
  return typeof globalRef?.Worker === 'function'
    && typeof globalRef?.Blob === 'function'
    && typeof globalRef?.URL?.createObjectURL === 'function'
    && typeof globalRef?.URL?.revokeObjectURL === 'function';
}

function workerError(code, details = {}) {
  return new AudioProcessingError(stableWorkerCode(code, 'AUDIO_WORKER_UNAVAILABLE'), undefined, details);
}

function normalizeProgress(message, lastRatio) {
  const ratio = Math.max(lastRatio, clampRatio(message?.ratio));
  return {
    type: 'PROGRESS',
    taskId: message?.taskId,
    phase: typeof message?.phase === 'string' ? message.phase : 'encode',
    processedMs: Number.isFinite(message?.processedMs) ? Math.max(0, message.processedMs) : 0,
    totalMs: Number.isFinite(message?.totalMs) ? Math.max(0, message.totalMs) : 0,
    ratio
  };
}

/** Create a strict START/CANCEL/DISPOSE runtime for one audio task at a time. */
export function createAudioWorkerRuntime(options = {}) {
  const globalRef = options.globalRef ?? globalThis;
  const descriptor = options.encoderDescriptor ?? AUDIO_ENCODER_DESCRIPTOR;
  if (!isFrozenAudioEncoderDescriptor(descriptor)) {
    return Object.freeze({
      run: () => Promise.reject(new AudioProcessingError('AUDIO_WORKER_UNAVAILABLE')),
      process: () => Promise.reject(new AudioProcessingError('AUDIO_WORKER_UNAVAILABLE')),
      cancel: () => false,
      dispose: () => {},
      activeTaskId: null
    });
  }
  const workerSource = options.workerSource
    ?? createAudioWorkerSource(options.implementationSource ?? BUILT_IN_IMPLEMENTATION_SOURCE);
  let active = null;
  let disposed = false;

  const run = (file, plan, runOptions = {}) => {
    if (disposed) return Promise.reject(new AudioProcessingError('AUDIO_WORKER_UNAVAILABLE'));
    if (active) return Promise.reject(new AudioProcessingError('AUDIO_PIPELINE_BUSY'));
    if (!canUseAudioWorker(globalRef)) {
      return Promise.reject(new AudioProcessingError('AUDIO_WORKER_UNAVAILABLE'));
    }
    const signal = runOptions.signal;
    if (signal?.aborted) return Promise.reject(new AudioProcessingError('AUDIO_PROCESSING_CANCELLED'));
    const taskId = typeof runOptions.taskId === 'string' && runOptions.taskId
      ? runOptions.taskId
      : makeTaskId();
    let worker;
    let url;
    try {
      const blob = new globalRef.Blob([workerSource], { type: 'text/javascript' });
      url = globalRef.URL.createObjectURL(blob);
      worker = typeof options.workerFactory === 'function'
        ? options.workerFactory(url, globalRef)
        : new globalRef.Worker(url);
    } catch (error) {
      if (url) {
        try { globalRef.URL.revokeObjectURL(url); } catch {}
      }
      return Promise.reject(workerError('AUDIO_WORKER_UNAVAILABLE', { causeName: error?.name ?? 'Error' }));
    }

    let cancelTask = null;
    let disposeTask = null;
    const promise = new Promise((resolve, reject) => {
      let settled = false;
      let ready = false;
      let cancelRequested = false;
      let cancelTimer = null;
      let timeoutTimer = null;
      let lastProgressAt = -Infinity;
      let lastRatio = 0;
      let cleaned = false;
      let detach = () => {};
      const startedAt = now(globalRef);
      const cleanupState = {
        workerTerminated: false,
        objectUrlRevoked: false,
        queueCleared: false,
        disposed: false
      };
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        if (timeoutTimer) globalRef.clearTimeout(timeoutTimer);
        if (cancelTimer) globalRef.clearTimeout(cancelTimer);
        worker.onmessage = null;
        worker.onerror = null;
        try { worker.postMessage({ type: 'DISPOSE', taskId }); } catch {}
        try { worker.terminate?.(); cleanupState.workerTerminated = true; } catch {}
        try { globalRef.URL.revokeObjectURL(url); cleanupState.objectUrlRevoked = true; } catch {}
        cleanupState.queueCleared = true;
        cleanupState.disposed = true;
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        detach();
        cleanup();
        if (value instanceof AudioProcessingError) {
          value.details = {
            ...(value.details ?? {}),
            cleanup: { ...cleanupState }
          };
        }
        if (active?.taskId === taskId) active = null;
        callback(value);
      };
      const abort = () => {
        if (settled || cancelRequested) return;
        cancelRequested = true;
        try { worker.postMessage({ type: 'CANCEL', taskId }); } catch {}
        cancelTimer = globalRef.setTimeout(() => {
          finish(reject, new AudioProcessingError('AUDIO_PROCESSING_CANCELLED', undefined, {
            taskId,
            cancelDeadlineMs: AUDIO_CANCEL_DEADLINE_MS,
            forcedTerminate: true
          }));
        }, AUDIO_CANCEL_DEADLINE_MS);
      };
      cancelTask = abort;
      const onAbort = () => abort();
      signal?.addEventListener?.('abort', onAbort, { once: true });
      detach = () => signal?.removeEventListener?.('abort', onAbort);
      disposeTask = () => {
        if (settled) return false;
        finish(reject, new AudioProcessingError('AUDIO_PROCESSING_CANCELLED', undefined, {
          taskId,
          disposed: true
        }));
        return true;
      };
      const fail = (error) => {
        detach();
        finish(reject, error instanceof AudioProcessingError
          ? error
          : asAudioProcessingError(error, 'AUDIO_WORKER_UNAVAILABLE'));
      };
      const succeed = (value) => {
        detach();
        finish(resolve, value);
      };
      timeoutTimer = globalRef.setTimeout(() => {
        fail(workerError('AUDIO_WORKER_UNAVAILABLE', { timeout: true, taskId }));
      }, Number.isFinite(runOptions.timeoutMs)
        ? Math.max(1, runOptions.timeoutMs)
        : AUDIO_PROCESS_TIMEOUT_MS);
      worker.onmessage = (event) => {
        const message = event?.data;
        if (!message || message.taskId !== taskId) return;
        if (message.type === 'READY') {
          ready = true;
          return;
        }
        if (message.type === 'PROGRESS') {
          const current = now(globalRef);
          if (current - lastProgressAt < AUDIO_PROGRESS_INTERVAL_MS && message.ratio < 1) return;
          lastProgressAt = current;
          const normalized = normalizeProgress(message, lastRatio);
          lastRatio = normalized.ratio;
          try { runOptions.onProgress?.(normalized); } catch {}
          return;
        }
        if (!ready && message.type !== 'ERROR' && message.type !== 'CANCELLED') return;
        if (message.type === 'CANCELLED') {
          detach();
          finish(reject, new AudioProcessingError('AUDIO_PROCESSING_CANCELLED', undefined, { taskId }));
          return;
        }
        if (message.type === 'ERROR') {
          fail(workerError(message.errorCode, { taskId }));
          return;
        }
        if (message.type === 'RESULT') {
          const isBlob = message.blob instanceof globalRef.Blob
            || (typeof globalThis.Blob === 'function' && message.blob instanceof globalThis.Blob);
          if (!isBlob) {
            fail(workerError('AUDIO_ENCODE_FAILED', { taskId, reason: 'missing-blob' }));
            return;
          }
          succeed({
            blob: message.blob,
            stats: { ...(message.stats ?? {}), workerUsed: true },
            workerUsed: true,
            taskId,
            cleanup: cleanupState,
            durationMs: Math.max(0, now(globalRef) - startedAt)
          });
        }
      };
      worker.onerror = () => fail(workerError('AUDIO_WORKER_UNAVAILABLE', { taskId }));
      try {
        worker.postMessage({
          type: 'START',
          taskId,
          file,
          plan,
          limits: {
            inputChunkBytes: Math.min(
              Number.isFinite(runOptions.inputChunkBytes) ? runOptions.inputChunkBytes : AUDIO_INPUT_CHUNK_BYTES,
              AUDIO_INPUT_CHUNK_BYTES
            ),
            pcmBufferBudgetBytes: Math.min(
              Number.isFinite(runOptions.pcmBufferBudgetBytes) ? runOptions.pcmBufferBudgetBytes : AUDIO_PCM_BUFFER_BUDGET,
              AUDIO_PCM_BUFFER_BUDGET
            ),
            maxBytes: plan?.targetMaxBytes,
            safeTargetBytes: plan?.safeTargetBytes
          }
        });
      } catch (error) {
        fail(workerError('AUDIO_WORKER_UNAVAILABLE', { taskId, causeName: error?.name ?? 'Error' }));
      }
      if (signal?.aborted) abort();
    });
    active = {
      taskId,
      promise,
      worker,
      cancel: () => cancelTask?.(),
      dispose: () => disposeTask?.()
    };
    return promise;
  };

  const cancel = () => {
    if (!active) return false;
    active.cancel?.();
    return true;
  };

  const dispose = () => {
    if (disposed) return false;
    disposed = true;
    if (!active) return true;
    return active.dispose?.() ?? false;
  };

  return Object.freeze({ run, process: run, cancel, dispose, get activeTaskId() { return active?.taskId ?? null; } });
}

export async function runAudioWorker(file, plan, options = {}) {
  const runtime = options.runtime?.run ? options.runtime : createAudioWorkerRuntime(options);
  return runtime.run(file, plan, options);
}

export const processAudioInWorker = runAudioWorker;
