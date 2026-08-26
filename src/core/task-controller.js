import {
  AUTO_RULE_CONFIDENCE,
  CONFIRM_RULE_CONFIDENCE,
  CONTEXT_TEXT_LIMIT,
  MAX_AUTO_RETRIES
} from '../config.js';
import {
  extractRelevantContext,
  selectAiRelevantText
} from '../dom/context-extractor.js';
import {
  createUploaderDiscovery
} from '../dom/input-discovery.js';
import {
  observeRejection
} from '../dom/rejection-observer.js';
import { parseRulesDeterministically } from '../rules/deterministic-parser.js';
import { resolveRules } from '../rules/resolver.js';
import { safetyErrorCode } from '../rules/safety-semantics.js';
import {
  createProcessingPlan,
  resolveProcessingConfirmation
} from '../image/planner.js';
import { inspectImage, validateFile } from '../image/metadata.js';
import { processImage } from '../image/canvas-pipeline.js';
import {
  injectFile,
  restoreOriginal
} from '../injection/file-injector.js';
import {
  armInjectionGuard,
  clearInjectionGuard,
  consumeInjectionGuard
} from '../injection/injection-guard.js';
import { asImageProcessingError } from '../image/errors.js';
import { createRandomId } from '../utils/ids.js';
import { createLogger } from '../utils/logger.js';
import { sanitizeEvidenceText } from '../utils/text.js';
import { createAdapterRegistry } from '../adapters/registry.js';
import { classifyMediaKind } from '../dom/input-discovery.js';
import { AUDIO_ERROR_CODES } from '../audio/errors.js';
import { pageAllowsMp3 } from '../audio/validators.js';
import { createMediaHandlerRegistry, createImageHandler } from './media-handlers.js';
import { createCleanupRegistry } from './cleanup.js';
import { createStateMachine } from './state-machine.js';

const TERMINAL_TASK_STATES = new Set(['STOPPED', 'DISPOSED', 'PASSTHROUGH']);
const MAX_RETAINED_TASKS = 2;
const ACTIVE_TASK_STATES = new Set([
  'ARMED',
  'INSPECTING',
  'WAITING_REJECTION',
  'NEEDS_CONFIRMATION',
  'PROCESSING',
  'INJECTING',
  'RETRYING',
  'SUCCESS',
  'PASSTHROUGH'
]);
const EVENT_CONSTRUCTOR_FALLBACK = globalThis.Event;

function cloneValue(value, seen = new WeakMap()) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    for (const item of value) result.push(cloneValue(item, seen));
    return result;
  }
  const result = {};
  seen.set(value, result);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'function') continue;
    result[key] = cloneValue(item, seen);
  }
  return result;
}

function safeRuleSet(rules) {
  if (!rules || typeof rules !== 'object') return null;
  let evidenceUsed = 0;
  const safeSources = (rules.sources ?? []).map((source) => {
    const evidence = [];
    for (const item of source.evidence ?? []) {
      const safeItem = sanitizeEvidenceText(item).slice(0, CONTEXT_TEXT_LIMIT);
      const available = CONTEXT_TEXT_LIMIT - evidenceUsed;
      if (!safeItem || available <= 0) break;
      const bounded = safeItem.slice(0, available);
      evidence.push(bounded);
      evidenceUsed += bounded.length;
      if (bounded.length < safeItem.length) break;
    }
    return {
      type: source.type,
      priority: source.priority,
      confidence: source.confidence,
      advisoryOnly: Boolean(source.advisoryOnly),
      evidence
    };
  });
  return {
    mediaKind: rules.mediaKind ?? null,
    formats: [...(rules.formats ?? [])],
    extensions: [...(rules.extensions ?? [])],
    minBytes: rules.minBytes ?? null,
    maxBytes: rules.maxBytes ?? null,
    duration: cloneValue(rules.duration ?? { exactMs: null, minMs: null, maxMs: null }),
    audio: cloneValue(rules.audio ?? { sampleRates: [], channels: [], bitDepths: [] }),
    width: cloneValue(rules.width ?? { exact: null, min: null, max: null }),
    height: cloneValue(rules.height ?? { exact: null, min: null, max: null }),
    aspectRatio: cloneValue(rules.aspectRatio),
    dpi: rules.dpi ?? null,
    count: cloneValue(rules.count ?? { max: null }),
    background: rules.background ?? null,
    semanticRequirements: [...(rules.semanticRequirements ?? [])],
    confidence: rules.confidence ?? 0,
    sources: safeSources,
    conflicts: (rules.conflicts ?? []).map((conflict) => ({
      field: conflict.field,
      reason: conflict.reason,
      unresolvable: Boolean(conflict.unresolvable),
      values: cloneValue(conflict.values)
    })),
    advisories: (rules.advisories ?? []).map((advisory) => ({
      sourceType: advisory.sourceType,
      rules: safeRuleSet(advisory.rules)
    })),
    safetyFlags: [...(rules.safetyFlags ?? [])],
    actionable: Boolean(rules.actionable)
  };
}

function safeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  return {
    mediaKind: metadata.mediaKind ?? (String(metadata.mime ?? metadata.signatureMime ?? '').startsWith('audio/') ? 'audio' : 'image'),
    mime: metadata.mime ?? metadata.signatureMime ?? null,
    container: metadata.container ?? null,
    codec: metadata.codec ?? null,
    size: Number.isFinite(metadata.size) ? metadata.size : null,
    width: Number.isFinite(metadata.width) ? metadata.width : null,
    height: Number.isFinite(metadata.height) ? metadata.height : null,
    displayWidth: Number.isFinite(metadata.displayWidth) ? metadata.displayWidth : null,
    displayHeight: Number.isFinite(metadata.displayHeight) ? metadata.displayHeight : null,
    durationMs: Number.isFinite(metadata.durationMs) ? metadata.durationMs : null,
    sampleRate: Number.isFinite(metadata.sampleRate) ? metadata.sampleRate : null,
    channels: Number.isFinite(metadata.channels) ? metadata.channels : null,
    bitrateKbps: Number.isFinite(metadata.averageBitrate)
      ? Math.round(metadata.averageBitrate / 1000)
      : null,
    progress: Number.isFinite(metadata.progress) ? Math.max(0, Math.min(1, metadata.progress)) : 0,
    errorCode: metadata.errorCode ?? null
  };
}

function safeValidation(validation) {
  if (!validation || typeof validation !== 'object') return null;
  return {
    valid: Boolean(validation.valid),
    violations: (validation.violations ?? []).map((item) => ({
      code: item.code,
      expected: cloneValue(item.expected),
      actual: cloneValue(item.actual)
    })),
    warnings: (validation.warnings ?? []).map((item) => ({ code: item.code })),
    safeAutoFixes: [...(validation.safeAutoFixes ?? [])],
    requiredConfirmations: (validation.requiredConfirmations ?? []).map((item) => ({
      type: item.type,
      required: Boolean(item.required)
    })),
    unfixable: [...(validation.unfixable ?? [])]
  };
}

function safePlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  return {
    mediaKind: plan.mediaKind ?? null,
    sourceContainer: plan.sourceContainer ?? null,
    sourceCodec: plan.sourceCodec ?? null,
    targetMime: plan.targetMime ?? null,
    targetContainer: plan.targetContainer ?? null,
    targetCodec: plan.targetCodec ?? null,
    targetWidth: plan.targetWidth ?? null,
    targetHeight: plan.targetHeight ?? null,
    targetMaxBytes: plan.targetMaxBytes ?? null,
    safeTargetBytes: plan.safeTargetBytes ?? null,
    targetBitrateKbps: plan.targetBitrateKbps ?? null,
    targetSampleRate: plan.targetSampleRate ?? null,
    targetChannels: plan.targetChannels ?? null,
    estimatedOutputBytes: cloneValue(plan.estimatedOutputBytes),
    encodePassLimit: plan.encodePassLimit ?? null,
    crop: cloneValue(plan.crop),
    proposedCrop: cloneValue(plan.proposedCrop),
    flattenBackground: cloneValue(plan.flattenBackground),
    proposedFlattenBackground: cloneValue(plan.proposedFlattenBackground),
    qualityRange: cloneValue(plan.qualityRange),
    targetMinBytes: plan.targetMinBytes ?? null,
    operations: [...(plan.operations ?? [])],
    confirmations: (plan.confirmations ?? []).map((item) => ({
      id: item.id,
      type: item.type,
      required: Boolean(item.required),
      resolved: Boolean(item.resolved),
      accepted: item.accepted === true ? true : item.accepted === false ? false : null,
      payload: cloneValue(item.payload),
      suggestedPayload: cloneValue(item.suggestedPayload)
    })),
    warnings: (plan.warnings ?? []).map((item) => ({ code: item.code })),
    executable: Boolean(plan.executable),
    passthrough: Boolean(plan.passthrough),
    unfixable: [...(plan.unfixable ?? [])],
    validation: safeValidation(plan.validation)
  };
}

function safeResult(result) {
  if (!result || typeof result !== 'object') return null;
  return {
    metadata: safeMetadata(result.metadata),
    operations: [...(result.operations ?? [])],
    validation: safeValidation(result.validation),
    durationMs: Number.isFinite(result.durationMs) ? result.durationMs : null,
    inputBytesRead: Number.isFinite(result.inputBytesRead) ? result.inputBytesRead : null,
    outputBytes: Number.isFinite(result.outputBytes) ? result.outputBytes : null,
    encodePasses: Number.isFinite(result.encodePasses) ? result.encodePasses : null,
    peakBufferedBytes: Number.isFinite(result.peakBufferedBytes) ? result.peakBufferedBytes : null,
    warnings: (result.warnings ?? []).map((item) => ({ code: item.code })),
    passthrough: Boolean(result.passthrough),
    workerUsed: Boolean(result.workerUsed)
  };
}

function createAbortController() {
  if (typeof AbortController === 'function') return new AbortController();
  const signal = { aborted: false };
  return {
    signal,
    abort() {
      signal.aborted = true;
    }
  };
}

function fileConstructor(input) {
  return input?.ownerDocument?.defaultView?.File
    ?? globalThis.File;
}

function isFileForInput(input, file) {
  const Constructor = fileConstructor(input);
  return typeof Constructor === 'function' && file instanceof Constructor;
}

function inputContainsFile(input, expected) {
  const actual = input?.files?.[0];
  return Boolean(actual && expected
    && actual.name === expected.name
    && actual.type === expected.type
    && actual.size === expected.size);
}

function quickViolations(file, rules) {
  const violations = [];
  if (rules?.formats?.length && typeof file?.type === 'string'
    && !rules.formats.includes(file.type.toLowerCase())) {
    violations.push('FORMAT_NOT_ALLOWED');
  }
  if (Number.isFinite(rules?.maxBytes) && file?.size > rules.maxBytes) {
    violations.push('FILE_TOO_LARGE');
  }
  if (Number.isFinite(rules?.minBytes) && file?.size < rules.minBytes) {
    violations.push('FILE_TOO_SMALL');
  }
  return violations;
}

function requiresAsyncDecision(rules) {
  if (!rules?.actionable) return false;
  const hasDimensionConstraint = [rules.width, rules.height]
    .some((rule) => Object.values(rule ?? {}).some((value) => Number.isFinite(value)));
  return hasDimensionConstraint
    || Boolean(rules.aspectRatio)
    || Boolean(rules.formats?.length)
    || rules.background !== null && rules.background !== undefined;
}

function hasRequiredConfirmation(plan) {
  return Boolean(plan?.confirmations?.some((item) => item.required && !item.resolved));
}

function createRuleConfidenceConfirmation() {
  return {
    id: createRandomId('confirmation'),
    type: 'RULE_CONFIDENCE',
    required: true,
    resolved: false,
    accepted: null,
    payload: null
  };
}

function safeConfirmation(confirmation) {
  if (!confirmation || typeof confirmation !== 'object') return null;
  return {
    id: confirmation.id ?? null,
    type: confirmation.type ?? null,
    required: Boolean(confirmation.required),
    resolved: Boolean(confirmation.resolved),
    accepted: confirmation.accepted === true ? true : confirmation.accepted === false ? false : null,
    payload: cloneValue(confirmation.payload)
  };
}

function stableErrorCode(error, fallback = 'PROCESSING_FAILED') {
  if (AUDIO_ERROR_CODES.includes(error?.code)) return error.code;
  return asImageProcessingError(error, fallback).code;
}

function normalizeAudioRuleValue(value) {
  const normalized = String(value ?? '').trim().toLowerCase().split(';', 1)[0];
  if (normalized === 'audio/mp3') return 'audio/mpeg';
  return normalized.replace(/^\./, '');
}

function normalizedAudioRuleSet(rules, field) {
  const values = Array.isArray(rules?.[field]) ? rules[field] : [];
  return new Set(values.map(normalizeAudioRuleValue).filter(Boolean));
}

function isProperSubset(subset, superset) {
  return subset.size > 0
    && subset.size < superset.size
    && [...subset].every((value) => superset.has(value));
}

function compareAllowedSet(previousRules, nextRules, field) {
  const previous = normalizedAudioRuleSet(previousRules, field);
  const next = normalizedAudioRuleSet(nextRules, field);
  const unchanged = previous.size === next.size
    && [...previous].every((value) => next.has(value));
  const nextIsSubset = next.size > 0
    && [...next].every((value) => previous.has(value));
  return {
    broader: !unchanged && !nextIsSubset,
    tightened: isProperSubset(next, previous)
  };
}

function compareBound(previousValue, nextValue, direction) {
  const previousFinite = Number.isFinite(previousValue);
  const nextFinite = Number.isFinite(nextValue);
  if (!previousFinite && !nextFinite) return { broader: false, tightened: false };
  if (!previousFinite && nextFinite) return { broader: false, tightened: true };
  if (previousFinite && !nextFinite) return { broader: true, tightened: false };
  if (nextValue === previousValue) return { broader: false, tightened: false };
  return direction === 'lower-is-tighter'
    ? { broader: nextValue > previousValue, tightened: nextValue < previousValue }
    : { broader: nextValue < previousValue, tightened: nextValue > previousValue };
}

function hasAudioDurationRule(rules) {
  return Object.values(rules?.duration ?? {})
    .some((value) => Number.isFinite(value));
}

function hasAudioSafetySemantic(rules) {
  if ((rules?.safetyFlags ?? []).length > 0) return true;
  const text = (rules?.semanticRequirements ?? []).join(' ');
  return /(?:官方|审核工具|原始|证据原件|原文件|无损|lossless)/i.test(text);
}

/**
 * Rejection retry is allowed only when the new audio rules change the
 * executable plan in a strictly safer direction.  Evidence/source changes,
 * duplicate rules, and looser rules deliberately return false.
 */
export function isStrictlyMoreSpecificAudioRejection(previousRules, nextRules) {
  if (!previousRules || !nextRules
    || previousRules.mediaKind !== 'audio'
    || nextRules.mediaKind !== 'audio'
    || !nextRules.actionable
    || !pageAllowsMp3(nextRules)
    || hasAudioDurationRule(nextRules)
    || hasAudioSafetySemantic(nextRules)
    || (nextRules.conflicts ?? []).some((item) => item.unresolvable)) {
    return false;
  }

  const maxRelation = compareBound(
    previousRules.maxBytes,
    nextRules.maxBytes,
    'lower-is-tighter'
  );
  const formatsRelation = compareAllowedSet(previousRules, nextRules, 'formats');
  const extensionsRelation = compareAllowedSet(previousRules, nextRules, 'extensions');
  // S3 has no safe operation that can make an input larger.  A lower bound
  // therefore never authorizes a retry; only a smaller output ceiling or a
  // proper format/extension narrowing can change the executable MP3 plan.
  if ([maxRelation, formatsRelation, extensionsRelation].some((item) => item.broader)) {
    return false;
  }
  return [maxRelation, formatsRelation, extensionsRelation]
    .some((item) => item.tightened);
}

function planStopCode(task, plan) {
  const stops = Array.isArray(plan?.unfixable) ? plan.unfixable : [];
  // A duration-only page is a distinct safety stop.  Do not let generic
  // missing-format/size diagnostics mask the fact that S3 never trims or
  // splits audio.
  if (task?.mediaKind === 'audio'
    && stops.includes('AUDIO_DURATION_LIMIT_UNFIXABLE')
    && !Number.isFinite(task.rules?.maxBytes)) {
    return 'AUDIO_DURATION_LIMIT_UNFIXABLE';
  }
  if (stops.includes('RULE_CONFLICT')) return 'RULE_CONFLICT';
  return stops[0] ?? null;
}

function isTaskCurrent(task, record) {
  if (!task || record?.currentTask !== task) return false;
  if (task.abortController?.signal?.aborted === true) return false;
  if (task.source === 'manual-card' && !task.inputElement) return true;
  return Boolean(task.inputElement?.isConnected);
}

function hasSubstantiveRules(rules) {
  if (!rules) return false;
  return Boolean(
    rules.formats?.length
      || Number.isFinite(rules.minBytes)
      || Number.isFinite(rules.maxBytes)
      || Object.values(rules.width ?? {}).some((value) => Number.isFinite(value))
      || Object.values(rules.height ?? {}).some((value) => Number.isFinite(value))
      || Number.isFinite(rules.aspectRatio?.value)
      || rules.semanticRequirements?.length
  );
}

/**
 * 任务书 50-S4 §10.1：本地规则"不完整"时才允许调用 AI。完整 = 可校验的
 * 机器约束齐备（格式 + 尺寸/比例 + 大小边界），仅含语义要求不算完整。
 */
function machineRulesComplete(rules) {
  if (!rules?.actionable) return false;
  const hasDimensions = Object.values(rules.width ?? {}).some((value) => Number.isFinite(value))
    || Object.values(rules.height ?? {}).some((value) => Number.isFinite(value))
    || Number.isFinite(rules.aspectRatio?.value);
  const hasSize = Number.isFinite(rules.minBytes) || Number.isFinite(rules.maxBytes);
  return Boolean(rules.formats?.length) && hasDimensions && hasSize;
}

function taskCanBeObserved(task) {
  return ACTIVE_TASK_STATES.has(task?.status);
}

function isBusinessClickTarget(target) {
  return Boolean(target?.closest?.(
    'button, [type="submit"], [role="button"], a'
  ));
}

/**
 * The sole cross-module S3 orchestrator.
 */
export class TaskController {
  constructor(options = {}) {
    this.documentRef = options.documentRef ?? globalThis.document ?? null;
    this.globalRef = options.globalRef ?? this.documentRef?.defaultView ?? globalThis;
    this.sessionId = options.sessionId ?? createRandomId('session');
    this.logger = options.logger ?? createLogger();
    this.adapterRegistry = options.adapterRegistry
      ?? createAdapterRegistry({ adapters: options.adapters ?? [] });
    this.discovery = options.discovery ?? null;
    this.inspectImage = options.inspectImageFn ?? options.inspectImage ?? inspectImage;
    this.validateFile = options.validateFileFn ?? options.validateFile ?? validateFile;
    this.createProcessingPlan = options.createProcessingPlanFn
      ?? options.createProcessingPlan
      ?? createProcessingPlan;
    this.resolveProcessingConfirmation = options.resolveProcessingConfirmationFn
      ?? options.resolveProcessingConfirmation
      ?? resolveProcessingConfirmation;
    this.processImage = options.processImageFn ?? options.processImage ?? processImage;
    // Keep the existing image functions injectable for V1 tests/adapters while
    // routing every task through the shared media handler registry.
    this.mediaHandlers = options.mediaHandlerRegistry
      ?? options.mediaHandlers
      ?? createMediaHandlerRegistry({
        imageHandler: options.imageHandler ?? createImageHandler({
          inspect: this.inspectImage,
          validate: this.validateFile,
          plan: this.createProcessingPlan,
          resolveConfirmation: this.resolveProcessingConfirmation,
          process: this.processImage,
          validateOutput: options.validateImageOutput
            ?? ((metadata, rules) => this.validateFile(metadata, rules))
        }),
        audioHandler: options.audioHandler,
        audio: options.audio
      });
    this.injectFile = options.injectFileFn ?? options.injectFile ?? injectFile;
    this.restoreOriginal = options.restoreOriginalFn ?? options.restoreOriginal ?? restoreOriginal;
    this.observeRejection = options.observeRejectionFn
      ?? options.observeRejection
      ?? observeRejection;
    this.parseRules = options.parseRulesFn ?? options.parseRules ?? parseRulesDeterministically;
    this.resolveRules = options.resolveRulesFn ?? options.resolveRules ?? resolveRules;
    this.confirmationResolver = options.confirmationResolver ?? null;
    this.ruleProvider = options.ruleProvider ?? null;
    this.manualRecords = new Map();
    this.pageCard = null;
    this.pageCardRules = null;
    this.resources = createCleanupRegistry();
    this.sessionMachine = createStateMachine({
      initial: 'BOOTING',
      onTransition: () => this._publish(),
      onInvalid: (diagnostic) => {
        this.diagnostics.push(diagnostic);
      }
    });
    this.uploaders = new Map();
    this.tasks = new Map();
    this.queue = [];
    this.listeners = new Set();
    this.diagnostics = [];
    this.processingTask = null;
    this.taskSequence = 0;
    this.started = false;
    this.disposed = false;
    this.clickListener = null;
    this.changeCaptureListener = null;
    this.handledEvents = new WeakSet();
  }

  _mediaKindForContext(context, file = null) {
    if (context?.mediaKind === 'audio' || context?.mediaKind === 'image') {
      return context.mediaKind;
    }
    const classified = classifyMediaKind(context?.input, file?.type ?? null);
    return classified === 'audio' ? 'audio' : 'image';
  }

  _handlerForTask(task) {
    return this.mediaHandlers?.get?.(task?.mediaKind ?? 'image')
      ?? this.mediaHandlers?.resolve?.(task?.mediaKind ?? 'image', task?.originalFile, {
        mediaKind: task?.mediaKind,
        multiple: false
      });
  }

  _handlerForRecord(record, file = null) {
    const mediaKind = this._mediaKindForContext(record?.context, file);
    return this.mediaHandlers?.resolve?.(mediaKind, file, {
      ...(record?.context ?? {}),
      mediaKind
    }) ?? this.mediaHandlers?.get?.(mediaKind);
  }

  _audioLog(task, event, fields = {}) {
    if (task?.mediaKind !== 'audio') return;
    this.logger.emit(`AUDIO_${event}`, {
      taskId: task.taskId,
      mediaKind: 'audio',
      ...fields
    });
  }

  start() {
    if (this.disposed) return this;
    if (this.started) return this;
    this.started = true;
    this.logger.emit('SESSION_STARTED', { taskId: this.sessionId });
    this.sessionMachine.transition('SCANNING');

    if (!this.discovery) {
      this.discovery = createUploaderDiscovery({
        root: this.documentRef,
        onDiscover: (context) => this.registerUploader(context),
        onRemove: (context) => this.unregisterUploader(context)
      });
    }

    if (this.documentRef?.addEventListener) {
      this.changeCaptureListener = (event) => {
        if (event?.type !== 'change' || this.disposed || this.handledEvents.has(event)) return;
        // S4：UploadFit UI host 内部的 file input（真实公开页准备卡）不参与业务上传器发现。
        if (event?.target?.closest?.('[data-uploadfit-ui-host]')) return;
        let input = event.target;
        let record = this.uploaders.get(input);
        if (!record) {
          const selectedMime = input?.files?.length === 1
            ? input.files[0]?.type
            : null;
          const context = this.discovery?.discoverFromEvent?.(event, selectedMime);
          input = context?.input ?? input;
          record = this.uploaders.get(input);
        }
        if (!record) return;
        this.handledEvents.add(event);
        const result = this.handleFileChange(event, record.context);
        result?.catch?.((error) => {
          if (record.currentTask) this._stopTask(
            record.currentTask,
            stableErrorCode(error),
            error
          );
        });
      };
      this.documentRef.addEventListener('change', this.changeCaptureListener, true);
      this.resources.add(() => this.documentRef.removeEventListener(
        'change',
        this.changeCaptureListener,
        true
      ));
    }
    this.discovery.start?.();

    if (this.documentRef?.addEventListener) {
      this.clickListener = (event) => {
        if (!isBusinessClickTarget(event.target)) return;
        for (const task of this.tasks.values()) {
          if (taskCanBeObserved(task)) task.businessClickCount += 1;
        }
      };
      this.documentRef.addEventListener('click', this.clickListener, true);
      this.resources.add(() => this.documentRef.removeEventListener(
        'click',
        this.clickListener,
        true
      ));
    }
    if (this.globalRef?.addEventListener) {
      this.resources.trackListener(
        this.globalRef,
        'pagehide',
        () => this.dispose(),
        { once: true }
      );
    }

    this.sessionMachine.transition('ARMED');
    this._publish();
    return this;
  }

  registerUploader(uploaderContext) {
    if (this.disposed || !uploaderContext?.input) return null;
    const input = uploaderContext.input;
    const existing = this.uploaders.get(input);
    if (existing) return existing.context;

    const url = uploaderContext.pageUrl ?? this.globalRef?.location?.href ?? '';
    const adapter = uploaderContext.adapter
      ?? this.adapterRegistry.resolve(url);
    const mediaKind = this._mediaKindForContext(uploaderContext);
    const context = {
      ...uploaderContext,
      mediaKind,
      adapter,
      nearbyTexts: [...(uploaderContext.nearbyTexts ?? [])],
      alertTexts: [...(uploaderContext.alertTexts ?? [])]
    };
    const record = {
      context,
      adapter,
      input,
      currentTask: null,
      listener: null,
      cleanupListener: null
    };
    record.listener = (event) => {
      if (this.handledEvents.has(event)) return;
      this.handledEvents.add(event);
      const result = this.handleFileChange(event, context);
      result?.catch?.((error) => {
        if (record.currentTask) this._stopTask(
          record.currentTask,
          stableErrorCode(error),
          error
        );
      });
    };
    input.addEventListener?.('change', record.listener, true);
    record.cleanupListener = () => {
      input.removeEventListener?.('change', record.listener, true);
      clearInjectionGuard(input);
    };
    this.uploaders.set(input, record);
    this.logger.emit('UPLOADER_DISCOVERED');
    this._publish();
    return context;
  }

  unregisterUploader(uploaderContext) {
    const input = uploaderContext?.input ?? uploaderContext;
    const record = this.uploaders.get(input);
    if (!record) return false;
    const task = record.currentTask;
    if (task && !TERMINAL_TASK_STATES.has(task.status)) {
      this._stopTask(task, 'INPUT_DETACHED');
    }
    record.currentTask = null;
    record.cleanupListener?.();
    this.uploaders.delete(input);
    this._pruneTasks();
    this._publish();
    return true;
  }

  _releaseTaskResources(task) {
    if (!task) return;
    const shouldLogAudioCleanup = task.mediaKind === 'audio';
    task.abortController?.abort?.();
    this._stopRejectionObserver(task);
    const urlApi = task.inputElement?.ownerDocument?.defaultView?.URL
      ?? this.globalRef?.URL
      ?? globalThis.URL;
    task.objectUrls?.splice?.(0).forEach((url) => urlApi?.revokeObjectURL?.(url));
    task.originalFile = null;
    task.processedFile = null;
    task.result = null;
    task.metadata = null;
    task.validation = null;
    task.outputValidation = null;
    task.plan = null;
    task.handler = null;
    task.contextBundle = null;
    task.ruleCandidates = [];
    task.event = null;
    if (shouldLogAudioCleanup) {
      this.logger.emit('AUDIO_RESOURCES_CLEANED', {
        taskId: task.taskId,
        mediaKind: 'audio'
      });
    }
  }

  _forgetTask(task) {
    if (!task || !this.tasks.has(task.taskId)) return false;
    this.queue = this.queue.filter((candidate) => candidate !== task);
    const record = this._recordForTask(task);
    if (record?.currentTask === task) record.currentTask = null;
    this.manualRecords.delete(task.taskId);
    this._releaseTaskResources(task);
    this.tasks.delete(task.taskId);
    return true;
  }

  _pruneTasks() {
    if (this.tasks.size <= MAX_RETAINED_TASKS) return;
    const disposable = [...this.tasks.values()]
      .filter((task) => task !== this.processingTask && (
        TERMINAL_TASK_STATES.has(task.status)
        || (task.status === 'SUCCESS' && !task.rejectionStopper?.active?.())
      ))
      .sort((left, right) => left.createdAt - right.createdAt);
    while (this.tasks.size > MAX_RETAINED_TASKS && disposable.length) {
      this._forgetTask(disposable.shift());
    }
  }

  _recordForTask(task) {
    if (!task) return null;
    return this.uploaders.get(task.inputElement)
      ?? this.manualRecords.get(task.taskId)
      ?? null;
  }

  _inputConnected(task) {
    if (task?.source === 'manual-card' && !task?.inputElement) return true;
    return Boolean(task?.inputElement?.isConnected);
  }

  _contextBundle(record, selectedText = null, alertTexts = []) {
    const input = record.input;
    let bundle;
    try {
      bundle = typeof record.adapter?.extractContext === 'function'
        ? record.adapter.extractContext(input, selectedText, {
          uploaderId: record.context.uploaderId
        })
        : extractRelevantContext(input, selectedText, {
          uploaderId: record.context.uploaderId
        });
    } catch {
      bundle = extractRelevantContext(input, selectedText, {
        uploaderId: record.context.uploaderId
      });
    }
    const mergedAlerts = [
      ...(bundle?.alertTexts ?? []),
      ...alertTexts
    ].filter(Boolean);
    const normalized = [
      ...(bundle?.normalizedText ? [bundle.normalizedText] : []),
      ...mergedAlerts
    ].join('\n').slice(0, 6000);
    return {
      ...bundle,
      uploaderId: record.context.uploaderId,
      alertTexts: mergedAlerts,
      normalizedText: normalized
    };
  }

  _resolveRules(record, selectedText = null, alertTexts = []) {
    const bundle = this._contextBundle(record, selectedText, alertTexts);
    const candidates = this.parseRules(bundle);
    const rules = this.resolveRules(candidates);
    this.logger.emit('CONTEXT_EXTRACTED');
    this.logger.emit('RULES_PARSED_LOCAL', { rules });
    if (rules.conflicts?.length) {
      this.logger.emit('RULE_CONFLICT', { rules });
    }
    return { bundle, candidates, rules };
  }

  _makeTask(record, file, event, rules, candidates, bundle) {
    const abortController = createAbortController();
    const stateMachine = createStateMachine({
      initial: 'ARMED',
      onTransition: () => this._publish(),
      onInvalid: (diagnostic) => {
        this.diagnostics.push({
          ...diagnostic,
          taskId: task?.taskId
        });
      }
    });
    const task = {
      taskId: createRandomId('task'),
      inputElement: record.input,
      uploaderId: record.context.uploaderId,
      mediaKind: this._mediaKindForContext(record.context, file),
      label: record.context.label ?? '',
      originalFile: file,
      processedFile: null,
      rules,
      ruleCandidates: candidates,
      contextBundle: bundle,
      source: 'preflight',
      status: 'ARMED',
      retryCount: 0,
      createdAt: Date.now(),
      sequence: ++this.taskSequence,
      objectUrls: [],
      warnings: [],
      result: null,
      metadata: null,
      validation: null,
      plan: null,
      policyConfirmation: null,
      abortController,
      stateMachine,
      eventBlocked: false,
      event,
      businessClickCount: 0,
      rejection: null,
      rejectionStopper: null,
      cancelled: false,
      retryDispatched: false,
      eventReleased: false,
      progress: null,
      handler: null
    };
    task.handler = this._handlerForRecord(record, file);
    return task;
  }

  async handleFileChange(event, uploaderContext) {
    if (this.disposed) return { ignored: 'SESSION_DISPOSED' };
    const input = uploaderContext?.input
      ?? event?.currentTarget
      ?? event?.target;
    const record = this.uploaders.get(input);
    if (!record || event?.type !== 'change') return { ignored: 'UNKNOWN_UPLOADER' };
    if (consumeInjectionGuard(input, event)) {
      return { ignored: 'INJECTION_GUARD' };
    }
    if (!input?.files?.length) return { ignored: 'EMPTY_FILE_LIST' };
    if (input.multiple && input.files.length > 1) {
      this._notify({ code: 'MULTIPLE_FILES_UNSUPPORTED', uploaderId: record.context.uploaderId });
      return { ignored: 'MULTIPLE_FILES_UNSUPPORTED' };
    }

    const file = input.files[0];
    if (!isFileForInput(input, file)) {
      return { ignored: 'FILE_UNAVAILABLE' };
    }
    const handler = this._handlerForRecord(record, file);
    if (!handler?.supports?.(file, { ...record.context, mediaKind: this._mediaKindForContext(record.context, file) })) {
      return { ignored: 'MEDIA_KIND_UNSUPPORTED' };
    }

    if (record.currentTask) {
      const previous = record.currentTask;
      if (taskCanBeObserved(previous)) {
        this._cancelTaskInternal(previous, 'USER_CANCELLED', false);
      }
    }
    const resolved = this._resolveRules(record);
    const task = this._makeTask(
      record,
      file,
      event,
      resolved.rules,
      resolved.candidates,
      resolved.bundle
    );
    record.currentTask = task;
    this.tasks.set(task.taskId, task);
    this._pruneTasks();
    this.logger.emit('FILE_SELECTED', {
      taskId: task.taskId,
      mime: file.type,
      bytes: file.size
    });

    const shouldInspect = resolved.rules.actionable
      || resolved.rules.safetyFlags?.length
      || resolved.rules.conflicts?.length;
    const quick = quickViolations(file, resolved.rules);
    const mediumConfidence = resolved.rules.confidence >= CONFIRM_RULE_CONFIDENCE
      && resolved.rules.confidence < AUTO_RULE_CONFIDENCE;
    const shouldBlockBeforeDecision = shouldInspect && (
      quick.length > 0
      || mediumConfidence
      || requiresAsyncDecision(resolved.rules)
    );
    if (shouldBlockBeforeDecision) {
      event.stopImmediatePropagation?.();
      event.preventDefault?.();
      task.eventBlocked = true;
    }

    this._transitionTask(task, 'INSPECTING');
    this._transitionSession('INSPECTING');
    if (!shouldInspect) {
      this._waitForRejection(task, record);
      return task;
    }

    await this._runPreflight(task, record);
    return task;
  }

  async _runPreflight(task, record) {
    if (record.currentTask === task && !this._inputConnected(task)) {
      this._stopTask(task, 'INPUT_DETACHED');
      return;
    }
    if (!isTaskCurrent(task, record)) return;
    await this._maybeAugmentRules(task, record);
    if (!isTaskCurrent(task, record)) return;
    if (!task.rules.actionable) {
      if (task.rules.safetyFlags?.length || task.rules.conflicts?.some((item) => item.unresolvable)) {
        this._stopTask(
          task,
          task.rules.safetyFlags?.length
            ? safetyErrorCode(task.rules.safetyFlags)
            : 'RULE_CONFLICT'
        );
      } else if (task.source === 'manual-card') {
        this._stopTask(task, 'AMBIGUOUS_RULES');
      } else {
        this._waitForRejection(task, record);
      }
      return;
    }
    if (task.rules.confidence < CONFIRM_RULE_CONFIDENCE) {
      if (task.source === 'manual-card') {
        this._stopTask(task, 'AMBIGUOUS_RULES');
        return;
      }
      this._waitForRejection(task, record);
      return;
    }

    try {
      const handler = task.handler ?? this._handlerForTask(task);
      if (!handler?.inspect || !handler?.validate || !handler?.plan) {
        this._stopTask(task, 'MEDIA_KIND_UNSUPPORTED');
        return;
      }
      this._audioLog(task, 'INSPECTION_STARTED', {
        mime: task.originalFile?.type,
        bytes: task.originalFile?.size
      });
      const metadata = await handler.inspect(task.originalFile, {
        signal: task.abortController.signal
      });
      if (task.abortController.signal.aborted || record.currentTask !== task) return;
      if (!this._inputConnected(task)) {
        this._stopTask(task, 'INPUT_DETACHED');
        return;
      }
      task.metadata = metadata;
      this._audioLog(task, 'INSPECTION_COMPLETED', {
        mime: metadata?.mime ?? metadata?.signatureMime,
        container: metadata?.container,
        codec: metadata?.codec,
        bytes: metadata?.size,
        durationMs: metadata?.durationMs,
        bitrateKbps: Number.isFinite(metadata?.averageBitrate)
          ? Math.round(metadata.averageBitrate / 1000)
          : undefined,
        sampleRate: metadata?.sampleRate,
        channels: metadata?.channels
      });
      const validation = await handler.validate(metadata, task.rules, {
        signal: task.abortController.signal
      });
      if (task.abortController.signal.aborted || record.currentTask !== task) return;
      if (!this._inputConnected(task)) {
        this._stopTask(task, 'INPUT_DETACHED');
        return;
      }
      task.validation = validation;
      this._logValidation(task, metadata, validation);

      if (validation.valid && task.rules.confidence >= AUTO_RULE_CONFIDENCE) {
        if (task.eventBlocked) {
          if (!this._releaseOriginalEvent(task)) {
            this._stopTask(task, 'INJECTION_FAILED');
          } else {
            this._completePassthrough(task);
          }
        } else {
          this._completePassthrough(task);
        }
        return;
      }

      const plan = await handler.plan(metadata, task.rules, {
        signal: task.abortController.signal
      });
      if (task.abortController.signal.aborted || record.currentTask !== task) return;
      if (!this._inputConnected(task)) {
        this._stopTask(task, 'INPUT_DETACHED');
        return;
      }
      task.policyConfirmation = null;
      if (task.rules.confidence >= CONFIRM_RULE_CONFIDENCE
        && task.rules.confidence < AUTO_RULE_CONFIDENCE) {
        task.policyConfirmation = createRuleConfidenceConfirmation();
      }
      task.plan = plan;

      this._audioLog(task, 'PLAN_CREATED', {
        sourceContainer: plan?.sourceContainer,
        sourceCodec: plan?.sourceCodec,
        targetContainer: plan?.targetContainer,
        targetCodec: plan?.targetCodec,
        targetMaxBytes: plan?.targetMaxBytes,
        safeTargetBytes: plan?.safeTargetBytes,
        targetBitrateKbps: plan?.targetBitrateKbps,
        targetSampleRate: plan?.targetSampleRate,
        targetChannels: plan?.targetChannels,
        encodePasses: plan?.encodePassLimit
      });

      const planErrorCode = planStopCode(task, plan);
      if (planErrorCode) {
        this._stopTask(task, planErrorCode);
        return;
      }
      if (task.policyConfirmation || hasRequiredConfirmation(plan)) {
        this._needConfirmation(task, record);
        this._requestConfirmation(task);
        return;
      }
      if (!plan.executable) {
        this._stopTask(task, 'USER_CONFIRMATION_REQUIRED');
        return;
      }
      this._enqueue(task, record);
    } catch (error) {
      if (task.abortController.signal.aborted) return;
      this._stopTask(task, stableErrorCode(error), error);
    }
  }

  /**
   * S4: ask the rule-understanding provider for a supplementary candidate only
   * when the local rules are incomplete. Failures are logged and silently fall
   * back to local rules (AI_UNAVAILABLE / AI_TIMEOUT / AI_INVALID_OUTPUT).
   */
  async _maybeAugmentRules(task, record) {
    if (!this.ruleProvider || this.disposed) return;
    const rules = task.rules;
    if (!rules) return;
    if (rules.actionable && rules.confidence >= AUTO_RULE_CONFIDENCE && machineRulesComplete(rules)) {
      return;
    }
    const text = selectAiRelevantText(task.contextBundle);
    if (!text) return;
    let result = null;
    try {
      result = await this.ruleProvider.extractRules({
        text,
        locale: 'zh-CN',
        pageType: task.contextBundle?.pageType ?? null
      });
    } catch (error) {
      this.diagnostics.push({
        code: 'AI_UNAVAILABLE',
        reason: String(error?.message ?? error).slice(0, 200),
        taskId: task.taskId
      });
      return;
    }
    if (this.disposed || record.currentTask !== task) return;
    if (result?.ok && result.candidate) {
      task.ruleCandidates = [...(task.ruleCandidates ?? []), result.candidate];
      task.rules = this.resolveRules(task.ruleCandidates);
      this.logger.emit('RULES_PARSED_AI', { taskId: task.taskId });
      if (task.rules.conflicts?.length) {
        this.logger.emit('RULE_CONFLICT', { taskId: task.taskId, rules: task.rules });
      }
      return;
    }
    if (result?.blocked) {
      this.diagnostics.push({
        code: 'AI_CALL_BLOCKED',
        reason: result.blocked,
        taskId: task.taskId
      });
      return;
    }
    if (result?.errorCode) {
      this.diagnostics.push({
        code: result.errorCode,
        reason: result.reason ?? null,
        taskId: task.taskId
      });
    }
  }

  _logValidation(task, metadata, validation) {
    const fields = {
      taskId: task.taskId,
      mime: metadata?.mime ?? metadata?.signatureMime,
      bytes: metadata?.size,
      width: metadata?.width,
      height: metadata?.height
    };
    this.logger.emit(validation.valid ? 'FILE_VALID' : 'FILE_INVALID', fields);
  }

  _releaseOriginalEvent(task) {
    if (!task?.eventBlocked || task.eventReleased) return true;
    const input = task.inputElement;
    if (!input?.isConnected) return false;
    const EventConstructor = input.ownerDocument?.defaultView?.Event
      ?? EVENT_CONSTRUCTOR_FALLBACK;
    if (typeof EventConstructor !== 'function') return false;
    try {
      armInjectionGuard(input, 'change');
      input.dispatchEvent(new EventConstructor('input', {
        bubbles: true,
        composed: true
      }));
      input.dispatchEvent(new EventConstructor('change', {
        bubbles: true,
        composed: true
      }));
      task.eventReleased = true;
      return true;
    } catch {
      return false;
    } finally {
      clearInjectionGuard(input);
    }
  }

  _completePassthrough(task) {
    this._stopRejectionObserver(task);
    this._transitionTask(task, 'PASSTHROUGH');
    this._transitionSession('PASSTHROUGH', { taskId: task.taskId });
    if (this.sessionMachine.state === 'PASSTHROUGH') {
      this._transitionSession('ARMED', { reason: 'PASSTHROUGH_COMPLETE' });
    }
    this.logger.emit('TASK_SUCCEEDED', { taskId: task.taskId });
    this._pruneTasks();
    this._publish();
  }

  _waitForRejection(task, record) {
    if (!isTaskCurrent(task, record)) return;
    if (task.status !== 'WAITING_REJECTION') {
      this._transitionTask(task, 'WAITING_REJECTION');
    }
    this._transitionSession('WAITING_REJECTION', { taskId: task.taskId });
    if (task.source !== 'manual-card') {
      this._startRejectionObserver(task, record);
    }
    this._publish();
  }

  _needConfirmation(task, record) {
    if (!isTaskCurrent(task, record)) return;
    this._transitionTask(task, 'NEEDS_CONFIRMATION');
    this._transitionSession('NEEDS_CONFIRMATION', { taskId: task.taskId });
    this.logger.emit('CONFIRMATION_REQUIRED', { taskId: task.taskId });
    this._audioLog(task, 'CONFIRMATION_REQUIRED', {
      targetContainer: task.plan?.targetContainer,
      targetCodec: task.plan?.targetCodec,
      targetMaxBytes: task.plan?.targetMaxBytes,
      targetBitrateKbps: task.plan?.targetBitrateKbps,
      targetChannels: task.plan?.targetChannels
    });
    this._publish();
  }

  _requestConfirmation(task) {
    if (typeof this.confirmationResolver !== 'function') return;
    const pending = task.policyConfirmation?.required && !task.policyConfirmation.resolved
      ? task.policyConfirmation
      : task.plan?.confirmations?.find((item) => item.required && !item.resolved);
    if (!pending) return;
    Promise.resolve()
      .then(() => this.confirmationResolver({
        taskId: task.taskId,
        type: pending.type,
        plan: safePlan(task.plan),
        policyConfirmation: safeConfirmation(task.policyConfirmation)
      }))
      .then((confirmation) => {
        if (confirmation) return this.confirmTask(task.taskId, confirmation);
        return undefined;
      })
      .catch((error) => this._stopTask(task, stableErrorCode(error), error));
  }

  _enqueue(task, record) {
    if (!isTaskCurrent(task, record)) return;
    if (!this.queue.includes(task)) this.queue.push(task);
    this._pumpQueue();
  }

  _pumpQueue() {
    if (this.disposed || this.processingTask) return;
    while (this.queue.length) {
      const task = this.queue.shift();
      const record = this._recordForTask(task);
      // manual-card 任务无原 input；inputElement 为 null 时按 manual 语义判定连接性。
      if (task && record && record.currentTask === task && !this._inputConnected(task)) {
        this._stopTask(task, 'INPUT_DETACHED');
      }
      if (!task || !record || !isTaskCurrent(task, record) || task.status === 'STOPPED') {
        continue;
      }
      this._prepareSessionForProcessing();
      this.processingTask = task;
      void this._processTask(task, record).finally(() => {
        if (this.processingTask === task) this.processingTask = null;
        this._pumpQueue();
      });
      return;
    }
  }

  _prepareSessionForProcessing() {
    const state = this.sessionMachine.state;
    if (['SUCCESS', 'STOPPED', 'PASSTHROUGH'].includes(state)) {
      this.sessionMachine.transition('ARMED', { reason: 'QUEUE_NEXT' });
      return;
    }
    if (state === 'WAITING_REJECTION') {
      this.sessionMachine.transition('INSPECTING', { reason: 'QUEUE_NEXT' });
    }
  }

  async _processTask(task, record) {
    if (record.currentTask === task && !this._inputConnected(task)) {
      this._stopTask(task, 'INPUT_DETACHED');
      return;
    }
    if (!isTaskCurrent(task, record)) return;
    if (!this._transitionTask(task, 'PROCESSING')) return;
    this._transitionSession('PROCESSING');
    this.logger.emit('PROCESS_STARTED', { taskId: task.taskId });
    this._audioLog(task, 'PROCESSING_STARTED', {
      sourceContainer: task.plan?.sourceContainer,
      sourceCodec: task.plan?.sourceCodec,
      targetContainer: task.plan?.targetContainer,
      targetCodec: task.plan?.targetCodec,
      targetBitrateKbps: task.plan?.targetBitrateKbps,
      targetChannels: task.plan?.targetChannels
    });
    try {
      const handler = task.handler ?? this._handlerForTask(task);
      if (!handler?.process) {
        throw Object.assign(new Error('Media handler is unavailable.'), {
          code: 'MEDIA_KIND_UNSUPPORTED'
        });
      }
      const result = await handler.process(
        task.originalFile,
        task.plan,
        {
          signal: task.abortController.signal,
          taskId: task.taskId,
          onProgress: (progress) => {
            if (!isTaskCurrent(task, record)) return;
            const ratio = Number.isFinite(progress?.ratio)
              ? Math.max(0, Math.min(1, progress.ratio))
              : null;
            task.progress = {
              phase: typeof progress?.phase === 'string'
                ? progress.phase
                : typeof progress?.stage === 'string' ? progress.stage : 'processing',
              ratio,
              processedMs: Number.isFinite(progress?.processedMs) ? progress.processedMs : null,
              totalMs: Number.isFinite(progress?.totalMs) ? progress.totalMs : null
            };
            this._audioLog(task, 'PROCESSING_PROGRESS', {
              phase: task.progress.phase,
              ratio: task.progress.ratio,
              processedMs: task.progress.processedMs,
              totalMs: task.progress.totalMs
            });
            this._publish();
          }
        }
      );
      if (task.abortController.signal.aborted || record.currentTask !== task) return;
      if (!this._inputConnected(task)) {
        this._stopTask(task, 'INPUT_DETACHED');
        return;
      }
      const validFile = isFileForInput(task.inputElement, result?.file);
      let outputValidation = result?.validation;
      if (handler.kind === 'audio' && typeof handler.validateOutput === 'function') {
        outputValidation = await handler.validateOutput(
          result?.metadata,
          task.rules,
          task.plan,
          task.metadata,
          {
            signal: task.abortController.signal,
            // The audio pipeline has already performed bounded representative
            // frame validation.  The controller's second check validates the
            // safe metadata contract without rescanning the full output.
            allowUninspectedFrames: true,
            allowSingleFrame: true
          }
        );
        if (task.abortController.signal.aborted || record.currentTask !== task) return;
        if (!this._inputConnected(task)) {
          this._stopTask(task, 'INPUT_DETACHED');
          return;
        }
        task.outputValidation = outputValidation;
        this._audioLog(task, 'OUTPUT_VALIDATED', {
          mime: result?.metadata?.mime,
          container: result?.metadata?.container,
          codec: result?.metadata?.codec,
          bytes: result?.metadata?.size,
          durationMs: result?.metadata?.durationMs,
          bitrateKbps: Number.isFinite(result?.metadata?.averageBitrate)
            ? Math.round(result.metadata.averageBitrate / 1000)
            : undefined,
          sampleRate: result?.metadata?.sampleRate,
          channels: result?.metadata?.channels
        });
      }
      if (!validFile || outputValidation?.valid !== true) {
        throw Object.assign(new Error('Processed output failed final validation.'), {
          code: handler.kind === 'audio' ? 'AUDIO_OUTPUT_VALIDATION_FAILED' : 'OUTPUT_VALIDATION_FAILED'
        });
      }
      result.validation = outputValidation;
      task.result = result;
      task.processedFile = result.file;
      this.logger.emit('PROCESS_COMPLETED', {
        taskId: task.taskId,
        mime: result.metadata?.mime,
        bytes: result.metadata?.size,
        width: result.metadata?.width,
        height: result.metadata?.height,
        durationMs: result.durationMs
      });
      this._audioLog(task, 'PROCESSING_COMPLETED', {
        mime: result.metadata?.mime,
        container: result.metadata?.container,
        codec: result.metadata?.codec,
        bytes: result.metadata?.size,
        durationMs: result.metadata?.durationMs,
        bitrateKbps: Number.isFinite(result.metadata?.averageBitrate)
          ? Math.round(result.metadata.averageBitrate / 1000)
          : undefined,
        inputBytesRead: result.inputBytesRead,
        outputBytes: result.outputBytes,
        encodePasses: result.encodePasses,
        workerUsed: result.workerUsed
      });
      if (task.source === 'manual-card') {
        // 真实公开说明页没有原上传框：处理成功后只提供结果与下载，不伪装回填。
        task.injection = {
          ok: true,
          inputFilesVerified: false,
          eventsDispatched: [],
          fallback: 'download',
          errorCode: null
        };
        task.warnings.push({ code: 'MANUAL_CARD_DOWNLOAD_ONLY' });
        this._transitionTask(task, 'SUCCESS');
        this._transitionSession('SUCCESS');
        this.logger.emit('TASK_SUCCEEDED', { taskId: task.taskId });
        this._publish();
        return;
      }
      if (!this._transitionTask(task, 'INJECTING')) return;
      this._transitionSession('INJECTING');
      if (!this._inputConnected(task) || this._recordForTask(task) !== record) {
        throw Object.assign(new Error('Input is no longer connected.'), {
          code: 'INPUT_DETACHED'
        });
      }
      record.adapter?.beforeInjection?.(task);
      const injection = this.injectFile(task.inputElement, result.file, {
        dispatchEvents: true,
        reason: 'processed'
      });
      task.injection = injection;
      if (!injection?.ok || !injection.inputFilesVerified) {
        this._audioLog(task, 'INJECTION_FAILED', {
          errorCode: injection?.errorCode ?? 'INJECTION_FAILED'
        });
        throw Object.assign(new Error('File injection failed.'), {
          code: injection?.errorCode ?? 'INJECTION_FAILED'
        });
      }
      this.logger.emit('INJECTION_COMPLETED', {
        taskId: task.taskId,
        mime: result.metadata?.mime,
        bytes: result.metadata?.size,
        width: result.metadata?.width,
        height: result.metadata?.height
      });
      this._audioLog(task, 'INJECTION_SUCCEEDED', {
        mime: result.metadata?.mime,
        bytes: result.metadata?.size,
        outputBytes: result.outputBytes,
        workerUsed: result.workerUsed
      });
      record.adapter?.afterInjection?.(task);
      this._transitionTask(task, 'SUCCESS');
      this._transitionSession('SUCCESS');
      this.logger.emit('TASK_SUCCEEDED', { taskId: task.taskId });
      this._afterInjection(task, record);
    } catch (error) {
      if (task.abortController.signal.aborted || record.currentTask !== task) return;
      if (!this._inputConnected(task)) {
        this._stopTask(task, 'INPUT_DETACHED');
        return;
      }
      let code = stableErrorCode(error);
      if (task.status === 'INJECTING'
        && ['INJECTION_FAILED', 'DATATRANSFER_UNAVAILABLE', 'RESTORE_FAILED'].includes(code)) {
        const rollback = this.injectFile(task.inputElement, task.originalFile, {
          dispatchEvents: false,
          reason: 'restore'
        });
        if (!rollback?.ok && !inputContainsFile(task.inputElement, task.originalFile)) {
          code = 'RESTORE_FAILED';
          this.diagnostics.push({
            code,
            reason: rollback?.errorCode ?? 'INJECTION_ROLLBACK_FAILED',
            taskId: task.taskId
          });
        }
      }
      this._stopTask(task, code, error);
    }
  }

  _afterInjection(task, record) {
    if (!isTaskCurrent(task, record)) return;
    if (task.source === 'rejection' && task.rejection && task.retryCount === 0) {
      if (this._canRetry(task, record)) {
        this._retryTask(task, record);
        return;
      }
      task.warnings.push({ code: 'FORM_PAGE_USE_ORIGINAL_BUTTON' });
    }
    this._startRejectionObserver(task, record);
  }

  _canRetry(task, record) {
    if (MAX_AUTO_RETRIES < 1
      || task.retryCount !== 0
      || !task.rejection
      || task.rejection.kind !== 'explicit'
      || task.rejection.related !== true
      || !task.result?.file
      || task.result.validation?.valid !== true
      || !this._inputConnected(task)
      || task.cancelled
      || this.disposed) return false;
    let adapterAuto = false;
    try {
      adapterAuto = Boolean(record.adapter?.isAutoUpload?.(task.inputElement));
    } catch {
      adapterAuto = false;
    }
    return adapterAuto || (
      record.adapter?.id === 'generic'
      && task.businessClickCount === 0
    );
  }

  _retryTask(task, record) {
    if (!this._canRetry(task, record)) return false;
    task.retryCount += 1;
    this._transitionTask(task, 'RETRYING');
    this._transitionSession('RETRYING');
    this.logger.emit('RETRY_TRIGGERED', { taskId: task.taskId });
    this._startRejectionObserver(task, record);
    const EventConstructor = task.inputElement.ownerDocument?.defaultView?.Event
      ?? EVENT_CONSTRUCTOR_FALLBACK;
    try {
      armInjectionGuard(task.inputElement, 'change');
      if (typeof EventConstructor !== 'function') {
        clearInjectionGuard(task.inputElement);
        throw Object.assign(new Error('Event API unavailable.'), {
          code: 'INJECTION_FAILED'
        });
      }
      task.inputElement.dispatchEvent(new EventConstructor('input', {
        bubbles: true,
        composed: true
      }));
      task.inputElement.dispatchEvent(new EventConstructor('change', {
        bubbles: true,
        composed: true
      }));
      task.retryDispatched = true;
      this._transitionTask(task, 'SUCCESS');
      this._transitionSession('SUCCESS');
      this._publish();
      return true;
    } catch (error) {
      clearInjectionGuard(task.inputElement);
      this._stopTask(task, stableErrorCode(error), error);
      return false;
    }
  }

  _startRejectionObserver(task, record) {
    this._stopRejectionObserver(task);
    if (!taskCanBeObserved(task)) return;
    const stopper = this.observeRejection(task, record.context, {
      onRejection: (detail) => {
        void this._handleRejection(task, record, detail);
      },
      onTimeout: () => {
        if (!isTaskCurrent(task, record)) return;
        this._stopRejectionObserver(task);
        if (task.status === 'WAITING_REJECTION') {
          if (task.eventBlocked && !this._releaseOriginalEvent(task)) {
            this._stopTask(task, 'INJECTION_FAILED');
          } else {
            this._completePassthrough(task);
          }
          return;
        }
        this._pruneTasks();
        this._publish();
      },
      getActiveTasks: () => [...this.tasks.values()]
        .filter((candidate) => taskCanBeObserved(candidate))
    });
    if (taskCanBeObserved(task) && typeof stopper === 'function') {
      task.rejectionStopper = stopper;
    } else {
      stopper?.();
      task.rejectionStopper = null;
    }
  }

  _stopRejectionObserver(task) {
    task?.rejectionStopper?.();
    if (task) task.rejectionStopper = null;
  }

  async _handleRejection(task, record, detail) {
    if (!isTaskCurrent(task, record) || !detail) return;
    if (detail.task && detail.task !== task) return;
    if (task.retryCount >= MAX_AUTO_RETRIES) {
      this._stopTask(task, 'PROCESSING_FAILED');
      return;
    }
    this.logger.emit('REJECTION_DETECTED', { taskId: task.taskId });
    if (detail.errorCode === 'AMBIGUOUS_REJECTION_ASSOCIATION') {
      this._stopTask(task, detail.errorCode);
      return;
    }
    if (detail.kind !== 'explicit' || detail.related !== true) {
      this._stopTask(task, 'PROCESSING_FAILED');
      return;
    }

    this._stopRejectionObserver(task);
    const previousRules = task.rules;
    const nextRuleCandidates = [
      ...(task.ruleCandidates ?? []),
      ...(detail.candidates ?? [])
    ];
    const nextRules = this.resolveRules(nextRuleCandidates);
    if (task.mediaKind === 'audio'
      && !isStrictlyMoreSpecificAudioRejection(previousRules, nextRules)) {
      this.diagnostics.push({
        code: 'REJECTION_RULE_NOT_STRICTER',
        taskId: task.taskId
      });
      this._stopTask(task, 'PROCESSING_FAILED');
      return;
    }
    task.rejection = detail;
    task.source = 'rejection';
    task.ruleCandidates = nextRuleCandidates;
    task.rules = nextRules;
    if (task.rules.conflicts?.length) {
      this.logger.emit('RULE_CONFLICT', {
        taskId: task.taskId,
        rules: task.rules
      });
    }
    if (!task.rules.actionable || task.rules.safetyFlags?.length
      || task.rules.conflicts?.some((item) => item.unresolvable)) {
      this._stopTask(task, task.rules.safetyFlags?.length
        ? safetyErrorCode(task.rules.safetyFlags)
        : 'RULE_CONFLICT');
      return;
    }

    if (task.status === 'SUCCESS') {
      this._transitionTask(task, 'INSPECTING');
    } else if (task.status === 'WAITING_REJECTION') {
      this._transitionTask(task, 'INSPECTING');
    } else if (task.status !== 'INSPECTING') {
      this._stopTask(task, 'PROCESSING_FAILED');
      return;
    }
    this._transitionSession('INSPECTING');

    try {
      const handler = task.handler ?? this._handlerForTask(task);
      if (!handler?.inspect || !handler?.validate || !handler?.plan) {
        this._stopTask(task, 'MEDIA_KIND_UNSUPPORTED');
        return;
      }
      const metadata = await handler.inspect(task.originalFile, {
        signal: task.abortController.signal
      });
      if (task.abortController.signal.aborted || record.currentTask !== task) return;
      if (!this._inputConnected(task)) {
        this._stopTask(task, 'INPUT_DETACHED');
        return;
      }
      task.metadata = metadata;
      const validation = await handler.validate(metadata, task.rules, {
        signal: task.abortController.signal
      });
      if (task.abortController.signal.aborted || record.currentTask !== task) return;
      if (!this._inputConnected(task)) {
        this._stopTask(task, 'INPUT_DETACHED');
        return;
      }
      task.validation = validation;
      this._logValidation(task, metadata, validation);
      const plan = await handler.plan(metadata, task.rules, {
        signal: task.abortController.signal
      });
      if (task.abortController.signal.aborted || record.currentTask !== task) return;
      if (!this._inputConnected(task)) {
        this._stopTask(task, 'INPUT_DETACHED');
        return;
      }
      task.policyConfirmation = null;
      if (task.rules.confidence >= CONFIRM_RULE_CONFIDENCE
        && task.rules.confidence < AUTO_RULE_CONFIDENCE) {
        task.policyConfirmation = createRuleConfidenceConfirmation();
      }
      task.plan = plan;
      if (task.validation.valid && plan.passthrough) {
        this._stopTask(task, 'PROCESSING_FAILED');
        return;
      }
      const planErrorCode = planStopCode(task, plan);
      if (planErrorCode) {
        this._stopTask(task, planErrorCode);
        return;
      }
      if (task.policyConfirmation || hasRequiredConfirmation(plan)) {
        this._needConfirmation(task, record);
        this._requestConfirmation(task);
        return;
      }
      if (!plan.executable) {
        this._stopTask(task, 'USER_CONFIRMATION_REQUIRED');
        return;
      }
      this._enqueue(task, record);
    } catch (error) {
      if (task.abortController.signal.aborted) return;
      this._stopTask(task, stableErrorCode(error), error);
    }
  }

  async confirmTask(taskId, confirmationPayload) {
    const task = this.tasks.get(taskId);
    const record = this._recordForTask(task);
    if (!task || !record || task.status !== 'NEEDS_CONFIRMATION') {
      return { ok: false, errorCode: 'USER_CONFIRMATION_REQUIRED' };
    }
    try {
      const accepted = confirmationPayload?.accepted === true;
      if (confirmationPayload?.type === 'RULE_CONFIDENCE') {
        const policy = task.policyConfirmation;
        if (!policy
          || policy.id !== confirmationPayload.id
          || policy.type !== confirmationPayload.type
          || policy.resolved) {
          throw Object.assign(new Error('Policy confirmation does not match this task.'), {
            code: 'USER_CONFIRMATION_REQUIRED'
          });
        }
        if (accepted && confirmationPayload?.payload?.allow !== true) {
          throw Object.assign(new Error('Policy confirmation requires explicit allow.'), {
            code: 'USER_CONFIRMATION_REQUIRED'
          });
        }
        task.policyConfirmation = {
          ...policy,
          resolved: true,
          accepted,
          payload: accepted ? cloneValue(confirmationPayload.payload) : null
        };
      } else {
        const plannerConfirmation = confirmationPayload?.type === 'CROP'
          && accepted
          ? {
            ...confirmationPayload,
            payload: this._normalizeCropConfirmation(task, confirmationPayload.payload)
          }
          : confirmationPayload;
        const handler = task.handler ?? this._handlerForTask(task);
        task.plan = handler?.resolveConfirmation
          ? handler.resolveConfirmation(task.plan, plannerConfirmation)
          : this.resolveProcessingConfirmation(task.plan, plannerConfirmation);
      }
      this._audioLog(
        task,
        accepted ? 'CONFIRMATION_ACCEPTED' : 'CONFIRMATION_DECLINED',
        {
          targetContainer: task.plan?.targetContainer,
          targetCodec: task.plan?.targetCodec,
          targetBitrateKbps: task.plan?.targetBitrateKbps,
          targetChannels: task.plan?.targetChannels
        }
      );
      if (!accepted) {
        if (task.eventBlocked) {
          const rollback = this.injectFile(task.inputElement, task.originalFile, {
            dispatchEvents: false,
            reason: 'restore'
          });
          if (!rollback?.ok && !inputContainsFile(task.inputElement, task.originalFile)) {
            this.diagnostics.push({
              code: 'RESTORE_FAILED',
              reason: rollback?.errorCode ?? 'CONFIRMATION_ROLLBACK_FAILED',
              taskId: task.taskId
            });
            this._stopTask(task, 'RESTORE_FAILED');
            return { ok: false, errorCode: 'RESTORE_FAILED' };
          }
        }
        this._stopTask(task, 'USER_CANCELLED');
        return { ok: true, status: task.status };
      }
      return this._continueAfterConfirmation(task, record);
    } catch (error) {
      const code = stableErrorCode(error, 'USER_CONFIRMATION_REQUIRED');
      this._stopTask(task, code, error);
      return { ok: false, errorCode: code };
    }
  }

  _normalizeCropConfirmation(task, payload) {
    const sourceWidth = task.metadata?.displayWidth ?? task.metadata?.width;
    const sourceHeight = task.metadata?.displayHeight ?? task.metadata?.height;
    const proposed = task.plan?.proposedCrop;
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)
      || sourceWidth <= 0 || sourceHeight <= 0 || !proposed) {
      throw Object.assign(new Error('Crop metadata is unavailable.'), {
        code: 'USER_CONFIRMATION_REQUIRED'
      });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw Object.assign(new Error('Crop intent must be normalized.'), {
        code: 'USER_CONFIRMATION_REQUIRED'
      });
    }
    const values = ['x', 'y', 'width', 'height'].map((key) => payload[key]);
    if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
      || payload.width <= 0 || payload.height <= 0
      || payload.x + payload.width > 1 + 1e-9
      || payload.y + payload.height > 1 + 1e-9) {
      throw Object.assign(new Error('Crop normalized rectangle is out of bounds.'), {
        code: 'USER_CONFIRMATION_REQUIRED'
      });
    }
    const pixel = {
      x: Math.round(payload.x * sourceWidth),
      y: Math.round(payload.y * sourceHeight),
      width: Math.round(payload.width * sourceWidth),
      height: Math.round(payload.height * sourceHeight)
    };
    if (pixel.width !== Math.round(proposed.width)
      || pixel.height !== Math.round(proposed.height)
      || pixel.x < 0 || pixel.y < 0
      || pixel.x + pixel.width > Math.round(sourceWidth)
      || pixel.y + pixel.height > Math.round(sourceHeight)) {
      throw Object.assign(new Error('Crop intent changes the rule-derived crop size.'), {
        code: 'USER_CONFIRMATION_REQUIRED'
      });
    }
    return pixel;
  }

  _continueAfterConfirmation(task, record) {
    if (!isTaskCurrent(task, record)) {
      return { ok: false, errorCode: 'STALE_TASK' };
    }
    if (task.policyConfirmation?.required && !task.policyConfirmation.resolved) {
      this._publish();
      this._requestConfirmation(task);
      return { ok: true, status: task.status };
    }
    if (hasRequiredConfirmation(task.plan)) {
      this._publish();
      this._requestConfirmation(task);
      return { ok: true, status: task.status };
    }
    if (!task.plan?.executable) {
      this._stopTask(task, 'USER_CONFIRMATION_REQUIRED');
      return { ok: false, errorCode: 'USER_CONFIRMATION_REQUIRED' };
    }
    if (task.plan.passthrough && task.validation?.valid) {
      if (task.eventBlocked && !this._releaseOriginalEvent(task)) {
        this._stopTask(task, 'INJECTION_FAILED');
        return { ok: false, errorCode: 'INJECTION_FAILED' };
      }
      this._completePassthrough(task);
      return { ok: true, status: task.status };
    }
    this._enqueue(task, record);
    return { ok: true, status: task.status };
  }

  cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    return this._cancelTaskInternal(task, 'USER_CANCELLED', true);
  }

  _cancelTaskInternal(task, code, notify) {
    task.cancelled = true;
    const changed = this._stopTask(task, code);
    if (notify) this._publish();
    return changed;
  }

  restoreTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || !task.inputElement?.isConnected || !task.originalFile) {
      return {
        ok: false,
        inputFilesVerified: false,
        eventsDispatched: [],
        fallback: 'download',
        errorCode: 'INPUT_DETACHED'
      };
    }
    const result = this.restoreOriginal(task);
    if (result?.ok) {
      task.processedFile = null;
      task.warnings.push({ code: 'ORIGINAL_RESTORED' });
      this._stopTask(task, 'USER_CANCELLED');
    } else {
      this.diagnostics.push({
        code: 'RESTORE_FAILED',
        reason: result?.errorCode ?? 'RESTORE_API_FAILED',
        taskId: task.taskId
      });
      this._stopTask(task, 'RESTORE_FAILED');
    }
    return result;
  }

  /**
   * S4: build the "prepare photo by this page's rules" card for a real public
   * guide page. Local parsing first; the AI provider is consulted only when the
   * local rules are incomplete. Returns null on pages without a page adapter.
   */
  async prepareManualCard(options = {}) {
    if (this.disposed) return null;
    const url = this.globalRef?.location?.href ?? '';
    const adapter = this.adapterRegistry.resolve(url);
    if (typeof adapter?.getPageRuleContext !== 'function') return null;

    let textSource = null;
    if (options.selectedText) {
      textSource = sanitizeEvidenceText(String(options.selectedText));
    }
    if (!textSource) {
      try {
        textSource = adapter.getPageRuleContext(this.documentRef);
      } catch {
        textSource = null;
      }
    }
    if (!textSource) {
      this.pageCard = { state: 'no-rules', hint: 'SELECT_TEXT', source: adapter.id };
      this.pageCardRules = null;
      this._publish();
      return this.pageCard;
    }

    const bundle = {
      uploaderId: 'manual-card',
      label: '本页照片要求',
      attributes: { accept: null, multiple: false, required: false },
      selectedText: null,
      nearbyTexts: [],
      alertTexts: [],
      normalizedText: sanitizeEvidenceText(textSource).slice(0, CONTEXT_TEXT_LIMIT),
      truncated: false
    };
    let candidates = this.parseRules(bundle);
    let rules = this.resolveRules(candidates);
    this.logger.emit('CONTEXT_EXTRACTED');
    this.logger.emit('RULES_PARSED_LOCAL', { rules });
    if (rules.conflicts?.length) {
      this.logger.emit('RULE_CONFLICT', { rules });
    }

    if (this.ruleProvider
      && !(rules.actionable && rules.confidence >= AUTO_RULE_CONFIDENCE && machineRulesComplete(rules))) {
      const text = selectAiRelevantText(bundle);
      if (text) {
        let result = null;
        try {
          result = await this.ruleProvider.extractRules({
            text,
            locale: 'zh-CN',
            pageType: 'public-guide'
          });
        } catch (error) {
          this.diagnostics.push({
            code: 'AI_UNAVAILABLE',
            reason: String(error?.message ?? error).slice(0, 200)
          });
        }
        if (result?.ok && result.candidate) {
          candidates = [...candidates, result.candidate];
          rules = this.resolveRules(candidates);
          this.logger.emit('RULES_PARSED_AI', {});
          if (rules.conflicts?.length) {
            this.logger.emit('RULE_CONFLICT', { rules });
          }
        } else if (result?.blocked) {
          this.diagnostics.push({ code: 'AI_CALL_BLOCKED', reason: result.blocked });
        } else if (result?.errorCode) {
          this.diagnostics.push({ code: result.errorCode, reason: result.reason ?? null });
        }
      }
    }

    const ready = rules.actionable && hasSubstantiveRules(rules);
    this.pageCardRules = rules;
    this.pageCard = {
      state: ready ? 'ready' : 'insufficient',
      hint: ready ? null : 'SELECT_TEXT',
      rules: safeRuleSet(rules),
      source: adapter.id
    };
    this._publish();
    return this.pageCard;
  }

  /**
   * S4: run the full local pipeline for a file chosen through the UploadFit
   * manual card (real public guide pages without their own upload input).
   * The result is download-only; it never claims a page-side refill.
   */
  async createManualTask(file, options = {}) {
    if (this.disposed) return { ok: false, errorCode: 'SESSION_DISPOSED' };
    const FileConstructor = this.globalRef?.File ?? globalThis.File;
    if (typeof FileConstructor !== 'function' || !(file instanceof FileConstructor)) {
      return { ok: false, errorCode: 'FILE_UNAVAILABLE' };
    }
    const rules = options.rules ?? this.pageCardRules;
    if (!rules || !rules.actionable || !hasSubstantiveRules(rules)) {
      return { ok: false, errorCode: 'AMBIGUOUS_RULES' };
    }
    if (this.processingTask) {
      return { ok: false, errorCode: 'PROCESSING_FAILED' };
    }

    const record = {
      context: {
        input: null,
        uploaderId: 'manual-card',
        mediaKind: this._mediaKindForContext({}, file),
        label: options.label ?? '本页照片要求',
        nearbyTexts: [],
        alertTexts: [],
        pageUrl: this.globalRef?.location?.href ?? '',
        pageTitle: this.documentRef?.title ?? '',
        adapter: null
      },
      adapter: null,
      input: null,
      currentTask: null,
      listener: null,
      cleanupListener: null
    };
    const bundle = {
      uploaderId: 'manual-card',
      label: record.context.label,
      attributes: { accept: null, multiple: false, required: false },
      selectedText: null,
      nearbyTexts: [],
      alertTexts: [],
      normalizedText: '',
      truncated: false
    };
    const task = this._makeTask(record, file, null, rules, [], bundle);
    task.source = 'manual-card';
    record.currentTask = task;
    this.manualRecords.set(task.taskId, record);
    this.tasks.set(task.taskId, task);
    this._pruneTasks();
    this.logger.emit('FILE_SELECTED', {
      taskId: task.taskId,
      mime: file.type,
      bytes: file.size
    });
    this._transitionTask(task, 'INSPECTING');
    this._transitionSession('INSPECTING');
    await this._runPreflight(task, record);
    return { ok: true, task };
  }

  /** S4: object URL for UI previews; registered on the task for cleanup. */
  createTaskPreviewUrl(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    const file = task.processedFile ?? task.originalFile;
    if (!file) return null;
    const urlApi = this.globalRef?.URL ?? globalThis.URL;
    const url = urlApi?.createObjectURL?.(file);
    if (url && !task.objectUrls.includes(url)) task.objectUrls.push(url);
    return url ?? null;
  }

  /** S4: expose the processed output for download flows. Never logs the name. */
  getTaskOutput(taskId) {
    const task = this.tasks.get(taskId);
    if (!task?.processedFile) return null;
    return {
      taskId,
      file: task.processedFile,
      metadata: safeMetadata(task.result?.metadata ?? task.processedFile)
    };
  }

  _stopTask(task, errorCode = 'PROCESSING_FAILED', error = null) {
    if (!task || task.status === 'DISPOSED' || task.status === 'STOPPED') return false;
    const wasAudio = task.mediaKind === 'audio';
    const wasProcessing = ['PROCESSING', 'INJECTING', 'RETRYING'].includes(task.status);
    task.errorCode = errorCode;
    if (error?.message && task.warnings.length < 4) {
      task.warnings.push({ code: errorCode });
    }
    task.abortController?.abort?.();
    this._stopRejectionObserver(task);
    task.objectUrls.splice(0).forEach((url) => {
      const urlApi = task.inputElement?.ownerDocument?.defaultView?.URL ?? globalThis.URL;
      urlApi?.revokeObjectURL?.(url);
    });
    const changed = this._transitionTask(task, 'STOPPED');
    if (changed) {
      this.logger.emit('TASK_STOPPED', {
        taskId: task.taskId,
        errorCode
      });
      this._transitionSession('STOPPED', { taskId: task.taskId });
      if (wasAudio && (wasProcessing
        || ['AUDIO_PROCESSING_CANCELLED', 'USER_CANCELLED', 'INPUT_DETACHED'].includes(errorCode))) {
        this._audioLog(task, 'PROCESSING_CANCELLED', { errorCode });
      }
      this._pruneTasks();
      this._publish();
    }
    return changed;
  }

  _transitionTask(task, next, details = {}) {
    if (!task || task.status === next) return true;
    const changed = task.stateMachine.transition(next, details);
    if (changed) {
      task.status = next;
      task.stateHistory = task.stateMachine.history;
      this._publish();
    }
    return changed;
  }

  _transitionSession(next, details = {}) {
    if (this.disposed || this.sessionMachine.state === next) return true;
    const current = this.sessionMachine.state;
    const processingStates = new Set(['PROCESSING', 'INJECTING', 'RETRYING']);
    if (processingStates.has(current)
      && ['INSPECTING', 'WAITING_REJECTION', 'NEEDS_CONFIRMATION', 'PASSTHROUGH'].includes(next)
      && this.processingTask?.taskId !== details.taskId) {
      return true;
    }
    if (next === 'STOPPED'
      && this.processingTask
      && this.processingTask.taskId !== details.taskId) {
      return true;
    }
    if (next === 'INSPECTING'
      && (current === 'STOPPED' || current === 'SUCCESS' || current === 'PASSTHROUGH')) {
      this.sessionMachine.transition('ARMED', { reason: 'NEW_TASK' });
    }
    if (next === 'PROCESSING'
      && ['STOPPED', 'SUCCESS', 'PASSTHROUGH'].includes(this.sessionMachine.state)) {
      this.sessionMachine.transition('ARMED', { reason: 'QUEUE_NEXT' });
    }
    if (next === 'PROCESSING' && this.sessionMachine.state === 'WAITING_REJECTION') {
      this.sessionMachine.transition('INSPECTING', { reason: 'QUEUE_NEXT' });
    }
    if (next === 'PROCESSING' && this.sessionMachine.state === 'ARMED') {
      this.sessionMachine.transition('INSPECTING');
    }
    if (next === 'INJECTING' && this.sessionMachine.state === 'ARMED') {
      this.sessionMachine.transition('INSPECTING');
      this.sessionMachine.transition('PROCESSING');
    }
    if (next === 'RETRYING' && this.sessionMachine.state === 'SUCCESS') {
      return this.sessionMachine.transition(next, details);
    }
    return this.sessionMachine.transition(next, details);
  }

  _notify(value) {
    if (this.disposed) return;
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch {
        // A view listener cannot interrupt task execution.
      }
    }
  }

  _publish() {
    if (this.disposed) return;
    this._notify(this.getSnapshot());
  }

  getSnapshot() {
    const tasks = [...this.tasks.values()]
      .sort((left, right) => right.sequence - left.sequence || right.createdAt - left.createdAt);
    const task = tasks.find((candidate) => ACTIVE_TASK_STATES.has(candidate.status))
      ?? tasks[0]
      ?? null;
    return {
      sessionState: this.disposed ? 'DISPOSED' : this.sessionMachine.state,
      uploaderCount: this.uploaders.size,
      activeTask: task
        ? {
          taskId: task.taskId,
          status: task.status,
          label: task.label,
          source: task.source,
          mediaKind: task.mediaKind ?? 'image',
          current: safeMetadata(task.metadata),
          rules: safeRuleSet(task.rules),
          policyConfirmation: safeConfirmation(task.policyConfirmation),
          plan: safePlan(task.plan),
          result: safeResult(task.result),
          errorCode: task.errorCode ?? null,
          retryCount: task.retryCount,
          progress: task.progress ? {
            phase: task.progress.phase ?? 'processing',
            ratio: Number.isFinite(task.progress.ratio)
              ? Math.max(0, Math.min(1, task.progress.ratio))
              : null,
            processedMs: Number.isFinite(task.progress.processedMs) ? task.progress.processedMs : null,
            totalMs: Number.isFinite(task.progress.totalMs) ? task.progress.totalMs : null
          } : null,
          warnings: task.warnings.map((item) => ({ code: item.code }))
        }
        : null,
      pageCard: this.pageCard
        ? {
          state: this.pageCard.state,
          hint: this.pageCard.hint ?? null,
          rules: this.pageCard.rules ?? null,
          source: this.pageCard.source ?? null
        }
        : null
    };
  }

  getDiagnostics() {
    return {
      sessionId: this.sessionId,
      state: this.sessionMachine.state,
      transitions: this.sessionMachine.history.slice(),
      diagnostics: this.diagnostics.slice()
    };
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    const urlApi = this.globalRef?.URL ?? globalThis.URL;
    for (const task of this.tasks.values()) {
      task.abortController?.abort?.();
      this._stopRejectionObserver(task);
      task.objectUrls.splice(0).forEach((url) => {
        urlApi?.revokeObjectURL?.(url);
      });
      task.stateMachine.transition('DISPOSED', { reason: 'SESSION_DISPOSED' });
      task.status = 'DISPOSED';
    }
    this.manualRecords.clear();
    this.discovery?.cleanup?.();
    this.resources.cleanup();
    for (const record of this.uploaders.values()) record.cleanupListener?.();
    this.uploaders.clear();
    this.queue.length = 0;
    this.processingTask = null;
    try { this.mediaHandlers?.dispose?.(); } catch {}
    this.sessionMachine.transition('DISPOSED', { reason: 'SESSION_DISPOSED' });
    this.logger.emit('SESSION_DISPOSED');
    this.listeners.clear();
    return true;
  }
}

export function createTaskController(options = {}) {
  return new TaskController(options);
}
