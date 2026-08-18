import { createRandomId } from './utils/ids.js';
import { createLogger } from './utils/logger.js';
import {
  clearInjectionGuard,
  consumeInjectionGuard
} from './injection/injection-guard.js';

export const SESSION_KEY = '__uploadfit_session__';
const HOST_ATTRIBUTE = 'data-uploadfit-host';

function isFileInput(node) {
  return node?.nodeType === 1 && node.matches?.('input[type="file"]');
}

function createStatusHost(documentRef) {
  const host = documentRef.createElement('div');
  host.setAttribute(HOST_ATTRIBUTE, 'true');
  host.setAttribute('role', 'status');
  host.tabIndex = -1;
  host.textContent = 'UploadFit 已启动';
  host.style.position = 'fixed';
  host.style.right = '16px';
  host.style.bottom = '16px';
  host.style.zIndex = '2147483647';
  host.style.padding = '8px 12px';
  host.style.borderRadius = '999px';
  host.style.background = '#172033';
  host.style.color = '#ffffff';
  host.style.font = '13px/1.4 system-ui, sans-serif';
  (documentRef.body ?? documentRef.documentElement)?.append(host);
  return host;
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
  logger = createLogger()
} = {}) {
  if (!documentRef?.createElement || !globalRef) return null;

  const existingSession = globalRef[SESSION_KEY];
  if (existingSession?.active) {
    existingSession.host?.focus?.({ preventScroll: true });
    return existingSession;
  }

  const host = createStatusHost(documentRef);
  const session = {
    sessionId: createRandomId('session'),
    active: true,
    host,
    inputs: new Set(),
    inputCleanups: new Map(),
    observer: null,
    cleanup: null
  };

  const attachInput = (input) => {
    if (!isFileInput(input) || session.inputs.has(input)) return false;
    const onChange = (event) => {
      consumeInjectionGuard(input, event);
    };
    input.addEventListener('change', onChange, true);
    session.inputs.add(input);
    session.inputCleanups.set(input, () => {
      input.removeEventListener('change', onChange, true);
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

  const onPageHide = () => session.cleanup();
  globalRef.addEventListener?.('pagehide', onPageHide, { once: true });

  session.cleanup = () => {
    if (!session.active) return;
    session.active = false;
    session.observer?.disconnect();
    session.observer = null;
    for (const cleanup of session.inputCleanups.values()) cleanup();
    session.inputCleanups.clear();
    session.inputs.clear();
    globalRef.removeEventListener?.('pagehide', onPageHide);
    host.remove();
    if (globalRef[SESSION_KEY] === session) delete globalRef[SESSION_KEY];
    logger.emit('SESSION_DISPOSED');
  };

  registerSession(globalRef, session);
  logger.emit('SESSION_STARTED', { taskId: session.sessionId });
  return session;
}

export function cleanupSession(globalRef = globalThis) {
  globalRef[SESSION_KEY]?.cleanup?.();
}
