import { createRandomId } from '../utils/ids.js';
import { createCleanupRegistry } from './cleanup.js';
import { createStateMachine } from './state-machine.js';

/**
 * Small session container shared by the S3 controller and bootstrap.
 * It intentionally stores DOM/File references only in the running page.
 */
export function createSession({
  sessionId = createRandomId('session'),
  logger = null,
  onTransition = () => {},
  onInvalidTransition = () => {}
} = {}) {
  const stateMachine = createStateMachine({
    initial: 'BOOTING',
    onTransition,
    onInvalid: onInvalidTransition
  });
  const resources = createCleanupRegistry();
  const uploaders = new Map();
  const tasks = new Map();
  let disposed = false;

  return {
    sessionId,
    stateMachine,
    resources,
    uploaders,
    tasks,

    get disposed() {
      return disposed;
    },

    dispose() {
      if (disposed) return false;
      disposed = true;
      for (const task of tasks.values()) task.abortController?.abort?.();
      resources.cleanup();
      stateMachine.transition('DISPOSED', { reason: 'SESSION_DISPOSED' });
      logger?.emit?.('SESSION_DISPOSED');
      uploaders.clear();
      tasks.clear();
      return true;
    }
  };
}

