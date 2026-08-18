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

  try {
    const dataTransfer = new DataTransferConstructor();
    dataTransfer.items.add(file);
    armInjectionGuard(input, 'change');
    input.files = dataTransfer.files;

    const actual = input.files?.[0];
    if (!metadataMatches(actual, file)) {
      clearInjectionGuard(input);
      return failure('INJECTION_FAILED');
    }

    const eventsDispatched = [];
    if (dispatchEvents) {
      if (typeof EventConstructor !== 'function') {
        clearInjectionGuard(input);
        return failure('INJECTION_FAILED');
      }
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
    if (error?.name === 'NotSupportedError' || error?.name === 'TypeError') {
      return failure('DATATRANSFER_UNAVAILABLE');
    }
    return failure('INJECTION_FAILED');
  }
}

export function restoreOriginal(task) {
  if (!task?.inputElement || !task?.originalFile) return failure('INJECTION_FAILED');
  return injectFile(task.inputElement, task.originalFile, {
    dispatchEvents: true,
    reason: 'restore'
  });
}

