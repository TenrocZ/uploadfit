import { createRandomId } from './utils/ids.js';
import { createLogger } from './utils/logger.js';
import { clearInjectionGuard } from './injection/injection-guard.js';
import { createTaskController } from './core/task-controller.js';
import { createTabbitAiProvider } from './providers/tabbit-ai.js';
import { createUploadFitUi } from './ui/host.js';

export const SESSION_KEY = '__uploadfit_session__';

function isFileInput(node) {
  return node?.nodeType === 1 && node.matches?.('input[type="file"]');
}

function scanInputs(node, callback) {
  if (isFileInput(node)) callback(node);
  node.querySelectorAll?.('input[type="file"]').forEach(callback);
}

function registerSession(globalRef, session) {
  Object.defineProperty(globalRef, SESSION_KEY, {
    configurable: true,
    enumerable: false,
    value: session,
    writable: false
  });
}

export function bootstrap({
  documentRef = globalThis.document,
  globalRef = globalThis,
  logger = createLogger(),
  ruleProvider = null,
  ui = true
} = {}) {
  if (!documentRef?.createElement || !globalRef) return null;

  const existingSession = globalRef[SESSION_KEY];
  if (existingSession?.active) {
    existingSession.host?.focus?.({ preventScroll: true });
    return existingSession;
  }

  const session = {
    sessionId: createRandomId('session'),
    active: true,
    host: null,
    ui: null,
    inputs: new Set(),
    inputCleanups: new Map(),
    observer: null,
    cleanup: null,
    controller: null
  };

  const attachInput = (input) => {
    if (!isFileInput(input) || session.inputs.has(input)) return false;
    session.inputs.add(input);
    session.inputCleanups.set(input, () => {
      clearInjectionGuard(input);
    });
    return true;
  };

  documentRef.querySelectorAll?.('input[type="file"]').forEach(attachInput);

  if (typeof globalRef.MutationObserver === 'function') {
    session.observer = new globalRef.MutationObserver((records) => {
      if (!session.active) return;
      for (const record of records) {
        record.addedNodes.forEach((node) => scanInputs(node, attachInput));
      }
    });
    session.observer.observe(documentRef.documentElement ?? documentRef, {
      childList: true,
      subtree: true
    });
  }

  session.controller = createTaskController({
    documentRef,
    globalRef,
    logger,
    sessionId: session.sessionId,
    ruleProvider: ruleProvider ?? createTabbitAiProvider({ globalRef, logger })
  });

  if (ui) {
    session.ui = createUploadFitUi({
      documentRef,
      globalRef,
      controller: session.controller,
      logger,
      onClose: () => session.cleanup()
    });
    session.host = session.ui?.host ?? null;
  }

  const onPageHide = () => session.cleanup();
  globalRef.addEventListener?.('pagehide', onPageHide, { once: true });

  session.cleanup = () => {
    if (!session.active) return;
    session.active = false;
    session.controller?.dispose?.();
    session.controller = null;
    session.ui?.dispose?.();
    session.ui = null;
    session.observer?.disconnect();
    session.observer = null;
    for (const cleanup of session.inputCleanups.values()) cleanup();
    session.inputCleanups.clear();
    session.inputs.clear();
    globalRef.removeEventListener?.('pagehide', onPageHide);
    session.host?.remove?.();
    session.host = null;
    if (globalRef[SESSION_KEY] === session) delete globalRef[SESSION_KEY];
  };

  registerSession(globalRef, session);
  session.controller.start();
  // 真实公开说明页（如国知局公告页）自动出现“按本页要求准备照片”卡。
  void Promise.resolve(session.controller.prepareManualCard?.()).catch(() => {});
  return session;
}

export function cleanupSession(globalRef = globalThis) {
  globalRef[SESSION_KEY]?.cleanup?.();
}
