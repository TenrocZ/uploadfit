import { expect, test } from '@playwright/test';

test('reports the S0 capability probe and keeps AI provider unknown', async ({ page }) => {
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
