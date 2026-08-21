import { bootstrap, cleanupSession } from './bootstrap.js';
import { detectCapabilities } from './capabilities.js';
import {
  extractRelevantContext,
  selectAiRelevantText
} from './dom/context-extractor.js';
import { genericAdapter } from './adapters/generic.js';
import { cnipaPublicGuideAdapter } from './adapters/cnipa-public-guide.js';
import {
  RuleUnderstandingProvider,
  containsSensitiveAiInput,
  validateAiRuleOutput
} from './providers/rule-understanding-provider.js';
import { TabbitAiProvider, buildAiPrompt, createTabbitAiProvider } from './providers/tabbit-ai.js';
import { createUploadFitUi } from './ui/host.js';
import { createCropper } from './ui/cropper.js';
import { STATUS_TEXTS, statusText } from './ui/status-pill.js';
import { parseRulesDeterministically } from './rules/deterministic-parser.js';
import { normalizeRuleText } from './rules/normalizer.js';
import { resolveRules } from './rules/resolver.js';
import {
  createUploaderDiscovery,
  discoverUploaders,
  findFileInputFromEvent,
  classifyMediaKind,
  isAudioMime,
  isAudioUploader,
  isImageMime,
  isImageUploader
} from './dom/input-discovery.js';
import { inspectAudio, audioMetadataSnapshot } from './audio/metadata.js';
import {
  validateAudioMetadata,
  isAudioPassthrough,
  pageAllowsMp3,
  isSupportedAudioMetadata,
  validateAudioOutput,
  validateAudioOutputFile
} from './audio/validators.js';
import {
  createAudioProcessingPlan,
  createAudioPlan,
  buildAudioPlan,
  resolveAudioConfirmation,
  resolveAudioProcessingConfirmation,
  resolveConfirmation
} from './audio/planner.js';
import { processAudio, processAudioFile, createAudioPipeline } from './audio/pipeline.js';
import { createAudioHandler, audioHandler } from './audio/handler.js';
import {
  canUseAudioWorker,
  createAudioWorkerRuntime,
  createAudioWorkerSource,
  runAudioWorker
} from './audio/worker-runtime.js';
import { AUDIO_ENCODER_DESCRIPTOR, isFrozenAudioEncoderDescriptor } from './audio/encoder-contract.js';
import { createMediaHandlerRegistry, createMediaHandlers } from './core/media-handlers.js';
import {
  AUDIO_ERROR_CODES,
  AUDIO_ERROR_MESSAGES,
  AudioMetadataError,
  AudioProcessingError,
  audioErrorMessage
} from './audio/errors.js';
import {
  detectAudioSignature,
  findMp3Frame,
  parseMp3Header,
  parseMp3Signature,
  parseWavChunks,
  parseM4aSignature
} from './audio/signatures.js';
import {
  injectFile,
  markUntrustedEventBlocked,
  restoreOriginal
} from './injection/file-injector.js';
import { inspectImage, validateFile } from './image/metadata.js';
import { createProcessingPlan, resolveProcessingConfirmation } from './image/planner.js';
import { processImage } from './image/canvas-pipeline.js';
import { createTaskController, TaskController } from './core/task-controller.js';
import { createSession } from './core/session.js';
import { createCleanupRegistry, cleanupSession as cleanupResources } from './core/cleanup.js';
import {
  createStateMachine,
  canTransition,
  STATE_TRANSITIONS,
  SESSION_STATES
} from './core/state-machine.js';
import { observeRejection } from './dom/rejection-observer.js';
import {
  classifyRejectionText,
  isExplicitRejection
} from './dom/rejection-classifier.js';
import {
  createAdapterRegistry,
  resolveAdapter
} from './adapters/registry.js';

const BUILD_INFO = Object.freeze({
  version: __UPLOADFIT_VERSION__,
  mode: __UPLOADFIT_MODE__
});

if (typeof globalThis !== 'undefined') {
  Object.defineProperty(globalThis, '__uploadfit_build_info__', {
    configurable: true,
    enumerable: false,
    value: BUILD_INFO,
    writable: false
  });
}

export {
  BUILD_INFO,
  bootstrap,
  cleanupSession,
  createUploaderDiscovery,
  detectCapabilities,
  discoverUploaders,
  extractRelevantContext,
  findFileInputFromEvent,
  classifyMediaKind,
  isAudioMime,
  isAudioUploader,
  genericAdapter,
  cnipaPublicGuideAdapter,
  RuleUnderstandingProvider,
  TabbitAiProvider,
  createTabbitAiProvider,
  buildAiPrompt,
  containsSensitiveAiInput,
  validateAiRuleOutput,
  createUploadFitUi,
  createCropper,
  STATUS_TEXTS,
  statusText,
  injectFile,
  inspectImage,
  isImageMime,
  isImageUploader,
  inspectAudio,
  audioMetadataSnapshot,
  validateAudioMetadata,
  isAudioPassthrough,
  pageAllowsMp3,
  isSupportedAudioMetadata,
  validateAudioOutput,
  validateAudioOutputFile,
  createAudioProcessingPlan,
  createAudioPlan,
  buildAudioPlan,
  resolveAudioConfirmation,
  resolveAudioProcessingConfirmation,
  resolveConfirmation,
  processAudio,
  processAudioFile,
  createAudioPipeline,
  createAudioHandler,
  audioHandler,
  canUseAudioWorker,
  createAudioWorkerRuntime,
  createAudioWorkerSource,
  runAudioWorker,
  AUDIO_ENCODER_DESCRIPTOR,
  isFrozenAudioEncoderDescriptor,
  createMediaHandlerRegistry,
  createMediaHandlers,
  AUDIO_ERROR_CODES,
  AUDIO_ERROR_MESSAGES,
  AudioMetadataError,
  AudioProcessingError,
  audioErrorMessage,
  detectAudioSignature,
  findMp3Frame,
  parseMp3Header,
  parseMp3Signature,
  parseWavChunks,
  parseM4aSignature,
  markUntrustedEventBlocked,
  normalizeRuleText,
  parseRulesDeterministically,
  processImage,
  restoreOriginal,
  resolveProcessingConfirmation,
  resolveRules,
  createProcessingPlan,
  createTaskController,
  TaskController,
  createSession,
  createCleanupRegistry,
  cleanupResources,
  createStateMachine,
  canTransition,
  STATE_TRANSITIONS,
  SESSION_STATES,
  observeRejection,
  classifyRejectionText as classifyRejection,
  classifyRejectionText,
  isExplicitRejection,
  createAdapterRegistry,
  resolveAdapter,
  selectAiRelevantText,
  validateFile
};

if (typeof document !== 'undefined') bootstrap();
