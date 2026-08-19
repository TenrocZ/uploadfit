import { expect, test } from '@playwright/test';

const PREVIEW_URL = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">'
    + '<rect width="800" height="600" fill="#bfdbfe"/>'
    + '<circle cx="400" cy="280" r="150" fill="#2563eb"/>'
    + '<text x="400" y="540" text-anchor="middle" fill="#111827" font-size="42">fixture</text>'
    + '</svg>'
)}`;

const CURRENT = { mime: 'image/jpeg', size: 50000, width: 800, height: 600, displayWidth: 800, displayHeight: 600 };

function taskSnapshot(status, task) {
  return {
    sessionState: status === 'STOPPED' ? 'STOPPED' : status === 'SUCCESS' ? 'SUCCESS' : 'NEEDS_CONFIRMATION',
    uploaderCount: 1,
    activeTask: {
      taskId: `evidence-${status.toLowerCase()}`,
      status,
      source: 'preflight',
      errorCode: null,
      current: CURRENT,
      rules: null,
      plan: null,
      result: null,
      retryCount: 0,
      warnings: [],
      ...task
    },
    pageCard: null
  };
}

async function openUi(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate((previewUrl) => {
    const api = globalThis.__uploadfit_debug_bundle__;
    api.cleanupSession();
    const controller = api.createTaskController({ documentRef: document, globalRef: window, ruleProvider: null });
    controller.createTaskPreviewUrl = () => previewUrl;
    globalThis.__s4EvidenceController = controller;
    controller.start();
    globalThis.__s4EvidenceUi = api.createUploadFitUi({
      documentRef: document,
      globalRef: window,
      controller,
      config: { shadowMode: 'open' }
    });
  }, PREVIEW_URL);
}

async function showSnapshot(page, snapshot) {
  await page.evaluate((value) => {
    const controller = globalThis.__s4EvidenceController;
    controller.getSnapshot = () => value;
    globalThis.__s4EvidenceUi.collapse();
    globalThis.__s4EvidenceUi.expand();
  }, snapshot);
  await page.waitForTimeout(100);
}

async function closeUi(page) {
  await page.evaluate(() => {
    globalThis.__s4EvidenceUi?.dispose();
    globalThis.__s4EvidenceController?.dispose();
  });
}

test('S4 rework: capture synthetic UI evidence for confirmations, outcomes and errors', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openUi(page);

  await showSnapshot(page, taskSnapshot('NEEDS_CONFIRMATION', {
    rules: {
      formats: ['image/jpeg'],
      minBytes: 30720,
      maxBytes: 120000,
      width: { exact: 390, min: null, max: null },
      height: { exact: 567, min: null, max: null },
      aspectRatio: null,
      semanticRequirements: ['蓝色背景'],
      confidence: 0.9,
      sources: [{ type: 'nearby-text', priority: 400, confidence: 0.9, evidence: ['（2）电子件要求：JPG格式，30KB—120KB，宽390像素，高567像素'] }],
      conflicts: [],
      actionable: true
    },
    policyConfirmation: { id: 'rule', type: 'RULE_CONFIDENCE', required: true, resolved: false, accepted: null, payload: null },
    plan: { operations: ['RESIZE', 'CROP'] }
  }));
  await page.screenshot({ path: 'docs/evidence/S4/s4-rule-evidence.png' });

  const cropTask = taskSnapshot('NEEDS_CONFIRMATION', {
    current: { mime: 'image/jpeg', size: 50000, width: 800, height: 800, displayWidth: 800, displayHeight: 800 },
    plan: {
      targetWidth: 300,
      targetHeight: 400,
      proposedCrop: { x: 175, y: 100, width: 450, height: 600 },
      operations: ['CROP'],
      confirmations: [{ id: 'crop', type: 'CROP', required: true, resolved: false, accepted: null, suggestedPayload: { x: 175, y: 100, width: 450, height: 600 } }]
    }
  });
  await showSnapshot(page, cropTask);
  await page.screenshot({ path: 'docs/evidence/S4/s4-crop-before.png' });
  await page.evaluate(() => {
    document.querySelector('[data-uploadfit-ui-host]')?.shadowRoot
      .querySelector('[data-uf-action="crop-anchor-底部"]')?.click();
  });
  await page.waitForTimeout(50);
  await page.screenshot({ path: 'docs/evidence/S4/s4-crop-after.png' });

  await showSnapshot(page, taskSnapshot('NEEDS_CONFIRMATION', {
    plan: {
      operations: ['FLATTEN_BACKGROUND'],
      confirmations: [{ id: 'flatten', type: 'FLATTEN_BACKGROUND', required: true, resolved: false, accepted: null, suggestedPayload: { color: 'white' } }]
    }
  }));
  await page.screenshot({ path: 'docs/evidence/S4/s4-flatten-confirmation.png' });

  await showSnapshot(page, taskSnapshot('NEEDS_CONFIRMATION', {
    plan: {
      targetWidth: 390,
      targetHeight: 567,
      operations: ['UPSCALE'],
      confirmations: [{ id: 'upscale', type: 'UPSCALE', required: true, resolved: false, accepted: null, suggestedPayload: { allow: true } }]
    }
  }));
  await page.screenshot({ path: 'docs/evidence/S4/s4-upscale-warning.png' });

  await showSnapshot(page, taskSnapshot('SUCCESS', {
    status: 'SUCCESS',
    result: { metadata: { mime: 'image/jpeg', size: 76000, width: 390, height: 567 }, operations: ['RESIZE', 'CROP'] }
  }));
  await page.screenshot({ path: 'docs/evidence/S4/s4-success-form.png' });

  await showSnapshot(page, taskSnapshot('STOPPED', {
    status: 'STOPPED',
    errorCode: 'PROCESSING_FAILED'
  }));
  await page.screenshot({ path: 'docs/evidence/S4/s4-failure-alert.png' });

  await closeUi(page);
});

test('S4 rework: capture the synthetic CNIPA structure fixture', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openUi(page);
  await page.evaluate(async () => {
    const controller = globalThis.__s4EvidenceController;
    const api = globalThis.__uploadfit_debug_bundle__;
    controller.adapterRegistry = {
      resolve: () => api.cnipaPublicGuideAdapter,
      list: () => [api.cnipaPublicGuideAdapter],
      register: () => false,
      unregister: () => false
    };
    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = '（1）照片尺寸48mm×33mm。登录考试系统。'
      + '（2）电子件要求：JPG格式，文件大小介于30KB—120KB之间，宽：390像素，高：567像素，分辨率300dpi，蓝底。';
    document.body.append(content);
    await controller.prepareManualCard();
    globalThis.__s4EvidenceUi.expand();
  });
  await expect(page.locator('[data-uploadfit-ui-host]')).toHaveCount(1);
  expect(await page.evaluate(() => globalThis.__s4EvidenceController.uploaders.size)).toBe(1);
  await page.screenshot({ path: 'docs/evidence/S4/s4-cnipa-fixture.png' });
  await closeUi(page);
});
