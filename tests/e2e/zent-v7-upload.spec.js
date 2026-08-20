import { expect, test } from '@playwright/test';

const LIVE_SITE = 'https://youzan.github.io/zent-v7/zh/component/upload';

test(`Zent v7 fixture copied from ${LIVE_SITE} does not treat 网络图片 as a network failure`, async ({ page }) => {
  await page.goto('/test-pages/zent-v7-upload-fixture.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });

  const result = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const input = document.querySelector('#zent-local-image');
    const context = api.extractRelevantContext(input);
    const rules = api.resolveRules(api.parseRulesDeterministically(context));
    return {
      accept: context.attributes.accept,
      formats: rules.formats,
      maxBytes: rules.maxBytes,
      safetyFlags: rules.safetyFlags,
      actionable: rules.actionable
    };
  });

  expect(result).toEqual({
    accept: 'image/gif, image/jpeg, image/png, image/bmp',
    formats: ['image/jpeg', 'image/png'],
    maxBytes: 1_000_000,
    safetyFlags: [],
    actionable: true
  });
});
