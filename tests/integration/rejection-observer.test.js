import { expect, test } from '@playwright/test';

test('L05: ambiguous upload failure stops safely without processing or retry', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });
  await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    api.cleanupSession();
    const error = document.createElement('div');
    error.className = 'error';
    const label = document.createElement('label');
    label.textContent = '上传图片';
    const input = document.createElement('input');
    input.type = 'file';
    label.append(input);
    const wrapper = document.createElement('section');
    wrapper.append(label, error);
    document.body.append(wrapper);
    globalThis.__s3Error = error;
    globalThis.__s3Input = input;
    globalThis.__s3ProcessCalls = 0;
    globalThis.__s3Controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      processImageFn: () => {
        globalThis.__s3ProcessCalls += 1;
        throw new Error('PROCESS_SHOULD_NOT_RUN');
      }
    });
    globalThis.__s3Controller.start();
  });
  await page.evaluate(() => {
    const file = new File(['unknown'], 'unknown.jpg', { type: 'image/jpeg' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    globalThis.__s3Input.files = transfer.files;
    globalThis.__s3Input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await expect.poll(
    () => page.evaluate(() => globalThis.__s3Controller.getSnapshot().activeTask?.status),
    { timeout: 10_000 }
  ).toBe('WAITING_REJECTION');
  await page.evaluate(() => {
    globalThis.__s3Error.textContent = '上传失败';
  });
  await expect.poll(
    () => page.evaluate(() => globalThis.__s3Controller.getSnapshot().activeTask?.status),
    { timeout: 10_000 }
  ).toBe('STOPPED');
  const result = await page.evaluate(() => {
    const task = globalThis.__s3Controller.getSnapshot().activeTask;
    return {
      errorCode: task.errorCode,
      retryCount: task.retryCount,
      processCalls: globalThis.__s3ProcessCalls
    };
  });
  expect(result).toEqual({
    errorCode: 'PROCESSING_FAILED',
    retryCount: 0,
    processCalls: 0
  });
  await page.evaluate(() => globalThis.__s3Controller.dispose());
});

test('C10/C11: detached input and dispose abort stale processing before injection', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });
  await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    api.cleanupSession();
    const wrapper = document.createElement('section');
    const label = document.createElement('label');
    label.textContent = 'JPG格式，10KB—120KB，390×567像素';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    label.append(input);
    wrapper.append(label);
    document.body.append(wrapper);
    globalThis.__s3Input = input;
    globalThis.__s3Resolve = null;
    globalThis.__s3Controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      processImageFn: () => new Promise((resolve) => {
        globalThis.__s3Resolve = resolve;
      })
    });
    globalThis.__s3Controller.start();
  });
  await page.evaluate(async () => {
    const response = await window.fetch('/tests/fixtures/generated/png-1170x1701.png');
    const file = new File([await response.arrayBuffer()], 'source.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    globalThis.__s3Input.files = transfer.files;
    globalThis.__s3Input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await expect.poll(
    () => page.evaluate(() => globalThis.__s3Controller.getSnapshot().activeTask?.status),
    { timeout: 10_000 }
  ).toBe('PROCESSING');
  await page.evaluate(() => {
    globalThis.__s3Input.remove();
    globalThis.__s3Resolve({
      file: new File(['processed'], 'processed.jpg', { type: 'image/jpeg' }),
      metadata: { mime: 'image/jpeg', size: 9, width: 390, height: 567 },
      operations: ['CONVERT'],
      validation: { valid: true, violations: [] },
      durationMs: 1,
      warnings: []
    });
  });
  await expect.poll(
    () => page.evaluate(() => globalThis.__s3Controller.getSnapshot().activeTask?.status),
    { timeout: 10_000 }
  ).toBe('STOPPED');
  const detached = await page.evaluate(() => {
    const task = globalThis.__s3Controller.getSnapshot().activeTask;
    return { errorCode: task.errorCode, filePresent: Boolean(globalThis.__s3Input.isConnected) };
  });
  expect(detached).toEqual({ errorCode: 'INPUT_DETACHED', filePresent: false });
  await page.evaluate(() => globalThis.__s3Controller.dispose());
});

test('C11/L12: session dispose or pagehide prevents a pending result from touching the page', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });
  await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    api.cleanupSession();
    const label = document.createElement('label');
    label.textContent = 'JPG格式，10KB—120KB，390×567像素';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    label.append(input);
    document.body.append(label);
    globalThis.__s3Input = input;
    globalThis.__s3Resolve = null;
    globalThis.__s3InjectCalls = 0;
    globalThis.__s3Controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      processImageFn: () => new Promise((resolve) => {
        globalThis.__s3Resolve = resolve;
      }),
      injectFileFn: () => {
        globalThis.__s3InjectCalls += 1;
        return { ok: true, inputFilesVerified: true, eventsDispatched: [] };
      }
    });
    globalThis.__s3Controller.start();
  });
  await page.evaluate(async () => {
    const response = await window.fetch('/tests/fixtures/generated/png-1170x1701.png');
    const transfer = new DataTransfer();
    transfer.items.add(new File([await response.arrayBuffer()], 'source.png', {
      type: 'image/png'
    }));
    globalThis.__s3Input.files = transfer.files;
    globalThis.__s3Input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await expect.poll(
    () => page.evaluate(() => globalThis.__s3Controller.getSnapshot().activeTask?.status),
    { timeout: 10_000 }
  ).toBe('PROCESSING');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    globalThis.__s3Resolve({
      file: new File(['processed'], 'processed.jpg', { type: 'image/jpeg' }),
      metadata: { mime: 'image/jpeg', size: 9, width: 390, height: 567 },
      operations: ['CONVERT'],
      validation: { valid: true, violations: [] },
      durationMs: 1,
      warnings: []
    });
  });
  await page.waitForTimeout(50);
  const result = await page.evaluate(() => ({
    sessionState: globalThis.__s3Controller.getSnapshot().sessionState,
    taskStatus: globalThis.__s3Controller.getSnapshot().activeTask.status,
    injectCalls: globalThis.__s3InjectCalls,
    fileType: globalThis.__s3Input.files[0].type
  }));
  expect(result).toEqual({
    sessionState: 'DISPOSED',
    taskStatus: 'DISPOSED',
    injectCalls: 0,
    fileType: 'image/png'
  });
});
