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
  await page.evaluate(() => globalThis.__uploadfit_session__?.cleanup?.());
});

test('production bundle sees Tabbit lexical LLMBridge without a window property', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  const result = await page.evaluate(async () => {
    const source = await fetch('/dist/uploadfit.js').then((response) => response.text());
    const output = {
      formats: ['jpg'],
      minSize: { value: 30, unit: 'KB' },
      maxSize: { value: 120, unit: 'KB' },
      width: { exact: 390, min: null, max: null },
      height: { exact: 567, min: null, max: null },
      aspectRatio: null,
      semanticRequirements: ['不得拉伸'],
      evidence: ['JPG格式', '30KB到120KB', '宽390像素', '高567像素'],
      confidence: 0.97
    };
    const bridge = {
      calls: 0,
      async chat() {
        this.calls += 1;
        return output;
      }
    };
    // Mirrors Tabbit's pasted-script executor: LLMBridge is a lexical argument,
    // not a property on window/globalThis.
    Function('LLMBridge', source)(bridge);
    const provider = globalThis.__uploadfit_session__.controller.ruleProvider;
    const response = await provider.extractRules({
      text: '电子件要求：JPG格式，文件大小介于30KB到120KB之间，宽390像素，高567像素。不得拉伸。',
      locale: 'zh-CN',
      pageType: 'tabbit-runtime-contract'
    });
    return {
      hasBridgeTrigger: source.includes('LLMBridge.'),
      hasWindowBridge: Object.hasOwn(globalThis, 'LLMBridge'),
      calls: bridge.calls,
      ok: response.ok,
      minBytes: response.candidate?.rules?.minBytes,
      width: response.candidate?.rules?.width?.exact
    };
  });

  expect(result).toEqual({
    hasBridgeTrigger: true,
    hasWindowBridge: false,
    calls: 1,
    ok: true,
    minBytes: 30720,
    width: 390
  });
  await page.evaluate(() => globalThis.__uploadfit_session__?.cleanup?.());
});
