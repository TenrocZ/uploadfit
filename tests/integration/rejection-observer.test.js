import { expect, test } from '@playwright/test';

test('S4.1 VocaText size rejection preserves accept formats and becomes actionable', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  const result = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const previousCandidates = api.parseRulesDeterministically({
      attributes: { accept: '.mp3,.m4a,.wav,audio/*' },
      nearbyTexts: [],
      alertTexts: []
    });
    const previous = api.resolveRules(previousCandidates);
    const rejection = api.classifyRejectionText('File exceeds 25 MB limit.');
    const next = api.resolveRules([...previousCandidates, ...rejection.candidates]);
    return {
      rejectionKind: rejection.kind,
      maxBytes: next.maxBytes,
      formats: next.formats,
      extensions: next.extensions,
      mediaKind: next.mediaKind,
      actionable: next.actionable,
      conflicts: next.conflicts,
      stricter: api.isStrictlyMoreSpecificAudioRejection(previous, next)
    };
  });

  expect(result.rejectionKind).toBe('explicit');
  expect(result.maxBytes).toBe(25_000_000);
  expect(result.mediaKind).toBe('audio');
  expect(result.formats).toEqual(expect.arrayContaining(['audio/mpeg', 'audio/mp4', 'audio/wav']));
  expect(result.extensions).toEqual(expect.arrayContaining(['.mp3', '.m4a', '.wav']));
  expect(result.actionable).toBe(true);
  expect(result.conflicts).not.toContainEqual(expect.objectContaining({ field: 'formats' }));
  expect(result.conflicts).not.toContainEqual(expect.objectContaining({ field: 'extensions' }));
  expect(result.stricter).toBe(true);
});

test('S4.1 R03 captures a pre-existing hidden toast after text and visibility change', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mpeg';
    const toast = document.createElement('div');
    toast.id = 'toast';
    toast.hidden = true;
    document.body.append(input, toast);
    const task = { taskId: 'toast-task', inputElement: input };
    const detections = [];
    const stop = api.observeRejection(task, { input }, {
      debounceMs: 0,
      windowMs: 2_000,
      getActiveTasks: () => [task],
      onRejection: (detail) => detections.push({
        kind: detail.kind,
        text: detail.text,
        taskId: detail.task?.taskId ?? null,
        related: detail.related,
        errorCode: detail.errorCode
      })
    });
    toast.textContent = 'File exceeds 25 MB limit.';
    toast.hidden = false;
    toast.className = 'toast show';
    const deadline = Date.now() + 1_000;
    while (!detections.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const active = stop.active();
    stop();
    input.remove();
    toast.remove();
    return { detections, active };
  });

  expect(result.detections).toEqual([{
    kind: 'explicit',
    text: 'File exceeds 25 MB limit.',
    taskId: 'toast-task',
    related: true,
    errorCode: null
  }]);
  expect(result.active).toBe(false);
});

test('S4.1 R05 reports ambiguity for a global toast with two active uploaders', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const first = document.createElement('input');
    const second = document.createElement('input');
    first.type = second.type = 'file';
    first.accept = second.accept = 'audio/mpeg';
    document.body.append(first, second);
    const firstTask = { taskId: 'first-toast-task', inputElement: first };
    const secondTask = { taskId: 'second-toast-task', inputElement: second };
    const detections = [];
    const stop = api.observeRejection(firstTask, { input: first }, {
      debounceMs: 0,
      windowMs: 2_000,
      getActiveTasks: () => [firstTask, secondTask],
      onRejection: (detail) => detections.push({
        taskId: detail.task?.taskId ?? null,
        related: detail.related,
        errorCode: detail.errorCode
      })
    });
    const toast = document.createElement('div');
    toast.className = 'snackbar notification';
    toast.textContent = 'File exceeds 25 MB limit.';
    document.body.append(toast);
    const deadline = Date.now() + 1_000;
    while (!detections.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    stop();
    first.remove();
    second.remove();
    toast.remove();
    return detections;
  });

  expect(result).toEqual([{
    taskId: null,
    related: false,
    errorCode: 'AMBIGUOUS_REJECTION_ASSOCIATION'
  }]);
});

test('S4.1 R07 timeout and pagehide disconnect observers and suppress later mutations', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const input = document.createElement('input');
    input.type = 'file';
    document.body.append(input);
    const task = { taskId: 'cleanup-task', inputElement: input };
    let timeoutCalls = 0;
    let rejectionCalls = 0;
    const timeoutStop = api.observeRejection(task, { input }, {
      debounceMs: 0,
      windowMs: 20,
      getActiveTasks: () => [task],
      onTimeout: () => { timeoutCalls += 1; },
      onRejection: () => { rejectionCalls += 1; }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const timeoutActive = timeoutStop.active();
    const pagehideStop = api.observeRejection(task, { input }, {
      debounceMs: 0,
      windowMs: 2_000,
      getActiveTasks: () => [task],
      onRejection: () => { rejectionCalls += 1; }
    });
    window.dispatchEvent(new Event('pagehide'));
    const pagehideActive = pagehideStop.active();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = 'File exceeds 25 MB limit.';
    document.body.append(toast);
    await new Promise((resolve) => setTimeout(resolve, 30));
    timeoutStop();
    pagehideStop();
    input.remove();
    toast.remove();
    return { timeoutCalls, rejectionCalls, timeoutActive, pagehideActive };
  });

  expect(result).toEqual({
    timeoutCalls: 1,
    rejectionCalls: 0,
    timeoutActive: false,
    pagehideActive: false
  });
});

test('L05: ambiguous upload failure stops safely without processing or retry', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
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

test('same-text error nodes keep distinct identity during uploader association', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    document.querySelector('#probe-file')?.remove();
    const makeUploader = () => {
      const section = document.createElement('section');
      const input = document.createElement('input');
      input.type = 'file';
      const error = document.createElement('div');
      error.className = 'error';
      section.append(input, error);
      document.body.append(section);
      return { input, error };
    };
    const first = makeUploader();
    const second = makeUploader();
    const firstTask = { taskId: 'first', inputElement: first.input };
    const secondTask = { taskId: 'second', inputElement: second.input };
    const detections = [];
    const stop = api.observeRejection(firstTask, { input: first.input }, {
      debounceMs: 0,
      windowMs: 2_000,
      getActiveTasks: () => [firstTask, secondTask],
      onRejection: (detail) => detections.push({
        taskId: detail.task?.taskId ?? null,
        related: detail.related,
        text: detail.text
      })
    });
    second.error.textContent = '图片尺寸必须为390×567像素';
    await new Promise((resolve) => setTimeout(resolve, 10));
    const afterOtherUploader = detections.length;
    first.error.textContent = '图片尺寸必须为390×567像素';
    await new Promise((resolve) => setTimeout(resolve, 10));
    stop();
    return { afterOtherUploader, detections };
  });

  expect(result.afterOtherUploader).toBe(0);
  expect(result.detections).toEqual([{
    taskId: 'first',
    related: true,
    text: '图片尺寸必须为390×567像素'
  }]);
});

test('C10/C11: detached input and dispose abort stale processing before injection', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
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
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
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
