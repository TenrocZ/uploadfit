import {
  AUDIO_BITRATE_LADDER_KBPS,
  AUDIO_ENCODE_PASS_LIMIT,
  AUDIO_INPUT_CHUNK_BYTES,
  AUDIO_PCM_BUFFER_BUDGET
} from '../config.js';
import { inspectAudio } from './metadata.js';
import {
  AUDIO_ERROR_CODES,
  AudioProcessingError,
  asAudioProcessingError
} from './errors.js';
import {
  createAudioProcessingPlan,
  isAudioPlanExecutable,
  lowerAudioBitrate,
  resolveAudioConfirmation
} from './planner.js';
import { validateAudioOutputFile } from './validators.js';
import { frozenEncoderOutputSampleRate } from './encoder-contract.js';
import { createAudioWorkerRuntime } from './worker-runtime.js';

let activePipeline = null;

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new AudioProcessingError('AUDIO_PROCESSING_CANCELLED');
}

function safeProgressCallback(callback, signal) {
  let lastRatio = 0;
  let lastAt = -Infinity;
  return (event = {}) => {
    throwIfAborted(signal);
    const ratio = Number.isFinite(event.ratio)
      ? Math.max(lastRatio, Math.min(1, event.ratio))
      : lastRatio;
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (ratio < 1 && now - lastAt < 100) return;
    lastAt = now;
    lastRatio = ratio;
    try {
      callback?.({
        type: 'PROGRESS',
        phase: typeof event.phase === 'string' ? event.phase : 'encode',
        processedMs: Number.isFinite(event.processedMs) ? Math.max(0, event.processedMs) : 0,
        totalMs: Number.isFinite(event.totalMs) ? Math.max(0, event.totalMs) : 0,
        ratio
      });
    } catch {
      // Progress is advisory and must never change processing semantics.
    }
  };
}

function safeBaseName(name) {
  const raw = typeof name === 'string' ? name : '';
  const stem = raw.replace(/\.[a-z0-9]{1,12}$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return (stem || 'audio').slice(0, 100);
}

function outputName(file) {
  return `${safeBaseName(file?.name)}-uploadfit.mp3`;
}

function createOutputFile(blob, sourceFile) {
  const FileConstructor = sourceFile?.constructor?.name === 'File'
    ? sourceFile.constructor
    : globalThis.File;
  if (typeof FileConstructor !== 'function') {
    throw new AudioProcessingError('AUDIO_ENCODE_FAILED', 'File constructor is unavailable.');
  }
  try {
    return new FileConstructor([blob], outputName(sourceFile), {
      type: 'audio/mpeg',
      lastModified: 0
    });
  } catch (error) {
    throw new AudioProcessingError('AUDIO_ENCODE_FAILED', error?.message ?? 'File creation failed.');
  }
}

function assertFile(file) {
  if (!file || typeof file !== 'object' || !Number.isFinite(file.size) || file.size <= 0
    || typeof file.slice !== 'function') {
    throw new AudioProcessingError('AUDIO_METADATA_INVALID');
  }
}

function clone(value) {
  if (Array.isArray(value)) return value.map((item) => clone(item));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function sameJson(first, second) {
  try { return JSON.stringify(first) === JSON.stringify(second); } catch { return false; }
}

function stablePlanStop(plan) {
  if (!Array.isArray(plan?.unfixable) || plan.unfixable.length === 0) return null;
  return plan.unfixable.find((code) => AUDIO_ERROR_CODES.includes(code)) ?? 'AUDIO_TARGET_UNSAFE';
}

function validatePlanAgainstMetadata(plan, metadata, rules, options = {}) {
  const canonicalOptions = {
    ...options,
    ...(metadata?.channels === 2 && plan?.targetChannels === 1 ? { targetChannels: 1 } : {})
  };
  const canonical = createAudioProcessingPlan(metadata, rules, canonicalOptions);
  const canonicalStop = stablePlanStop(canonical);
  if (canonicalStop) {
    throw new AudioProcessingError(canonicalStop, undefined, {
      canonicalUnfixable: [...canonical.unfixable]
    });
  }
  if (!isAudioPlanExecutable(plan)) {
    const declined = plan?.confirmations?.some((item) => item?.resolved === true && item.accepted === false);
    throw new AudioProcessingError(
      declined ? 'AUDIO_PROCESSING_CANCELLED' : stablePlanStop(plan) ?? 'AUDIO_CONFIRMATION_REQUIRED',
      undefined,
      { declined }
    );
  }
  if (plan.encodePassLimit !== AUDIO_ENCODE_PASS_LIMIT) {
    throw new AudioProcessingError('AUDIO_TARGET_UNSAFE');
  }
  const authority = [
    'sourceContainer',
    'sourceCodec',
    'targetMime',
    'targetContainer',
    'targetCodec',
    'targetMaxBytes',
    'safeTargetBytes',
    'targetBitrateKbps',
    'targetSampleRate',
    'targetChannels',
    'operations',
    'passthrough',
    'unfixable'
  ];
  for (const field of authority) {
    if (!sameJson(plan[field], canonical[field])) {
      throw new AudioProcessingError('AUDIO_TARGET_UNSAFE', undefined, { field });
    }
  }
  if (plan.confirmations.length !== canonical.confirmations.length) {
    throw new AudioProcessingError('AUDIO_CONFIRMATION_REQUIRED', undefined, { field: 'confirmations' });
  }
  for (const expected of canonical.confirmations) {
    const actual = plan.confirmations.find((item) => item?.id === expected.id);
    if (!actual || actual.type !== expected.type
      || !sameJson(actual.suggestedPayload, expected.suggestedPayload)) {
      throw new AudioProcessingError('AUDIO_CONFIRMATION_REQUIRED', undefined, { field: 'confirmation' });
    }
  }
  return clone(plan);
}

function runtimeRunner(runtime) {
  if (!runtime) return null;
  if (typeof runtime.run === 'function') return runtime.run.bind(runtime);
  if (typeof runtime.process === 'function') return runtime.process.bind(runtime);
  if (typeof runtime === 'function') return runtime;
  return null;
}

function normalizeRuntimeResult(value) {
  const blob = value?.blob ?? value?.file ?? value;
  if (!blob || typeof blob !== 'object' || !Number.isFinite(blob.size) || blob.size <= 0) {
    throw new AudioProcessingError('AUDIO_ENCODE_FAILED');
  }
  if (typeof blob.type === 'string' && blob.type && blob.type.toLowerCase() !== 'audio/mpeg') {
    throw new AudioProcessingError('AUDIO_OUTPUT_FORMAT_NOT_ALLOWED');
  }
  return {
    blob,
    stats: isRecord(value?.stats) ? value.stats : {},
    cleanup: value?.cleanup ?? null,
    taskId: value?.taskId ?? null
  };
}

function mergeWarnings(...groups) {
  const result = [];
  for (const group of groups) {
    for (const item of group ?? []) {
      const normalized = typeof item === 'string' ? { code: item } : item;
      if (normalized?.code && !result.some((entry) => entry.code === normalized.code)) {
        result.push({ code: normalized.code });
      }
    }
  }
  return result;
}

async function inspectOutput(outputFile, options) {
  if (typeof options.inspectOutput === 'function') return options.inspectOutput(outputFile);
  return inspectAudio(outputFile, { signal: options.signal });
}

async function validateOutput(outputFile, rules, plan, sourceMetadata, options) {
  if (typeof options.validateOutput === 'function') {
    return options.validateOutput(outputFile, rules, plan, sourceMetadata);
  }
  return validateAudioOutputFile(outputFile, rules, plan, sourceMetadata, { signal: options.signal });
}

function makeRules(plan, options) {
  return {
    ...(isRecord(options.rules) ? options.rules : {}),
    mediaKind: 'audio',
    formats: isRecord(options.rules) && Array.isArray(options.rules.formats)
      ? options.rules.formats.slice()
      : ['audio/mpeg'],
    extensions: isRecord(options.rules) && Array.isArray(options.rules.extensions)
      ? options.rules.extensions.slice()
      : ['.mp3'],
    maxBytes: plan.targetMaxBytes
  };
}

async function processPass(file, passPlan, runtime, progress, options) {
  throwIfAborted(options.signal);
  const runner = runtimeRunner(runtime);
  if (!runner) throw new AudioProcessingError('AUDIO_WORKER_UNAVAILABLE');
  try {
    const result = await runner(file, passPlan, {
      ...options,
      signal: options.signal,
      onProgress: progress,
      inputChunkBytes: Math.min(
        Number.isFinite(options.inputChunkBytes) ? options.inputChunkBytes : AUDIO_INPUT_CHUNK_BYTES,
        AUDIO_INPUT_CHUNK_BYTES
      ),
      pcmBufferBudgetBytes: Math.min(
        Number.isFinite(options.pcmBufferBudgetBytes) ? options.pcmBufferBudgetBytes : AUDIO_PCM_BUFFER_BUDGET,
        AUDIO_PCM_BUFFER_BUDGET
      )
    });
    const normalized = normalizeRuntimeResult(result);
    if (options.signal?.aborted) {
      throw new AudioProcessingError('AUDIO_PROCESSING_CANCELLED', undefined, {
        cleanup: normalized.cleanup ?? null
      });
    }
    return normalized;
  } catch (error) {
    const normalized = asAudioProcessingError(error);
    if (options.signal?.aborted && normalized.code !== 'AUDIO_PROCESSING_CANCELLED') {
      throwIfAborted(options.signal);
    }
    throw normalized;
  }
}

/** Process one audio file under an already-resolved S2 plan. */
export async function processAudio(file, plan, options = {}) {
  if (activePipeline) throw new AudioProcessingError('AUDIO_PIPELINE_BUSY');
  activePipeline = { startedAt: Date.now() };
  const startedAt = Date.now();
  const signal = options.signal;
  let runtime = options.workerRuntime ?? null;
  // A caller-provided runtime keeps its own lifecycle; disposing it here would
  // make the second task on the same runtime fail with AUDIO_WORKER_UNAVAILABLE.
  const ownsRuntime = !runtime;
  try {
    throwIfAborted(signal);
    assertFile(file);
    const metadata = options.metadata ?? await inspectAudio(file, { signal });
    throwIfAborted(signal);
    if (metadata.errorCode) throw new AudioProcessingError(metadata.errorCode);
    const rules = makeRules(plan, options);
    const executablePlan = validatePlanAgainstMetadata(plan, metadata, rules, options);
    const progress = safeProgressCallback(options.onProgress, signal);
    progress({ phase: 'inspect', ratio: 0, processedMs: 0, totalMs: metadata.durationMs ?? 0 });

    if (executablePlan.passthrough) {
      const validation = typeof options.validateInput === 'function'
        ? await options.validateInput(metadata, rules, executablePlan)
        : {
          valid: true,
          violations: [],
          warnings: [],
          safeAutoFixes: [],
          requiredConfirmations: [],
          unfixable: []
        };
      if (!validation.valid) throw new AudioProcessingError('AUDIO_OUTPUT_VALIDATION_FAILED');
      progress({ phase: 'complete', ratio: 1, processedMs: metadata.durationMs ?? 0, totalMs: metadata.durationMs ?? 0 });
      return {
        file,
        metadata,
        operations: [],
        validation,
        durationMs: Date.now() - startedAt,
        inputBytesRead: Number.isFinite(metadata.inspectedBytes) ? metadata.inspectedBytes : file.size,
        outputBytes: file.size,
        workerUsed: false,
        encodePasses: 0,
        peakBufferedBytes: 0,
        warnings: mergeWarnings(executablePlan.warnings, validation.warnings),
        passthrough: true
      };
    }

    runtime ??= createAudioWorkerRuntime(options.workerOptions ?? options);
    const rulesForOutput = makeRules(executablePlan, options);
    const firstProgress = progress;
    let bitrate = executablePlan.targetBitrateKbps;
    let pass = 0;
    let inputBytesRead = 0;
    let peakBufferedBytes = null;
    let workerUsed = true;
    let warnings = [...(executablePlan.warnings ?? [])];
    let outputFile = null;
    let outputMetadata = null;
    let outputValidation = null;
    let lastRuntime = null;
    while (pass < AUDIO_ENCODE_PASS_LIMIT) {
      pass += 1;
      const passPlan = { ...clone(executablePlan), targetBitrateKbps: bitrate };
      // A lower ladder rung can move the frozen encoder onto a different
      // output sample rate; re-forecast so output validation checks the rate
      // this pass will actually emit.
      const forecastRate = frozenEncoderOutputSampleRate(
        metadata.sampleRate, passPlan.targetChannels, bitrate
      );
      if (forecastRate) passPlan.targetSampleRate = forecastRate;
      lastRuntime = await processPass(file, passPlan, runtime, firstProgress, options);
      inputBytesRead += Number.isFinite(lastRuntime.stats.inputBytesRead)
        ? lastRuntime.stats.inputBytesRead
        : (Number.isFinite(metadata.size) ? metadata.size : 0);
      if (Number.isFinite(lastRuntime.stats.peakBufferedBytes)) {
        peakBufferedBytes = Math.max(peakBufferedBytes ?? 0, lastRuntime.stats.peakBufferedBytes);
      }
      if (lastRuntime.stats.workerUsed === false || lastRuntime.workerUsed === false) {
        throw new AudioProcessingError('AUDIO_WORKER_UNAVAILABLE');
      }
      outputFile = createOutputFile(lastRuntime.blob, file);
      try {
        outputMetadata = await inspectOutput(outputFile, options);
      } catch (error) {
        throw new AudioProcessingError('AUDIO_OUTPUT_VALIDATION_FAILED', undefined, {
          causeCode: error?.code ?? 'AUDIO_DECODE_FAILED'
        });
      }
      try {
        outputValidation = await validateOutput(outputFile, rulesForOutput, passPlan, metadata, options);
      } catch (error) {
        throw new AudioProcessingError('AUDIO_OUTPUT_VALIDATION_FAILED', undefined, {
          causeCode: error?.code ?? 'AUDIO_DECODE_FAILED'
        });
      }
      const tooLarge = outputFile.size > executablePlan.targetMaxBytes;
      if (outputValidation?.frameValidation?.decoderUnavailable) {
        throw new AudioProcessingError('AUDIO_DECODER_UNAVAILABLE');
      }
      const valid = outputValidation?.valid === true && !tooLarge;
      if (valid) {
        if (outputFile.size > executablePlan.safeTargetBytes) warnings.push({ code: 'AUDIO_SAFETY_MARGIN_MISSED' });
        break;
      }
      if (tooLarge) {
        const nextBitrate = lowerAudioBitrate(bitrate);
        if (pass >= AUDIO_ENCODE_PASS_LIMIT || !nextBitrate) {
          throw new AudioProcessingError('AUDIO_OUTPUT_TOO_LARGE', undefined, {
            outputBytes: outputFile.size,
            maxBytes: executablePlan.targetMaxBytes,
            encodePasses: pass
          });
        }
        bitrate = nextBitrate;
        continue;
      }
      if (!outputValidation?.valid) {
        throw new AudioProcessingError('AUDIO_OUTPUT_VALIDATION_FAILED', undefined, {
          violations: outputValidation?.violations?.map((item) => item.code) ?? []
        });
      }
    }
    if (!outputFile || !outputValidation?.valid || outputFile.size > executablePlan.targetMaxBytes) {
      throw new AudioProcessingError('AUDIO_OUTPUT_VALIDATION_FAILED');
    }
    progress({
      phase: 'complete',
      ratio: 1,
      processedMs: outputMetadata?.durationMs ?? metadata.durationMs ?? 0,
      totalMs: metadata.durationMs ?? 0
    });
    return {
      file: outputFile,
      metadata: outputMetadata,
      operations: [...(executablePlan.operations ?? [])],
      validation: outputValidation,
      durationMs: Date.now() - startedAt,
      inputBytesRead,
      outputBytes: outputFile.size,
      workerUsed,
      encodePasses: pass,
      peakBufferedBytes,
      warnings: mergeWarnings(warnings, outputValidation.warnings),
      passthrough: false,
      cleanup: lastRuntime?.cleanup ?? null
    };
  } catch (error) {
    const normalized = asAudioProcessingError(error);
    if (signal?.aborted && normalized.code !== 'AUDIO_PROCESSING_CANCELLED') {
      throwIfAborted(signal);
    }
    throw normalized;
  } finally {
    if (ownsRuntime) {
      try { runtime?.dispose?.(); } catch {}
    }
    activePipeline = null;
  }
}

export function createAudioPipeline(options = {}) {
  let disposed = false;
  let runtime = options.workerRuntime ?? null;
  const ensureRuntime = () => {
    runtime ??= createAudioWorkerRuntime(options.workerOptions ?? options);
    return runtime;
  };
  return Object.freeze({
    process(file, plan, runOptions = {}) {
      if (disposed) return Promise.reject(new AudioProcessingError('AUDIO_WORKER_UNAVAILABLE'));
      return processAudio(file, plan, {
        ...options,
        ...runOptions,
        workerRuntime: runOptions.workerRuntime ?? ensureRuntime()
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { runtime?.dispose?.(); } catch {}
    }
  });
}

export { resolveAudioConfirmation };

export const processAudioFile = processAudio;
