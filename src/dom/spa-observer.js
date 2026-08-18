import { DOM_DEBOUNCE_MS } from '../config.js';

/**
 * Observe browser-level SPA navigation signals without monkey-patching history.
 * DOM mutations are observed by input-discovery; this module only debounces
 * route events and delegates the rescan to its caller.
 *
 * @param {{windowRef?: Window, onChange?: () => void, debounceMs?: number}} options
 */
export function createSpaObserver({
  windowRef = globalThis,
  onChange = () => {},
  debounceMs = DOM_DEBOUNCE_MS
} = {}) {
  let active = false;
  let timer = null;

  const setTimer = windowRef?.setTimeout?.bind(windowRef) ?? setTimeout;
  const clearTimer = windowRef?.clearTimeout?.bind(windowRef) ?? clearTimeout;

  const flush = () => {
    timer = null;
    if (active) onChange();
  };

  const schedule = () => {
    if (!active) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(flush, debounceMs);
  };

  const onRouteChange = () => schedule();

  return {
    get active() {
      return active;
    },

    start() {
      if (active) return this;
      active = true;
      windowRef?.addEventListener?.('popstate', onRouteChange);
      windowRef?.addEventListener?.('hashchange', onRouteChange);
      return this;
    },

    schedule,

    cleanup() {
      if (!active && timer === null) return;
      active = false;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      windowRef?.removeEventListener?.('popstate', onRouteChange);
      windowRef?.removeEventListener?.('hashchange', onRouteChange);
    }
  };
}
