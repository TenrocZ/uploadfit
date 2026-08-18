import { expect, test } from '@playwright/test';

test('reports browser capabilities without claiming Tabbit AI outside its script runtime', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });

  const capabilities = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    return api.detectCapabilities();
  });

  expect(capabilities).toMatchObject({
    file: true,
    blob: true,
    dataTransfer: true,
    inputFilesAssignable: true,
    canvasToBlob: true,
    createImageBitmap: true,
    worker: true,
    offscreenCanvas: true,
    blobWorkerAllowed: true,
    tabbitAi: {
      available: false,
      officialApi: null
    }
  });

  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
});

test('detects the documented LLMBridge.chat entry in a Tabbit-like script runtime', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });

  const tabbitAi = await page.evaluate(() => {
    globalThis.LLMBridge = { chat() {} };
    try {
      return globalThis.__uploadfit_debug_bundle__.detectCapabilities().tabbitAi;
    } finally {
      delete globalThis.LLMBridge;
    }
  });

  expect(tabbitAi).toEqual({
    available: true,
    officialApi: 'LLMBridge.chat',
    notes: 'LLMBridge.chat is available in the Tabbit official script runtime.'
  });

  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
});
