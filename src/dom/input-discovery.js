import { DOM_DEBOUNCE_MS } from '../config.js';
import { createRandomId } from '../utils/ids.js';
import { createSpaObserver } from './spa-observer.js';

const FILE_INPUT_SELECTOR = 'input[type="file"]';
const MAX_DISCOVERY_LABEL_LENGTH = 240;
const IMAGE_ACCEPT_PATTERN = /^(?:image\/\*|image\/(?:jpeg|png|webp)|\.(?:jpe?g|png|webp))$/i;
const IMAGE_TEXT_PATTERN = /(?:图片|图像|照片|证件照|头像|封面|扫描件|image|picture|photo|portrait|avatar|cover|scan)/i;
const AUDIO_ACCEPT_PATTERN = /^(?:audio\/\*|audio\/(?:mpeg|mp3|mp4|aac|wav|x-wav|webm)|\.(?:mp3|m4a|aac|wav|webm))$/i;
const VIDEO_ACCEPT_PATTERN = /^(?:video\/|\.(?:mp4|mov|avi|mkv|webm))$/i;
const AUDIO_TEXT_PATTERN = /(?:(?:上传|选择|添加|支持|允许|接受|格式|文件|转写).{0,10}(?:音频|录音|mp3|m4a|aac|wav)|(?:音频|录音|mp3|m4a|aac|wav).{0,10}(?:上传|文件|转写|格式|选择))/i;

function isElement(node) {
  return node?.nodeType === 1;
}

function isDocument(node) {
  return node?.nodeType === 9;
}

function isShadowRoot(node) {
  return node?.nodeType === 11 && 'host' in node;
}

function isFileInput(node) {
  return isElement(node) && node.matches?.(FILE_INPUT_SELECTOR) === true;
}

function isUploadFitUiInput(input) {
  if (!input) return false;
  if (input.closest?.('[data-uploadfit-ui-host]')) return true;
  const root = input.getRootNode?.();
  return Boolean(root?.host?.matches?.('[data-uploadfit-ui-host]'));
}

function normalizeText(value) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_DISCOVERY_LABEL_LENGTH)
    : '';
}

function uniqueTexts(values) {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function getOwnerDocument(node) {
  if (isDocument(node)) return node;
  return node?.ownerDocument ?? null;
}

function getDocumentView(documentRef) {
  return documentRef?.defaultView ?? globalThis;
}

function getPageUrl(documentRef) {
  try {
    return String(getDocumentView(documentRef)?.location?.href ?? '');
  } catch {
    return '';
  }
}

function getPageTitle(documentRef) {
  return typeof documentRef?.title === 'string' ? documentRef.title : '';
}

export function getAssociatedTexts(input) {
  const documentRef = getOwnerDocument(input);
  const values = [];

  values.push(input.getAttribute?.('aria-label'));
  values.push(input.getAttribute?.('title'));

  if (input.labels) {
    values.push(...Array.from(input.labels, (label) => label.textContent));
  }

  const inputId = input.getAttribute?.('id');
  if (inputId && documentRef?.querySelectorAll) {
    for (const label of documentRef.querySelectorAll('label[for]')) {
      if (label.getAttribute('for') === inputId) values.push(label.textContent);
    }
  }

  values.push(input.closest?.('label')?.textContent);
  values.push(input.closest?.('fieldset')?.querySelector?.('legend')?.textContent);

  const describedBy = (input.getAttribute?.('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  for (const id of describedBy) values.push(documentRef?.getElementById?.(id)?.textContent);
  values.push(input.previousElementSibling?.textContent);
  values.push(input.nextElementSibling?.textContent);

  return uniqueTexts(values);
}

function acceptContainsImage(accept) {
  if (typeof accept !== 'string') return false;
  return accept
    .split(',')
    .map((token) => token.trim())
    .some((token) => IMAGE_ACCEPT_PATTERN.test(token));
}

function acceptTokens(accept) {
  return typeof accept === 'string'
    ? accept.split(',').map((token) => token.trim()).filter(Boolean)
    : [];
}

function acceptContainsAudio(accept) {
  return acceptTokens(accept).some((token) => AUDIO_ACCEPT_PATTERN.test(token));
}

function acceptContainsVideo(accept) {
  return acceptTokens(accept).some((token) => VIDEO_ACCEPT_PATTERN.test(token));
}

function acceptContainsMixedMedia(accept) {
  return acceptContainsImage(accept) && acceptContainsAudio(accept);
}

/**
 * Return whether an input is an image uploader candidate according to S1-D1.
 * A bare file input without an image accept hint or associated image text is
 * intentionally left for the later file-MIME upgrade path.
 */
export function isImageUploader(input) {
  if (!isFileInput(input) || isUploadFitUiInput(input)) return false;
  const accept = input.getAttribute('accept');
  if (acceptContainsMixedMedia(accept) || acceptContainsAudio(accept) || acceptContainsVideo(accept)) {
    return false;
  }
  const associatedTexts = getAssociatedTexts(input);
  if (acceptContainsImage(accept)
    && associatedTexts.some((text) => AUDIO_TEXT_PATTERN.test(text))
    && !associatedTexts.some((text) => IMAGE_TEXT_PATTERN.test(text))) return false;
  return acceptContainsImage(accept)
    || associatedTexts.some((text) => IMAGE_TEXT_PATTERN.test(text));
}

/** Validate only a caller-provided File.type/MIME string; no file bytes are read. */
export function isImageMime(mime) {
  return typeof mime === 'string' && /^image\/[^\s;]+$/i.test(mime.trim());
}

export function isAudioMime(mime) {
  return typeof mime === 'string'
    && /^(?:audio\/(?:mpeg|mp3|mp4|aac|wav|x-wav|webm))$/i.test(mime.trim());
}

export function isAudioUploader(input) {
  if (!isFileInput(input) || isUploadFitUiInput(input)) return false;
  const accept = input.getAttribute('accept');
  if (acceptContainsMixedMedia(accept) || acceptContainsImage(accept) || acceptContainsVideo(accept)) return false;
  const associatedTexts = getAssociatedTexts(input);
  if (acceptContainsAudio(accept)
    && associatedTexts.some((text) => IMAGE_TEXT_PATTERN.test(text))
    && !associatedTexts.some((text) => AUDIO_TEXT_PATTERN.test(text))) return false;
  return acceptContainsAudio(accept) || associatedTexts.some((text) => AUDIO_TEXT_PATTERN.test(text));
}

/** Determine exactly one media kind, preserving the V1 image boundary. */
export function classifyMediaKind(input, selectedMime = null) {
  if (!isFileInput(input) || isUploadFitUiInput(input)) return null;
  const accept = input.getAttribute('accept');
  if (acceptContainsMixedMedia(accept)) return null;
  if (isAudioUploader(input)) return 'audio';
  if (isImageUploader(input)) return 'image';
  // A selected audio file may upgrade only when nearby text is strong audio
  // evidence; MIME alone must not turn every bare input into an audio handler.
  if (isAudioMime(selectedMime) && getAssociatedTexts(input).some((text) => AUDIO_TEXT_PATTERN.test(text))) {
    return 'audio';
  }
  if (isImageMime(selectedMime)) return 'image';
  return null;
}

function createUploaderContext(input, selectedMime = null) {
  const documentRef = getOwnerDocument(input);
  const associatedTexts = getAssociatedTexts(input);
  const uploaderId = createRandomId('uploader');
  const mediaKind = classifyMediaKind(input, selectedMime);
  const root = input.getRootNode?.();

  return {
    input,
    uploaderId,
    id: uploaderId,
    mediaKind,
    acceptTokens: acceptTokens(input.getAttribute('accept')),
    associatedText: associatedTexts.join(' ').slice(0, MAX_DISCOVERY_LABEL_LENGTH),
    label: associatedTexts[0] ?? '',
    nearbyTexts: [],
    alertTexts: [],
    accept: input.getAttribute('accept'),
    multiple: Boolean(input.multiple),
    autoProcessable: mediaKind !== 'audio' || !input.multiple,
    form: input.form ?? null,
    rootKind: root?.nodeType === 11 ? 'open-shadow' : 'document',
    pageUrl: getPageUrl(documentRef),
    pageTitle: getPageTitle(documentRef),
    adapterId: null,
    adapter: null
  };
}

function getMutationObserver(documentRef) {
  return getDocumentView(documentRef)?.MutationObserver
    ?? globalThis.MutationObserver;
}

function getFrameDocument(frame) {
  try {
    return frame.contentDocument ?? null;
  } catch {
    return null;
  }
}

function getRootDocument(root) {
  return isDocument(root) ? root : getOwnerDocument(root);
}

function scanTree(root, handlers, local = {}) {
  if (!root) return;
  const seenNodes = local.seenNodes ?? new WeakSet();
  const seenDocuments = local.seenDocuments ?? new WeakSet();
  const seenRoots = local.seenRoots ?? new WeakSet();

  const visitElement = (element) => {
    if (seenNodes.has(element)) return;
    seenNodes.add(element);
    handlers.visitElement(element);

    if (element.shadowRoot) {
      scanTree(element.shadowRoot, handlers, { seenNodes, seenDocuments, seenRoots });
    }

    if (element.localName === 'iframe') {
      handlers.observeFrame?.(element);
      const frameDocument = getFrameDocument(element);
      if (frameDocument) {
        handlers.frameDocument?.(element, frameDocument);
        scanTree(frameDocument, handlers, { seenNodes, seenDocuments, seenRoots });
      } else {
        handlers.protectedFrame(element);
      }
    }
  };

  if (isDocument(root)) {
    if (seenDocuments.has(root)) return;
    seenDocuments.add(root);
  }
  if (isShadowRoot(root)) {
    if (seenRoots.has(root)) return;
    seenRoots.add(root);
    handlers.observeRoot(root);
  }

  if (isElement(root)) visitElement(root);

  const elements = root.querySelectorAll?.('*') ?? [];
  for (const element of elements) {
    visitElement(element);
  }

  if (isDocument(root)) handlers.observeRoot(root);
}

/**
 * Discover image/audio uploaders once in a DOM subtree.
 * @param {Document|Element|ShadowRoot} root
 * @param {{onProtectedFrame?: (detail: object) => void}} options
 * @returns {Array<object>}
 */
export function discoverUploaders(root = globalThis.document, options = {}) {
  const contexts = [];
  const seenInputs = new WeakSet();
  const protectedFrames = new WeakSet();
  const handlers = {
    observeRoot() {},
    protectedFrame(frame) {
      if (protectedFrames.has(frame)) return;
      protectedFrames.add(frame);
      options.onProtectedFrame?.({
        frame,
        reason: 'CROSS_ORIGIN_OR_UNAVAILABLE'
      });
    },
    visitElement(element) {
      if (!classifyMediaKind(element) || seenInputs.has(element)) return;
      seenInputs.add(element);
      contexts.push(createUploaderContext(element));
    }
  };

  scanTree(root, handlers);
  return contexts;
}

/**
 * Find a file input through a composed event path. This is the safe bridge for
 * later event-driven discovery inside an open shadow root.
 */
export function findFileInputFromEvent(event) {
  const path = typeof event?.composedPath === 'function'
    ? event.composedPath()
    : [event?.target];
  return path.find((node) => isFileInput(node)) ?? null;
}

/**
 * Create a subscription-based uploader discovery lifecycle.
 * @param {{root?: Document|Element|ShadowRoot, onDiscover?: (context: object) => void, onRemove?: (context: object, detail: object) => void, onProtectedFrame?: (detail: object) => void, debounceMs?: number}} options
 */
export function createUploaderDiscovery({
  root = globalThis.document,
  onDiscover = () => {},
  onRemove = () => {},
  onProtectedFrame = () => {},
  debounceMs = DOM_DEBOUNCE_MS
} = {}) {
  let active = false;
  let registeredInputs = new WeakSet();
  let contexts = new Map();
  let protectedFrames = [];
  let protectedFrameSet = new WeakSet();
  let observedRoots = new WeakMap();
  const mutationObservers = new Set();
  const frameListeners = new Map();
  const frameDocuments = new Map();
  const eventListeners = [];
  let spaObserver = null;

  const rootDocument = getRootDocument(root);
  const rootView = getDocumentView(rootDocument);

  const reportProtectedFrame = (frame) => {
    if (protectedFrameSet.has(frame)) return;
    protectedFrameSet.add(frame);
    const detail = { frame, reason: 'CROSS_ORIGIN_OR_UNAVAILABLE' };
    protectedFrames.push(detail);
    onProtectedFrame(detail);
  };

  const isInputInRoot = (input) => {
    if (!input?.isConnected) return false;
    const isRootDocument = input.ownerDocument === rootDocument;
    const isKnownFrameDocument = [...frameDocuments.values()].some(
      (documentRef) => documentRef === input.ownerDocument
    );
    if (!isRootDocument && !isKnownFrameDocument) return false;
    if (isDocument(root)) return true;
    return Boolean(root?.contains?.(input) || input.getRootNode?.() === root);
  };

  const registerInput = (input, mime = null) => {
    if (!active || !isFileInput(input) || registeredInputs.has(input)) return null;
    if (isUploadFitUiInput(input)) return null;
    const mediaKind = classifyMediaKind(input, mime);
    if (!isInputInRoot(input) || !mediaKind) return null;
    registeredInputs.add(input);
    const context = createUploaderContext(input, mime);
    contexts.set(input, context);
    onDiscover(context);
    return context;
  };

  const unregisterInput = (input, reason = 'INPUT_REMOVED') => {
    const context = contexts.get(input);
    if (!context) return false;
    contexts.delete(input);
    registeredInputs.delete(input);
    onRemove(context, { reason });
    return true;
  };

  const pruneDisconnectedInputs = () => {
    for (const [input] of contexts) {
      if (!isInputInRoot(input)) unregisterInput(input);
    }
  };

  const observeRoot = (mutationRoot) => {
    if (!active || observedRoots.has(mutationRoot)) return;
    const documentRef = getOwnerDocument(mutationRoot) ?? rootDocument;
    const Observer = getMutationObserver(documentRef);
    if (typeof Observer !== 'function') return;

    const observer = new Observer((records) => {
      if (!active) return;
      for (const record of records) {
        for (const node of record.addedNodes) scanAddedNode(node);
      }
      // Run after the complete mutation batch so moving a still-connected input
      // does not look like a removal.
      pruneDisconnectedInputs();
    });
    observer.observe(mutationRoot, { childList: true, subtree: true });
    observedRoots.set(mutationRoot, observer);
    mutationObservers.add(observer);
  };

  const disconnectRoot = (mutationRoot) => {
    const observer = observedRoots.get(mutationRoot);
    if (!observer) return;
    observer.disconnect();
    mutationObservers.delete(observer);
    observedRoots.delete(mutationRoot);
  };

  const removeContextsFromDocument = (documentRef) => {
    for (const [input] of contexts) {
      if (input.ownerDocument === documentRef) {
        unregisterInput(input, 'FRAME_DOCUMENT_REPLACED');
      }
    }
  };

  const recordFrameDocument = (frame, documentRef) => {
    const previous = frameDocuments.get(frame);
    if (previous && previous !== documentRef) {
      disconnectRoot(previous);
      removeContextsFromDocument(previous);
    }
    frameDocuments.set(frame, documentRef);
  };

  const observeFrame = (frame) => {
    if (!active || frameListeners.has(frame)) return;
    const onLoad = () => {
      if (!active) return;
      const frameDocument = getFrameDocument(frame);
      if (!frameDocument) {
        reportProtectedFrame(frame);
        return;
      }
      recordFrameDocument(frame, frameDocument);
      scanTree(frameDocument, handlers);
    };
    frame.addEventListener?.('load', onLoad);
    frameListeners.set(frame, onLoad);
  };

  const handlers = {
    observeRoot,
    observeFrame,
    frameDocument: recordFrameDocument,
    protectedFrame: reportProtectedFrame,
    visitElement: registerInput
  };

  function scanAddedNode(node) {
    if (!active || (!isElement(node) && !isDocument(node) && !isShadowRoot(node))) return [];
    const before = contexts.size;
    scanTree(node, handlers);
    return [...contexts.values()].slice(before);
  }

  const scan = () => {
    if (!active || !root) return [];
    pruneDisconnectedInputs();
    const before = contexts.size;
    scanTree(root, handlers);
    return [...contexts.values()].slice(before);
  };

  const cleanup = () => {
    if (!active && mutationObservers.size === 0 && !spaObserver
      && frameListeners.size === 0 && eventListeners.length === 0) return;
    active = false;
    for (const observer of mutationObservers) observer.disconnect();
    mutationObservers.clear();
    for (const [frame, listener] of frameListeners) frame.removeEventListener?.('load', listener);
    frameListeners.clear();
    for (const { target, type, listener } of eventListeners) {
      target.removeEventListener?.(type, listener, true);
    }
    eventListeners.length = 0;
    spaObserver?.cleanup();
    spaObserver = null;
    contexts.clear();
    protectedFrames = [];
    registeredInputs = new WeakSet();
    protectedFrameSet = new WeakSet();
    observedRoots = new WeakMap();
    frameDocuments.clear();
  };

  const onComposedEvent = (event) => {
    if (!active) return;
    const input = findFileInputFromEvent(event);
    if (input && classifyMediaKind(input)) registerInput(input);
  };

  return {
    get active() {
      return active;
    },

    start() {
      if (active) return [...contexts.values()];
      active = true;
      observeRoot(root);
      for (const type of ['input', 'change']) {
        rootDocument?.addEventListener?.(type, onComposedEvent, true);
        if (rootDocument?.addEventListener) eventListeners.push({
          target: rootDocument,
          type,
          listener: onComposedEvent
        });
      }
      spaObserver = createSpaObserver({
        windowRef: rootView,
        debounceMs,
        onChange: scan
      }).start();
      return scan();
    },

    scan,

    discoverFromEvent(event, mime = null) {
      const input = findFileInputFromEvent(event);
      return input ? contexts.get(input) ?? registerInput(input, mime) : null;
    },

    upgradeFromMime(input, mime) {
      if ((!isImageMime(mime) && !isAudioMime(mime)) || !isInputInRoot(input)) return null;
      return contexts.get(input) ?? registerInput(input, mime);
    },

    getUploaders() {
      return [...contexts.values()];
    },

    getProtectedFrames() {
      return protectedFrames.slice();
    },

    cleanup
  };
}
