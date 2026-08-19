import { expect, test } from '@playwright/test';

test('S3 cleanup registry releases each resource once', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  const result = await page.evaluate(() => {
    const registry = globalThis.__uploadfit_debug_bundle__.createCleanupRegistry();
    const events = [];
    const target = {
      addEventListener: (type) => events.push('add:' + type),
      removeEventListener: (type) => events.push('remove:' + type)
    };
    const observer = { disconnect: () => events.push('observer') };
    const worker = { terminate: () => events.push('worker') };
    const urlApi = { revokeObjectURL: (url) => events.push('url:' + url) };
    registry.trackListener(target, 'change', () => {});
    registry.trackObserver(observer);
    registry.trackWorker(worker);
    registry.trackObjectUrl('blob:one', urlApi);
    const first = registry.cleanup();
    const second = registry.cleanup();
    return { first, second, events };
  });

  expect(result).toEqual({
    first: true,
    second: false,
    events: [
      'add:change',
      'remove:change',
      'observer',
      'worker',
      'url:blob:one'
    ]
  });
});
