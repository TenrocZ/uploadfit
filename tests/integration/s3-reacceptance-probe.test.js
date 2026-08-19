import { expect, test } from '@playwright/test';

async function load(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });
  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
}

test('Q-S3-009: first image selection upgrades a bare file input into S3', async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const input = document.createElement('input');
    input.type = 'file';
    document.body.append(input);
    globalThis.__probeInput = input;
    globalThis.__probeController = api.createTaskController({ documentRef: document, globalRef: window });
    globalThis.__probeController.start();
  });
  await page.evaluate(async () => {
    const response = await fetch('/tests/fixtures/generated/png-1170x1701.png');
    const transfer = new DataTransfer();
    transfer.items.add(new File([await response.arrayBuffer()], 'source.png', { type: 'image/png' }));
    globalThis.__probeInput.files = transfer.files;
    globalThis.__probeInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await expect.poll(() => page.evaluate(() => (
    [...globalThis.__probeController.tasks.values()]
      .some((task) => task.inputElement === globalThis.__probeInput)
  ))).toBe(true);
  const actual = await page.evaluate(() => {
    const task = [...globalThis.__probeController.tasks.values()]
      .find((candidate) => candidate.inputElement === globalThis.__probeInput);
    return {
      uploaderRegistered: globalThis.__probeController.uploaders.has(globalThis.__probeInput),
      taskStatus: task?.status ?? null,
      originalType: task?.originalFile?.type ?? null
    };
  });
  expect(actual).toEqual({
    uploaderRegistered: true,
    taskStatus: 'WAITING_REJECTION',
    originalType: 'image/png'
  });
  await page.evaluate(() => globalThis.__probeController.dispose());
});

test('Q-S3-010: accepted medium-confidence rules use the real S2 pipeline', async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    document.body.append(input);
    const rules = {
      formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'], minBytes: 1, maxBytes: 600000,
      width: { exact: 390, min: null, max: null }, height: { exact: 567, min: null, max: null },
      aspectRatio: { value: 390 / 567, tolerance: 0.015 }, dpi: null, count: { max: 1 },
      background: null, semanticRequirements: [], confidence: 0.8,
      sources: [{ type: 'ai', priority: 200, evidence: ['synthetic'], confidence: 0.8, advisoryOnly: false }],
      conflicts: [], advisories: [], safetyFlags: [], actionable: true
    };
    globalThis.__probeInput = input;
    globalThis.__probeController = api.createTaskController({
      documentRef: document,
      globalRef: window,
      parseRulesFn: () => [],
      resolveRulesFn: () => rules
    });
    globalThis.__probeController.start();
  });
  await page.evaluate(async () => {
    const response = await fetch('/tests/fixtures/generated/png-1170x1701.png');
    const transfer = new DataTransfer();
    transfer.items.add(new File([await response.arrayBuffer()], 'source.png', { type: 'image/png' }));
    globalThis.__probeInput.files = transfer.files;
    globalThis.__probeInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await expect.poll(() => page.evaluate(() => globalThis.__probeController.getSnapshot().activeTask?.status)).toBe('NEEDS_CONFIRMATION');
  const pending = await page.evaluate(() => {
    const task = globalThis.__probeController.getSnapshot().activeTask;
    return { taskId: task.taskId, confirmation: task.policyConfirmation };
  });
  await page.evaluate(({ taskId, confirmation }) => globalThis.__probeController.confirmTask(taskId, {
    id: confirmation.id,
    type: 'RULE_CONFIDENCE',
    accepted: true,
    payload: { allow: true }
  }), pending);
  await expect.poll(
    () => page.evaluate(() => globalThis.__probeController.getSnapshot().activeTask?.status),
    { timeout: 30_000 }
  ).toBe('SUCCESS');
  const actual = await page.evaluate(() => {
    const task = globalThis.__probeController.getSnapshot().activeTask;
    const file = globalThis.__probeInput.files[0];
    return { status: task.status, valid: task.result.validation.valid, type: file.type };
  });
  expect(actual).toEqual({ status: 'SUCCESS', valid: true, type: 'image/jpeg' });
  await page.evaluate(() => globalThis.__probeController.dispose());
});
