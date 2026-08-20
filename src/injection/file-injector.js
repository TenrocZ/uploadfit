import {
  armInjectionGuard,
  clearInjectionGuard
} from './injection-guard.js';

function failure(errorCode, fallback = 'download') {
  return {
    ok: false,
    inputFilesVerified: false,
    eventsDispatched: [],
    fallback,
    errorCode
  };
}

const ALLOWED_FALLBACKS = new Set(['manual-submit', 'download']);
const UNTRUSTED_EVENT_ACTION = 'USE_ORIGINAL_UPLOAD_BUTTON';

function isFileForInput(input, file) {
  const FileConstructor = input.ownerDocument?.defaultView?.File ?? globalThis.File;
  return typeof FileConstructor === 'function' && file instanceof FileConstructor;
}

function metadataMatches(actual, expected) {
  return Boolean(
    actual &&
    actual.name === expected.name &&
    actual.type === expected.type &&
    actual.size === expected.size
  );
}

function filesOf(input) {
  try {
    return Array.from(input?.files ?? []);
  } catch {
    return [];
  }
}

function fileListsMatch(actual, expected) {
  return actual.length === expected.length
    && actual.every((file, index) => metadataMatches(file, expected[index]));
}

function assignFiles(input, files, DataTransferConstructor) {
  const dataTransfer = new DataTransferConstructor();
  for (const file of files) dataTransfer.items.add(file);
  input.files = dataTransfer.files;
  return fileListsMatch(filesOf(input), files);
}

/**
 * Replace a file input's FileList and optionally dispatch the normal events.
 * @param {HTMLInputElement} input
 * @param {File} file
 * @param {{dispatchEvents?: boolean, reason?: 'processed'|'restore'|'probe'}} options
 */
export function injectFile(input, file, options = {}) {
  if (!input || input.nodeType !== 1 || input.tagName !== 'INPUT' || input.type !== 'file') {
    return failure('INJECTION_FAILED');
  }
  if (!input.isConnected) return failure('INPUT_DETACHED');
  if (!isFileForInput(input, file)) return failure('INJECTION_FAILED');

  const DataTransferConstructor = input.ownerDocument?.defaultView?.DataTransfer
    ?? globalThis.DataTransfer;
  if (typeof DataTransferConstructor !== 'function') {
    return failure('DATATRANSFER_UNAVAILABLE');
  }

  const dispatchEvents = options.dispatchEvents !== false;
  const EventConstructor = input.ownerDocument?.defaultView?.Event ?? globalThis.Event;
  const previousFiles = filesOf(input);
  let phase = 'prepare';

  try {
    phase = 'assign';
    if (!assignFiles(input, [file], DataTransferConstructor)) {
      if (!fileListsMatch(filesOf(input), previousFiles)
        && !assignFiles(input, previousFiles, DataTransferConstructor)) {
        return failure('RESTORE_FAILED');
      }
      return failure('INJECTION_FAILED');
    }

    const eventsDispatched = [];
    if (dispatchEvents) {
      if (typeof EventConstructor !== 'function') {
        throw new Error('Event API unavailable.');
      }
      phase = 'dispatch';
      armInjectionGuard(input, 'change');
      try {
        input.dispatchEvent(new EventConstructor('input', { bubbles: true, composed: true }));
        eventsDispatched.push('input');
        input.dispatchEvent(new EventConstructor('change', { bubbles: true, composed: true }));
        eventsDispatched.push('change');
      } finally {
        // Dispatch is synchronous; any guard listener has already consumed its token.
        clearInjectionGuard(input);
      }
    } else {
      clearInjectionGuard(input);
    }

    return {
      ok: true,
      inputFilesVerified: true,
      eventsDispatched,
      fallback: null,
      errorCode: null
    };
  } catch (error) {
    clearInjectionGuard(input);
    const changed = !fileListsMatch(filesOf(input), previousFiles);
    if (changed) {
      try {
        if (!assignFiles(input, previousFiles, DataTransferConstructor)) {
          return failure('RESTORE_FAILED');
        }
      } catch {
        return failure('RESTORE_FAILED');
      }
    }
    if (phase === 'prepare'
      || (phase === 'assign' && (error?.name === 'NotSupportedError' || error?.name === 'TypeError'))) {
      return failure('DATATRANSFER_UNAVAILABLE');
    }
    return failure('INJECTION_FAILED');
  }
}

/**
 * Convert a successful file write into an explicit untrusted-event fallback
 * after the page fails to respond to synthetic events.
 * S0 exposes this result conversion; S3 owns the page-response observer.
 * @param {ReturnType<typeof injectFile>} injectionResult
 * @param {{fallback?: 'manual-submit'|'download'}} options
 */
export function markUntrustedEventBlocked(injectionResult, options = {}) {
  const fallback = options.fallback ?? 'manual-submit';
  if (!ALLOWED_FALLBACKS.has(fallback)) return failure('INJECTION_FAILED');
  if (!injectionResult?.ok || !injectionResult.inputFilesVerified) {
    return failure('INJECTION_FAILED', fallback);
  }

  return {
    ...injectionResult,
    ok: false,
    fallback,
    errorCode: 'UNTRUSTED_EVENT_BLOCKED',
    userAction: UNTRUSTED_EVENT_ACTION
  };
}

export function restoreOriginal(task) {
  if (!task?.inputElement || !task?.originalFile) return failure('INJECTION_FAILED');
  return injectFile(task.inputElement, task.originalFile, {
    dispatchEvents: true,
    reason: 'restore'
  });
}
