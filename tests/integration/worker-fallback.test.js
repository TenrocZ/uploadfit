import { expect, test } from '@playwright/test';

async function openApi(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
}

test('I16: worker success and CSP/constructor failure fall back to one main-thread result', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const rules = {
      formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'], minBytes: 1, maxBytes: 120_000,
      width: { exact: 120, min: null, max: null }, height: { exact: 80, min: null, max: null },
      aspectRatio: { value: 1.5, tolerance: 0.015 }, dpi: null, count: { max: 1 }, background: null,
      semanticRequirements: [], confidence: 0.96, sources: [], conflicts: [], advisories: [],
      safetyFlags: [], actionable: true
    };
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2457aa';
    context.fillRect(0, 0, 120, 80);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'worker.png', { type: 'image/png' });
    const plan = api.createProcessingPlan(await api.inspectImage(file), rules);
    const workerResult = await api.processImage(file, plan, undefined, { useWorker: true });

    const descriptor = Object.getOwnPropertyDescriptor(window, 'Worker');
    const OriginalWorker = window.Worker;
    let fallbackResult;
    try {
      window.Worker = class BlockedWorker {
        constructor() { throw new Error('CSP_BLOCKED'); }
      };
      const fallback = await api.processImage(file, plan, undefined, { useWorker: true });
      fallbackResult = {
        mime: fallback.file.type,
        width: fallback.metadata.width,
        height: fallback.metadata.height,
        warning: fallback.warnings.map((item) => item.code),
        workerUsed: fallback.workerUsed
      };
    } finally {
      if (descriptor) Object.defineProperty(window, 'Worker', descriptor);
      else window.Worker = OriginalWorker;
    }
    return {
      worker: {
        mime: workerResult.file.type,
        width: workerResult.metadata.width,
        height: workerResult.metadata.height,
        workerUsed: workerResult.workerUsed,
        valid: workerResult.validation.valid
      },
      fallback: fallbackResult
    };
  });

  expect(result.worker).toEqual({
    mime: 'image/jpeg', width: 120, height: 80, workerUsed: true, valid: true
  });
  expect(result.fallback).toEqual({
    mime: 'image/jpeg', width: 120, height: 80,
    warning: ['WORKER_FALLBACK_MAIN_THREAD'], workerUsed: false
  });
});

