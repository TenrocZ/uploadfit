/**
 * Track every resource owned by a session/task. Cleanup is intentionally
 * idempotent so pagehide, navigation and explicit dispose can share it.
 */
export function createCleanupRegistry() {
  const cleanups = new Set();
  let disposed = false;

  const add = (cleanup) => {
    if (typeof cleanup !== 'function') return () => {};
    if (disposed) {
      try {
        cleanup();
      } catch {
        // Cleanup is best-effort after the registry has already been closed.
      }
      return () => {};
    }
    let active = true;
    const remove = () => {
      if (!active) return;
      active = false;
      cleanups.delete(remove);
    };
    cleanups.add(() => {
      if (!active) return;
      active = false;
      try {
        cleanup();
      } catch {
        // One broken resource must not prevent the remaining resources from
        // being released.
      }
    });
    return remove;
  };

  const registry = {
    get disposed() {
      return disposed;
    },

    get size() {
      return cleanups.size;
    },

    add,

    trackListener(target, type, listener, options) {
      if (!target?.addEventListener || typeof listener !== 'function') return () => {};
      target.addEventListener(type, listener, options);
      return add(() => target.removeEventListener?.(type, listener, options));
    },

    trackObserver(observer) {
      if (!observer) return () => {};
      return add(() => observer.disconnect?.());
    },

    trackAbortController(controller) {
      if (!controller) return () => {};
      return add(() => controller.abort?.());
    },

    trackWorker(worker) {
      if (!worker) return () => {};
      return add(() => worker.terminate?.());
    },

    trackObjectUrl(url, urlApi = globalThis.URL) {
      if (typeof url !== 'string' || !urlApi?.revokeObjectURL) return () => {};
      return add(() => urlApi.revokeObjectURL(url));
    },

    cleanup() {
      if (disposed) return false;
      disposed = true;
      const entries = [...cleanups];
      cleanups.clear();
      for (const cleanup of entries) cleanup();
      return true;
    }
  };

  return registry;
}

export function cleanupSession(resources) {
  if (typeof resources === 'function') return resources();
  return resources?.cleanup?.() ?? false;
}

