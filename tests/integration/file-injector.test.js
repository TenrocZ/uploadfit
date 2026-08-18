import { expect, test } from '@playwright/test';

test('injects a File, dispatches events, and keeps one session host', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });

  const result = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const firstSession = api.bootstrap();
    const secondSession = api.bootstrap();
    const injection = api.injectFile(
      document.querySelector('#probe-file'),
      new File(['processed'], 'processed.jpg', { type: 'image/jpeg', lastModified: 0 }),
      { dispatchEvents: true, reason: 'processed' }
    );
    const events = globalThis.uploadFitS0Probe.getEvents();
    return {
      sameSession: firstSession === secondSession,
      hostCount: document.querySelectorAll('[data-uploadfit-host]').length,
      injection,
      currentFile: globalThis.uploadFitS0Probe.getCurrentFile(),
      eventPhases: events.map((event) => `${event.type}:${event.phase}:${event.isTrusted}`)
    };
  });

  expect(result.sameSession).toBe(true);
  expect(result.hostCount).toBe(1);
  expect(result.injection).toEqual({
    ok: true,
    inputFilesVerified: true,
    eventsDispatched: ['input', 'change'],
    fallback: null,
    errorCode: null
  });
  expect(result.currentFile.type).toBe('image/jpeg');
  expect(result.currentFile.size).toBe(9);
  expect(result.eventPhases).toEqual([
    'input:capture:false',
    'input:target:false',
    'input:bubble:false',
    'change:capture:false',
    'change:target:false',
    'change:bubble:false'
  ]);

  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
  await expect(page.locator('[data-uploadfit-host]')).toHaveCount(0);
});

test('restores the saved original File through the product API', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });

  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const probe = globalThis.uploadFitS0Probe;
    const input = document.querySelector('#probe-file');
    const originalFile = new File(['original-a'], 'original-a.png', {
      type: 'image/png',
      lastModified: 0
    });
    const processedFile = new File(['processed-b'], 'processed-b.jpg', {
      type: 'image/jpeg',
      lastModified: 0
    });

    const initial = api.injectFile(input, originalFile, {
      dispatchEvents: false,
      reason: 'probe'
    });
    probe.clearLog();
    const processed = api.injectFile(input, processedFile, {
      dispatchEvents: true,
      reason: 'processed'
    });
    const restored = api.restoreOriginal({
      inputElement: input,
      originalFile
    });
    const events = probe.getEvents();

    return {
      initial,
      processed,
      restored,
      restoredFile: {
        ...probe.getCurrentFile(),
        text: await input.files[0].text()
      },
      eventTypes: events.map((event) => event.type),
      eventTrusted: events.map((event) => event.isTrusted)
    };
  });

  expect(result.initial).toEqual({
    ok: true,
    inputFilesVerified: true,
    eventsDispatched: [],
    fallback: null,
    errorCode: null
  });
  expect(result.processed.eventsDispatched).toEqual(['input', 'change']);
  expect(result.restored).toEqual({
    ok: true,
    inputFilesVerified: true,
    eventsDispatched: ['input', 'change'],
    fallback: null,
    errorCode: null
  });
  expect(result.restoredFile).toEqual({
    name: 'original-a.png',
    type: 'image/png',
    size: 10,
    text: 'original-a'
  });
  expect(result.eventTypes).toEqual([
    'input', 'input', 'input', 'change', 'change', 'change',
    'input', 'input', 'input', 'change', 'change', 'change'
  ]);
  expect(result.eventTrusted.every((value) => value === false)).toBe(true);

  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
});
