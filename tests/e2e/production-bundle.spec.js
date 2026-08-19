import { expect, test } from '@playwright/test';

test('production bundle stays a single auto-bootstrapping IIFE', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });
  const state = await page.evaluate(() => ({
    bundleExports: typeof globalThis.__uploadfit_bundle__?.bootstrap === 'function',
    buildMode: globalThis.__uploadfit_build_info__?.mode,
    activeSession: globalThis.__uploadfit_session__?.active === true,
    hostCount: document.querySelectorAll('[data-uploadfit-ui-host]').length
  }));
  expect(state.bundleExports).toBe(true);
  expect(state.buildMode).toBe('production');
  expect(state.activeSession).toBe(true);
  expect(state.hostCount).toBe(1);
  await page.evaluate(() => globalThis.__uploadfit_bundle__.cleanupSession());
});
