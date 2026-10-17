import { bootstrap, cleanupSession, SESSION_KEY } from './bootstrap.js';

const RUNTIME_KEY = '__uploadfit_runtime__';

/** Start after the DOM exists, and restore active sessions after bfcache navigation. */
export function startBrowserRuntime({
  documentRef = globalThis.document,
  globalRef = globalThis,
  createRuleProvider = () => null
} = {}) {
  if (!documentRef?.addEventListener || !globalRef?.addEventListener) return null;
  // The userscript metadata also excludes frames. This guard covers manual
  // execution and keeps parent/iframe file realms from being mixed.
  if (globalRef.top && globalRef.top !== globalRef) return null;

  if (globalRef[RUNTIME_KEY]) return globalRef[RUNTIME_KEY];
  let resumeAfterNavigation = false;
  const start = () => bootstrap({ documentRef, globalRef, ruleProvider: createRuleProvider() });
  const onHide = (event) => {
    resumeAfterNavigation = Boolean(event.persisted && globalRef[SESSION_KEY]?.active);
    cleanupSession(globalRef);
  };
  const onShow = (event) => {
    if (event.persisted && resumeAfterNavigation) {
      resumeAfterNavigation = false;
      start();
    }
  };
  const runtime = {
    dispose() {
      documentRef.removeEventListener('DOMContentLoaded', start);
      globalRef.removeEventListener('pagehide', onHide);
      globalRef.removeEventListener('pageshow', onShow);
      cleanupSession(globalRef);
      if (globalRef[RUNTIME_KEY] === runtime) delete globalRef[RUNTIME_KEY];
    }
  };
  Object.defineProperty(globalRef, RUNTIME_KEY, {
    configurable: true, enumerable: false, value: runtime
  });
  // Register before bootstrap's cleanup so the previous active state survives.
  globalRef.addEventListener('pagehide', onHide);
  globalRef.addEventListener('pageshow', onShow);
  if (documentRef.readyState === 'loading') {
    documentRef.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
  return runtime;
}
