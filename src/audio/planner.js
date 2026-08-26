import {
  AUDIO_BITRATE_LADDER_KBPS,
  AUDIO_CONTAINER_RESERVE_BYTES,
  AUDIO_ENCODE_PASS_LIMIT,
  AUDIO_MIN_BITRATE_KBPS,
  AUDIO_SAFE_TARGET_RATIO
} from '../config.js';
import { frozenEncoderOutputSampleRate } from './encoder-contract.js';
import { confirmationId, stableJson } from './confirmation.js';

const MP3_MIME = 'audio/mpeg';
const MP3_CONTAINER = 'mp3';
const MP3_CODEC = 'mp3';
const MINIMUM_USABLE_MAX_BYTES = 128 * 1024;
const CONFIRMATION_TYPES = Object.freeze([
  'AUDIO_LOSSY_TRANSCODE',
  'AUDIO_DOWNMIX_MONO'
]);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function clone(value) {
  if (Array.isArray(value)) return value.map((item) => clone(item));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

function normalizeMime(value) {
  const mime = typeof value === 'string' ? value.trim().toLowerCase().split(';', 1)[0] : '';
  if (mime === 'audio/mp3') return MP3_MIME;
  if (mime === 'audio/x-wav') return 'audio/wav';
  return mime;
}

function normalizeExtension(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^\./, '');
}

function explicitMp3Allowed(rules) {
  if (!isRecord(rules)) return false;
  const formats = Array.isArray(rules.formats) ? rules.formats : [];
  const extensions = Array.isArray(rules.extensions) ? rules.extensions : [];
  return formats.some((item) => normalizeMime(item) === MP3_MIME || normalizeMime(item) === 'audio/mp3')
    || extensions.some((item) => normalizeExtension(item) === 'mp3');
}

function sourceAllowed(metadata, rules) {
  const formats = Array.isArray(rules?.formats) ? rules.formats.map(normalizeMime) : [];
  const extensions = Array.isArray(rules?.extensions)
    ? rules.extensions.map(normalizeExtension)
    : [];
  const mime = normalizeMime(metadata?.signatureMime ?? metadata?.mime);
  if (formats.includes(mime)) return true;
  const extension = mime === MP3_MIME ? 'mp3'
    : mime === 'audio/mp4' ? 'm4a'
      : mime === 'audio/wav' ? 'wav'
        : '';
  return Boolean(extension && extensions.includes(extension));
}

function supportedAudioSource(metadata) {
  const mime = normalizeMime(metadata?.signatureMime ?? metadata?.mime);
  return (mime === MP3_MIME && metadata?.container === MP3_CONTAINER && metadata?.codec === MP3_CODEC)
    || (mime === 'audio/mp4' && metadata?.container === 'mp4' && metadata?.codec === 'aac-lc')
    || (mime === 'audio/wav' && metadata?.container === 'wav' && metadata?.codec === 'pcm');
}

function warning(code, details = {}) {
  return { code, ...details };
}

function pushUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function pushViolation(list, code, expected = null, actual = null) {
  if (!list.some((item) => item.code === code)) list.push({ code, expected, actual });
}

function selectBitrate(rawKbps) {
  if (!Number.isFinite(rawKbps) || rawKbps < AUDIO_MIN_BITRATE_KBPS) return null;
  return AUDIO_BITRATE_LADDER_KBPS.find((value) => value <= rawKbps) ?? null;
}

function lowerBitrate(current) {
  const index = AUDIO_BITRATE_LADDER_KBPS.indexOf(current);
  if (index < 0 || index + 1 >= AUDIO_BITRATE_LADDER_KBPS.length) return null;
  const next = AUDIO_BITRATE_LADDER_KBPS[index + 1];
  return next >= AUDIO_MIN_BITRATE_KBPS ? next : null;
}

function qualityStrategy(options) {
  const strategy = isRecord(options?.qualityStrategy) ? options.qualityStrategy : {};
  const minimumStereo = Number.isFinite(strategy.minStereoBitrateKbps)
    ? strategy.minStereoBitrateKbps
    : Number.isFinite(options?.minStereoBitrateKbps)
      ? options.minStereoBitrateKbps
      : null;
  const requestedChannels = options?.targetChannels === 1
    || options?.downmixMono === true
    || options?.forceMono === true
    || strategy.targetChannels === 1
    || strategy.requireMono === true;
  return { minimumStereo, requestedChannels };
}

function expectedConfirmation(type, payload) {
  return {
    id: confirmationId(type, payload),
    type,
    required: true,
    resolved: false,
    accepted: null,
    payload: null,
    suggestedPayload: clone(payload)
  };
}

function basePlan() {
  return {
    mediaKind: 'audio',
    sourceContainer: null,
    sourceCodec: null,
    targetMime: MP3_MIME,
    targetContainer: MP3_CONTAINER,
    targetCodec: MP3_CODEC,
    targetMaxBytes: 0,
    safeTargetBytes: 0,
    targetBitrateKbps: AUDIO_MIN_BITRATE_KBPS,
    targetSampleRate: null,
    targetChannels: 2,
    operations: [],
    confirmations: [],
    estimatedOutputBytes: { min: 0, max: 0 },
    encodePassLimit: AUDIO_ENCODE_PASS_LIMIT,
    executable: false,
    passthrough: false,
    unfixable: [],
    warnings: []
  };
}

function planResult(metadata, rules) {
  const plan = basePlan();
  plan.sourceContainer = metadata?.container ?? null;
  plan.sourceCodec = metadata?.codec ?? null;
  plan.targetChannels = metadata?.channels === 1 ? 1 : 2;
  plan.targetSampleRate = finitePositive(metadata?.sampleRate) ? metadata.sampleRate : null;
  plan.targetMaxBytes = rules?.maxBytes ?? 0;
  return plan;
}

function metadataProblems(metadata) {
  const problems = [];
  if (!isRecord(metadata)) return ['AUDIO_METADATA_INVALID'];
  if (metadata.mediaKind && metadata.mediaKind !== 'audio') problems.push('AUDIO_CODEC_UNSUPPORTED');
  if (!supportedAudioSource(metadata)) problems.push('AUDIO_CODEC_UNSUPPORTED');
  if (!finitePositive(metadata.size)) problems.push('AUDIO_METADATA_INVALID');
  if (!finitePositive(metadata.durationMs)) problems.push('AUDIO_METADATA_INVALID');
  if (!finitePositive(metadata.sampleRate)) problems.push('AUDIO_METADATA_INVALID');
  if (!Number.isInteger(metadata.channels) || ![1, 2].includes(metadata.channels)) {
    problems.push('AUDIO_METADATA_INVALID');
  }
  if (metadata.errorCode) problems.push(metadata.errorCode);
  return [...new Set(problems)];
}

function durationBounds(metadata, rules, plan) {
  const durationMax = rules?.duration?.maxMs;
  const durationMin = rules?.duration?.minMs;
  if (Number.isFinite(durationMax) && metadata.durationMs > durationMax) {
    pushUnique(plan.unfixable, 'AUDIO_DURATION_LIMIT_UNFIXABLE');
  }
  if (Number.isFinite(durationMin) && metadata.durationMs < durationMin) {
    pushUnique(plan.unfixable, 'AUDIO_DURATION_LIMIT_UNFIXABLE');
  }
}

function semanticStops(rules, plan) {
  const flags = new Set(Array.isArray(rules?.safetyFlags) ? rules.safetyFlags : []);
  const semantics = Array.isArray(rules?.semanticRequirements) ? rules.semanticRequirements : [];
  const text = semantics.join(' ');
  if (/(?:官方|审核工具)/.test(text)) flags.add('OFFICIAL_TOOL_REQUIRED');
  if (/(?:原始|证据原件|原文件)/.test(text)) flags.add('AUDIO_ORIGINAL_REQUIRED');
  if (/(?:无损|lossless)/i.test(text)) flags.add('AUDIO_LOSSLESS_REQUIRED');
  for (const flag of flags) {
    if (['OFFICIAL_TOOL_REQUIRED', 'AUDIO_ORIGINAL_REQUIRED', 'AUDIO_LOSSLESS_REQUIRED'].includes(flag)) {
      pushUnique(plan.unfixable, flag);
    }
  }
}

function estimateBytes(durationSeconds, bitrateKbps, safeTargetBytes, maxBytes) {
  const audioBytes = durationSeconds * bitrateKbps * 1000 / 8;
  if (!finiteNonNegative(audioBytes) || !Number.isSafeInteger(Math.ceil(audioBytes))) {
    return { min: 0, max: 0 };
  }
  const min = Math.max(1, Math.min(maxBytes, Math.floor(audioBytes * 0.90)));
  const max = Math.max(min, Math.min(maxBytes, Math.ceil(audioBytes * 1.05 + AUDIO_CONTAINER_RESERVE_BYTES)));
  // The estimate is advisory.  It must never advertise an impossible size.
  return {
    min: Math.min(min, safeTargetBytes > 0 ? safeTargetBytes : maxBytes),
    max: Math.min(max, maxBytes)
  };
}

function addPlanConfirmations(plan, metadata, needsTranscode, needsDownmix) {
  const sourceMime = normalizeMime(metadata?.signatureMime);
  if (needsTranscode) {
    plan.confirmations.push(expectedConfirmation('AUDIO_LOSSY_TRANSCODE', {
      fromMime: sourceMime,
      toMime: MP3_MIME,
      originalBytes: metadata.size,
      safeTargetBytes: plan.safeTargetBytes,
      bitrateKbps: plan.targetBitrateKbps,
      channels: plan.targetChannels
    }));
  }
  if (needsDownmix) {
    plan.confirmations.push(expectedConfirmation('AUDIO_DOWNMIX_MONO', {
      fromMime: sourceMime,
      toMime: MP3_MIME,
      originalBytes: metadata.size,
      safeTargetBytes: plan.safeTargetBytes,
      bitrateKbps: plan.targetBitrateKbps,
      channels: 1
    }));
  }
}

/**
 * Build a deterministic, immutable-by-convention audio processing plan.  The
 * function only consumes safe metadata and rules; it never reads a File or
 * changes either input object.
 */
export function createAudioProcessingPlan(metadata, rules, options = {}) {
  const plan = planResult(metadata, rules);
  const problems = metadataProblems(metadata);
  for (const code of problems) pushUnique(plan.unfixable, code);

  if (!isRecord(rules)) {
    pushUnique(plan.unfixable, 'RULES_INSUFFICIENT');
    return plan;
  }

  const maxBytes = rules.maxBytes;
  const reserve = AUDIO_CONTAINER_RESERVE_BYTES;
  if (!Number.isFinite(maxBytes) || !Number.isSafeInteger(maxBytes) || maxBytes <= reserve) {
    pushUnique(plan.unfixable, 'RULES_INSUFFICIENT');
    if (Number.isFinite(maxBytes) && maxBytes > 0 && maxBytes <= reserve) {
      pushUnique(plan.unfixable, 'AUDIO_TARGET_UNSAFE');
    }
  } else {
    plan.targetMaxBytes = maxBytes;
    plan.safeTargetBytes = Math.min(
      Math.floor(maxBytes * AUDIO_SAFE_TARGET_RATIO),
      maxBytes - reserve
    );
    if (maxBytes <= MINIMUM_USABLE_MAX_BYTES) {
      pushUnique(plan.unfixable, 'AUDIO_TARGET_UNSAFE');
    }
    if (!Number.isSafeInteger(plan.safeTargetBytes) || plan.safeTargetBytes <= 0) {
      pushUnique(plan.unfixable, 'AUDIO_TARGET_UNSAFE');
    }
  }

  const sourceMime = normalizeMime(metadata?.signatureMime);
  const strategy = qualityStrategy(options);
  const baseCompliant = problems.length === 0
    && supportedAudioSource(metadata)
    && (sourceMime !== 'audio/wav' || explicitMp3Allowed(rules))
    && metadata.size <= maxBytes
    && sourceAllowed(metadata, rules);

  durationBounds(metadata, rules, plan);
  semanticStops(rules, plan);

  const durationSeconds = finitePositive(metadata?.durationMs)
    ? metadata.durationMs / 1000
    : null;
  let rawBitrateKbps = null;
  if (durationSeconds && plan.safeTargetBytes > 0) {
    const reserveBits = reserve * 8;
    const rawBitsPerSecond = (plan.safeTargetBytes * 8 - reserveBits) / durationSeconds;
    rawBitrateKbps = Number.isFinite(rawBitsPerSecond) && rawBitsPerSecond > 0
      ? Math.floor(rawBitsPerSecond / 1000)
      : null;
  }
  const selected = selectBitrate(rawBitrateKbps);
  const canPassthroughWithoutReencode = baseCompliant
    && !strategy.requestedChannels
    && strategy.minimumStereo === null;
  if (selected === null) {
    if (!canPassthroughWithoutReencode && plan.safeTargetBytes > 0 && durationSeconds) {
      pushUnique(plan.unfixable, 'AUDIO_TARGET_UNSAFE');
    }
    plan.targetBitrateKbps = AUDIO_MIN_BITRATE_KBPS;
  } else {
    plan.targetBitrateKbps = selected;
  }

  const qualityNeedsMono = metadata?.channels === 2
    && (strategy.requestedChannels || (strategy.minimumStereo !== null
      && plan.targetBitrateKbps < strategy.minimumStereo));
  const compliant = baseCompliant && !qualityNeedsMono;

  // ADR-006 unlocks the verified Worker decode subset: MPEG Layer III,
  // AAC-LC in non-fragmented M4A, and the existing PCM WAV path.  A compliant
  // source that the page already allows remains an identity passthrough.
  const encodableSource = supportedAudioSource(metadata);
  if (!compliant && problems.length === 0 && !explicitMp3Allowed(rules)) {
    pushUnique(plan.unfixable, 'AUDIO_OUTPUT_FORMAT_NOT_ALLOWED');
  }
  if (!compliant && problems.length === 0 && !encodableSource) {
    pushUnique(plan.unfixable, 'AUDIO_CODEC_UNSUPPORTED');
  }
  const stopped = plan.unfixable.length > 0;
  const needsDownmix = !compliant && qualityNeedsMono && !stopped;

  if (needsDownmix) {
    plan.targetChannels = 1;
    pushUnique(plan.operations, 'DOWNMIX_MONO');
  } else if (metadata?.channels === 1) {
    plan.targetChannels = 1;
  }

  const needsTranscode = !compliant && problems.length === 0 && !stopped;
  if (needsTranscode) {
    if (sourceMime === MP3_MIME && metadata.container === MP3_CONTAINER && metadata.codec === MP3_CODEC) {
      pushUnique(plan.operations, 'REENCODE_AUDIO');
    } else {
      pushUnique(plan.operations, 'TRANSCODE_AUDIO');
    }
    // The frozen encoder silently lowers its output rate at low bitrates; the
    // plan must promise the rate the encoder will actually emit so the final
    // re-validation can verify it.
    const frozenRate = frozenEncoderOutputSampleRate(
      plan.targetSampleRate, plan.targetChannels, plan.targetBitrateKbps
    );
    if (frozenRate) plan.targetSampleRate = frozenRate;
  }
  if (plan.targetSampleRate && finitePositive(metadata?.sampleRate)
    && plan.targetSampleRate !== metadata.sampleRate) pushUnique(plan.operations, 'RESAMPLE_AUDIO');

  if (needsTranscode) addPlanConfirmations(plan, metadata, true, needsDownmix);
  else if (needsDownmix) addPlanConfirmations(plan, metadata, false, true);

  const operationOrder = ['TRANSCODE_AUDIO', 'REENCODE_AUDIO', 'RESAMPLE_AUDIO', 'DOWNMIX_MONO'];
  plan.operations.sort((first, second) => operationOrder.indexOf(first) - operationOrder.indexOf(second));

  if (compliant && plan.unfixable.length === 0) {
    plan.passthrough = true;
    plan.executable = true;
    plan.operations = [];
    plan.confirmations = [];
    const sourceKbps = Number.isFinite(metadata.averageBitrate)
      ? metadata.averageBitrate / 1000
      : plan.targetBitrateKbps;
    plan.targetBitrateKbps = selectBitrate(sourceKbps) ?? plan.targetBitrateKbps;
    plan.estimatedOutputBytes = { min: metadata.size, max: Math.min(metadata.size, maxBytes) };
    return plan;
  }

  if (plan.unfixable.length === 0 && plan.safeTargetBytes > 0 && selected !== null) {
    plan.estimatedOutputBytes = estimateBytes(
      durationSeconds,
      plan.targetBitrateKbps,
      plan.safeTargetBytes,
      plan.targetMaxBytes
    );
  }
  plan.executable = plan.unfixable.length === 0
    && plan.confirmations.every((item) => item.resolved === true && item.accepted === true);
  return plan;
}

export function resolveAudioConfirmation(plan, confirmation) {
  if (!isRecord(plan) || !Array.isArray(plan.confirmations) || !isRecord(confirmation)) {
    throw new TypeError('Audio confirmation is not valid.');
  }
  const index = plan.confirmations.findIndex((item) => item?.id === confirmation.id);
  if (index < 0) throw new Error('Audio confirmation is stale or forged.');
  const current = plan.confirmations[index];
  if (!CONFIRMATION_TYPES.includes(current.type) || confirmation.type !== current.type) {
    throw new Error('Audio confirmation type does not match the current plan.');
  }
  if (current.required !== true || (confirmation.required !== undefined && confirmation.required !== true)) {
    throw new Error('Audio confirmation is not required by the current plan.');
  }
  if (current.resolved === true) throw new Error('Audio confirmation was already resolved.');
  const accepted = confirmation.accepted === true;
  const declined = confirmation.accepted === false;
  if (!accepted && !declined) throw new Error('Audio confirmation must be accepted or declined.');

  const authorityKeys = ['bitrateKbps', 'channels', 'maxBytes', 'targetMaxBytes', 'safeTargetBytes', 'targetChannels'];
  if (authorityKeys.some((key) => Object.prototype.hasOwnProperty.call(confirmation, key))) {
    throw new Error('Audio confirmation cannot provide processing parameters.');
  }

  if (confirmation.suggestedPayload !== undefined
    && stableJson(confirmation.suggestedPayload) !== stableJson(current.suggestedPayload)) {
    throw new Error('Audio confirmation proposal is stale.');
  }

  if (confirmation.payload !== undefined && confirmation.payload !== null) {
    if (!isRecord(confirmation.payload)
      || stableJson(confirmation.payload) !== stableJson(current.suggestedPayload)) {
      throw new Error('Audio confirmation payload cannot change the processing plan.');
    }
  }
  const next = clone(plan);
  next.confirmations[index] = {
    ...clone(current),
    resolved: true,
    accepted,
    payload: null
  };
  next.executable = next.unfixable.length === 0
    && next.confirmations.every((item) => item.required !== true
      || (item.resolved === true && item.accepted === true));
  return next;
}

export function lowerAudioBitrate(current) {
  return lowerBitrate(current);
}

export function isAudioPlanExecutable(plan) {
  return Boolean(plan?.executable === true
    && plan?.mediaKind === 'audio'
    && plan?.targetMime === MP3_MIME
    && Number.isSafeInteger(plan?.targetMaxBytes)
    && plan.targetMaxBytes > 0
    && Number.isSafeInteger(plan?.safeTargetBytes)
    && plan.safeTargetBytes > 0
    && plan.safeTargetBytes <= plan.targetMaxBytes
    && AUDIO_BITRATE_LADDER_KBPS.includes(plan.targetBitrateKbps)
    && plan.targetBitrateKbps >= AUDIO_MIN_BITRATE_KBPS
    && Array.isArray(plan.unfixable)
    && plan.unfixable.length === 0
    && Array.isArray(plan.confirmations)
    && plan.confirmations.every((item) => item.required !== true
      || (item.resolved === true && item.accepted === true)));
}

export {
  AUDIO_BITRATE_LADDER_KBPS,
  MINIMUM_USABLE_MAX_BYTES,
  explicitMp3Allowed,
  lowerBitrate,
  sourceAllowed,
  supportedAudioSource
};

export const createAudioPlan = createAudioProcessingPlan;
export const planAudio = createAudioProcessingPlan;
export const buildAudioPlan = createAudioProcessingPlan;
export const resolveAudioProcessingConfirmation = resolveAudioConfirmation;
export const resolveConfirmation = resolveAudioConfirmation;
