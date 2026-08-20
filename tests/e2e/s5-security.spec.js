import { expect, test } from '@playwright/test';
import path from 'node:path';

const fixture = (name) => path.join(process.cwd(), 'tests', 'fixtures', 'generated', name);

async function openDebugUi(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    api.cleanupSession();
    const controller = api.createTaskController({ documentRef: document, globalRef: window, ruleProvider: null });
    controller.start();
    const ui = api.createUploadFitUi({
      documentRef: document,
      globalRef: window,
      controller,
      config: { shadowMode: 'open' }
    });
    globalThis.__s5Security = { controller, ui };
  });
}

test('S5 G3: malicious rule evidence remains plain text', async ({ page }) => {
  await openDebugUi(page);
  await page.evaluate(() => {
    const controller = globalThis.__s5Security.controller;
    const task = {
      taskId: 's5-security-evidence',
      status: 'NEEDS_CONFIRMATION',
      source: 'preflight',
      current: { mime: 'image/jpeg', size: 50_000, width: 800, height: 600 },
      rules: {
        formats: ['image/jpeg'],
        minBytes: 30_720,
        maxBytes: 120_000,
        width: { exact: 390, min: null, max: null },
        height: { exact: 567, min: null, max: null },
        aspectRatio: null,
        semanticRequirements: [],
        confidence: 0.9,
        sources: [{
          type: 'nearby-text',
          priority: 400,
          confidence: 0.9,
          evidence: ['<img src=x onerror=window.__s5Xss=1>', '</style><script>window.__s5Xss=2</script>']
        }],
        conflicts: [],
        actionable: true
      },
      policyConfirmation: { id: 'rule', type: 'RULE_CONFIDENCE', required: true, resolved: false, accepted: null, payload: null },
      plan: { operations: ['RESIZE'] },
      retryCount: 0,
      warnings: []
    };
    controller.getSnapshot = () => ({
      sessionState: 'NEEDS_CONFIRMATION',
      uploaderCount: 1,
      activeTask: task,
      pageCard: null
    });
    globalThis.__s5Security.ui.expand();
  });

  const host = page.locator('[data-uploadfit-ui-host]');
  await expect(host).toContainText('<img src=x onerror=window.__s5Xss=1>');
  await expect(host).toContainText('</style><script>window.__s5Xss=2</script>');
  expect(await page.evaluate(() => ({
    xss: globalThis.__s5Xss ?? null,
    executable: document.querySelector('[data-uploadfit-ui-host]')?.shadowRoot?.querySelectorAll('img,script').length ?? 0
  }))).toEqual({ xss: null, executable: 0 });
});

test('S5 G3: ordinary local processing emits no external network request', async ({ page }) => {
  const externalRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:8765/')
      && !url.startsWith('blob:http://127.0.0.1:8765/')) externalRequests.push(url);
  });
  await page.goto('/test-pages/index.html?scenario=A');
  await expect.poll(() => page.evaluate(() => (
    globalThis.__uploadfit_session__?.controller?.getSnapshot?.().uploaderCount ?? 0
  ))).toBe(1);
  await page.locator('#scenario-file').setInputFiles(fixture('png-1170x1701.png'));
  await expect.poll(() => page.evaluate(() => (
    ['SUCCESS', 'PASSTHROUGH'].includes(globalThis.__uploadfit_session__?.controller?.getSnapshot?.().activeTask?.status)
  ))).toBe(true);
  expect(externalRequests).toEqual([]);
});

test('S5 G3: sensitive AI text is blocked before bridge invocation', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const bridge = { calls: 0, async chat() { this.calls += 1; return '{}'; } };
    const provider = api.createTabbitAiProvider({ globalRef: window, bridge });
    const response = await provider.extractRules({
      text: '照片要求：JPG；password:secret-token；验证码:123456',
      locale: 'zh-CN',
      pageType: 's5-security'
    });
    return { response, calls: bridge.calls };
  });
  expect(result).toEqual({
    response: { ok: false, blocked: 'AI_SENSITIVE_INPUT', pattern: 'CREDENTIAL_ASSIGNMENT' },
    calls: 0
  });
});

test('S5 X12: dispose removes host and ignores later DOM mutation', async ({ page }) => {
  await page.goto('/test-pages/index.html?scenario=A');
  await expect.poll(() => page.evaluate(() => (
    globalThis.__uploadfit_session__?.controller?.getSnapshot?.().uploaderCount ?? 0
  ))).toBe(1);
  await page.evaluate(() => {
    globalThis.__uploadfit_session__?.cleanup?.();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.dataset.afterDispose = 'true';
    document.body.append(input);
  });
  await page.waitForTimeout(250);
  expect(await page.locator('[data-uploadfit-ui-host]').count()).toBe(0);
  expect(await page.evaluate(() => Boolean(globalThis.__uploadfit_session__))).toBe(false);
});
