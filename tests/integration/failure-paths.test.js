import { expect, test } from '@playwright/test';

function expectedFailure(errorCode) {
  return {
    ok: false,
    inputFilesVerified: false,
    eventsDispatched: [],
    fallback: 'download',
    errorCode
  };
}

test('returns stable fallback results for S0 injection failure paths', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });

  const result = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const makeFile = (name) => new File(['failure-path'], name, { type: 'image/jpeg' });

    const detachedInput = document.createElement('input');
    detachedInput.type = 'file';
    const detached = api.injectFile(detachedInput, makeFile('detached.jpg'));

    const dataTransferDescriptor = Object.getOwnPropertyDescriptor(window, 'DataTransfer');
    let dataTransferUnavailable;
    try {
      Object.defineProperty(window, 'DataTransfer', {
        configurable: true,
        value: undefined
      });
      dataTransferUnavailable = api.injectFile(
        document.querySelector('#probe-file'),
        makeFile('unavailable.jpg')
      );
    } finally {
      if (dataTransferDescriptor) {
        Object.defineProperty(window, 'DataTransfer', dataTransferDescriptor);
      } else {
        delete window.DataTransfer;
      }
    }

    const failingInput = document.createElement('input');
    failingInput.type = 'file';
    document.body.append(failingInput);
    let injectionFailed;
    try {
      Object.defineProperty(failingInput, 'files', {
        configurable: true,
        get: () => null,
        set: () => {}
      });
      injectionFailed = api.injectFile(failingInput, makeFile('mismatch.jpg'));
    } finally {
      failingInput.remove();
    }

    return { detached, dataTransferUnavailable, injectionFailed };
  });

  expect(result.detached).toEqual(expectedFailure('INPUT_DETACHED'));
  expect(result.dataTransferUnavailable).toEqual(expectedFailure('DATATRANSFER_UNAVAILABLE'));
  expect(result.injectionFailed).toEqual(expectedFailure('INJECTION_FAILED'));
});

test('cleanupSession is idempotent and permits a clean rebootstrap', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });

  const result = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const firstSession = api.bootstrap();
    firstSession.cleanup();

    let secondCleanupThrew = false;
    try {
      firstSession.cleanup();
      api.cleanupSession();
    } catch {
      secondCleanupThrew = true;
    }

    const afterCleanup = {
      active: firstSession.active,
      hostCount: document.querySelectorAll('[data-uploadfit-host]').length,
      sessionPresent: Boolean(globalThis.__uploadfit_session__),
      inputCleanups: firstSession.inputCleanups.size,
      observer: firstSession.observer
    };
    const newSession = api.bootstrap();

    return {
      secondCleanupThrew,
      afterCleanup,
      newSessionCreated: newSession !== firstSession,
      newHostCount: document.querySelectorAll('[data-uploadfit-host]').length
    };
  });

  expect(result.secondCleanupThrew).toBe(false);
  expect(result.afterCleanup).toMatchObject({
    active: false,
    hostCount: 0,
    sessionPresent: false,
    inputCleanups: 0,
    observer: null
  });
  expect(result.newSessionCreated).toBe(true);
  expect(result.newHostCount).toBe(1);

  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
});
