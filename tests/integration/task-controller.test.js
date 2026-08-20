import { expect, test } from '@playwright/test';

async function openController(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
}

async function waitForTask(page, predicate) {
  await expect.poll(
    () => page.evaluate((source) => {
      const snapshot = globalThis.__s3Controller.getSnapshot();
      return Function('snapshot', 'return (' + source + ')(snapshot)')(snapshot);
    }, predicate),
    { timeout: 20_000 }
  ).toBe(true);
}

test('C01/C02/L02: compliant file passes through without reinjection', async ({ page }) => {
  await openController(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const controller = api.createTaskController({ documentRef: document, globalRef: window });
    globalThis.__s3Controller = controller;
    const wrapper = document.createElement('section');
    wrapper.innerHTML = '';
    const label = document.createElement('label');
    label.textContent = 'JPG格式，10KB—600KB，390×567像素';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    label.append(input);
    wrapper.append(label);
    document.body.append(wrapper);
    globalThis.__s3Changes = 0;
    input.addEventListener('change', () => { globalThis.__s3Changes += 1; });
    controller.start();
    const response = await window.fetch('/tests/fixtures/generated/jpeg-390x567-small.jpg');
    const file = new File([await response.arrayBuffer()], 'compliant.jpg', {
      type: 'image/jpeg'
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return { input, file, changes: globalThis.__s3Changes };
  });
  await waitForTask(page, 'snapshot => snapshot.activeTask?.status === "PASSTHROUGH"');
  const snapshot = await page.evaluate(() => globalThis.__s3Controller.getSnapshot());
  expect(result.changes).toBe(0);
  const released = await page.evaluate(() => globalThis.__s3Changes);
  expect(released).toBe(1);
  expect(snapshot.sessionState).toBe('ARMED');
  expect(snapshot.activeTask.status).toBe('PASSTHROUGH');
  expect(snapshot.activeTask.result).toBeNull();
  expect(snapshot.activeTask.retryCount).toBe(0);
  await page.evaluate(() => globalThis.__s3Controller.dispose());
});

test('C03/C07/L01: explicit invalid image is processed, revalidated and injected', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const controller = api.createTaskController({ documentRef: document, globalRef: window });
    globalThis.__s3Controller = controller;
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
    globalThis.__s3Changes = 0;
    input.addEventListener('change', () => { globalThis.__s3Changes += 1; });
    controller.start();
  });
  await page.evaluate(async () => {
    const response = await window.fetch('/tests/fixtures/generated/png-1170x1701.png');
    const file = new File([await response.arrayBuffer()], 'source.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    globalThis.__s3Input.files = transfer.files;
    globalThis.__s3Input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await waitForTask(page, 'snapshot => snapshot.activeTask?.status === "SUCCESS"');
  const result = await page.evaluate(() => {
    const snapshot = globalThis.__s3Controller.getSnapshot();
    const file = globalThis.__s3Input.files[0];
    return {
      snapshot,
      currentFile: { type: file.type, size: file.size },
      changes: globalThis.__s3Changes,
      taskCount: globalThis.__s3Controller.tasks.size
    };
  });
  expect(result.snapshot.activeTask.result.validation.valid).toBe(true);
  expect(result.snapshot.activeTask.result.metadata.mime).toBe('image/jpeg');
  expect(result.currentFile.type).toBe('image/jpeg');
  expect(result.changes).toBe(1);
  expect(result.taskCount).toBe(1);
  await page.evaluate(() => globalThis.__s3Controller.dispose());
});

test('L09: multiple-file selection is left untouched and does not create a task', async ({ page }) => {
  await openController(page);
  const result = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const controller = api.createTaskController({ documentRef: document, globalRef: window });
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/jpeg';
    document.body.append(input);
    controller.start();
    const first = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const second = new File(['b'], 'b.jpg', { type: 'image/jpeg' });
    const transfer = new DataTransfer();
    transfer.items.add(first);
    transfer.items.add(second);
    input.files = transfer.files;
    let changes = 0;
    input.addEventListener('change', () => { changes += 1; });
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    const snapshot = controller.getSnapshot();
    controller.dispose();
    return {
      fileCount: input.files.length,
      changes,
      activeTask: snapshot.activeTask
    };
  });
  expect(result).toEqual({ fileCount: 2, changes: 1, activeTask: null });
});

test('safety stop keeps the network error code instead of claiming an official tool is required', async ({ page }) => {
  await openController(page);
  await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const controller = api.createTaskController({ documentRef: document, globalRef: window });
    globalThis.__s3Controller = controller;
    const label = document.createElement('label');
    label.textContent = '网络超时，请稍后重试，图片最大100KB';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    label.append(input);
    document.body.append(label);
    controller.start();
    const response = await window.fetch('/tests/fixtures/generated/jpeg-390x567-small.jpg');
    const transfer = new DataTransfer();
    transfer.items.add(new File([await response.arrayBuffer()], 'network-test.jpg', {
      type: 'image/jpeg'
    }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await waitForTask(page, 'snapshot => snapshot.activeTask?.status === "STOPPED"');
  const snapshot = await page.evaluate(() => globalThis.__s3Controller.getSnapshot());
  expect(snapshot.activeTask.errorCode).toBe('NETWORK_OR_TIMEOUT');
  await page.evaluate(() => globalThis.__s3Controller.dispose());
});

test('WAITING_REJECTION timeout settles as passthrough instead of remaining active forever', async ({ page }) => {
  await openController(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const discovery = { start() {}, cleanup() {} };
    const controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      discovery,
      observeRejectionFn: (_task, _context, options) => {
        const id = setTimeout(() => options.onTimeout(), 0);
        return () => clearTimeout(id);
      }
    });
    const input = document.createElement('input');
    input.type = 'file';
    document.body.append(input);
    const context = controller.registerUploader({
      input,
      uploaderId: 'timeout-uploader',
      label: '上传图片',
      nearbyTexts: [],
      alertTexts: []
    });
    controller.start();
    const transfer = new DataTransfer();
    transfer.items.add(new File(['a'], 'a.jpg', { type: 'image/jpeg' }));
    input.files = transfer.files;
    await controller.handleFileChange({ type: 'change', target: input }, context);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const snapshot = controller.getSnapshot();
    controller.dispose();
    return {
      taskStatus: snapshot.activeTask?.status,
      sessionState: snapshot.sessionState
    };
  });
  expect(result).toEqual({ taskStatus: 'PASSTHROUGH', sessionState: 'ARMED' });
});

test('repeated selections keep a bounded two-task history with the current task intact', async ({ page }) => {
  await openController(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const discovery = { start() {}, cleanup() {} };
    const controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      discovery,
      observeRejectionFn: () => () => {}
    });
    const input = document.createElement('input');
    input.type = 'file';
    document.body.append(input);
    const context = controller.registerUploader({
      input,
      uploaderId: 'retained-uploader',
      label: '上传图片',
      nearbyTexts: [],
      alertTexts: []
    });
    controller.start();
    for (let index = 0; index < 25; index += 1) {
      const transfer = new DataTransfer();
      transfer.items.add(new File([String(index)], `image-${index}.jpg`, {
        type: 'image/jpeg'
      }));
      input.files = transfer.files;
      await controller.handleFileChange({ type: 'change', target: input }, context);
    }
    const retained = [...controller.tasks.values()];
    const snapshot = controller.getSnapshot();
    controller.dispose();
    return {
      taskCount: retained.length,
      retainedName: retained.at(-1)?.originalFile?.name,
      status: snapshot.activeTask?.status
    };
  });
  expect(result).toEqual({
    taskCount: 2,
    retainedName: 'image-24.jpg',
    status: 'WAITING_REJECTION'
  });
});

test('controller releases a detached uploader and its change listener', async ({ page }) => {
  await openController(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    document.querySelector('#probe-file')?.remove();
    const controller = api.createTaskController({ documentRef: document, globalRef: window });
    const wrapper = document.createElement('section');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png';
    wrapper.append(input);
    document.body.append(wrapper);
    controller.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const before = controller.getSnapshot().uploaderCount;
    const resourcesBefore = controller.resources.size;
    wrapper.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = controller.getSnapshot().uploaderCount;
    const resourcesAfter = controller.resources.size;
    controller.dispose();
    return { before, after, resourcesBefore, resourcesAfter };
  });
  expect(result.before).toBe(1);
  expect(result.after).toBe(0);
  expect(result.resourcesAfter).toBe(result.resourcesBefore);
});

test('C05/C06: crop waits for an explicit confirmation and cancellation does not process', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const controller = api.createTaskController({ documentRef: document, globalRef: window });
    globalThis.__s3Controller = controller;
    const wrapper = document.createElement('section');
    const label = document.createElement('label');
    label.textContent = 'JPG格式，10KB—600KB，390×567像素';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    label.append(input);
    wrapper.append(label);
    document.body.append(wrapper);
    globalThis.__s3Input = input;
    controller.start();
  });
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1000;
    const context = canvas.getContext('2d');
    context.fillStyle = '#4577b8';
    context.fillRect(0, 0, 1000, 1000);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'square.jpg', { type: 'image/jpeg' }));
    globalThis.__s3Input.files = transfer.files;
    globalThis.__s3Input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await waitForTask(page, 'snapshot => snapshot.activeTask?.status === "NEEDS_CONFIRMATION"');
  const before = await page.evaluate(() => globalThis.__s3Controller.getSnapshot());
  expect(before.activeTask.plan.confirmations.some((item) => item.type === 'CROP')).toBe(true);
  const taskId = before.activeTask.taskId;
  await page.evaluate((id) => globalThis.__s3Controller.cancelTask(id), taskId);
  const after = await page.evaluate(() => ({
    snapshot: globalThis.__s3Controller.getSnapshot(),
    fileType: globalThis.__s3Input.files[0].type
  }));
  expect(after.snapshot.activeTask.status).toBe('STOPPED');
  expect(after.snapshot.activeTask.errorCode).toBe('USER_CANCELLED');
  expect(after.fileType).toBe('image/jpeg');
  await page.evaluate(() => globalThis.__s3Controller.dispose());
});

test('D4 confidence routing blocks until a separate RULE_CONFIDENCE decision', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    const label = document.createElement('label');
    label.textContent = '图片规则需要确认';
    label.append(input);
    document.body.append(label);
    globalThis.__s3Input = input;
    globalThis.__s3Changes = 0;
    input.addEventListener('change', () => { globalThis.__s3Changes += 1; });
    const ruleSet = {
      formats: ['image/jpeg'],
      extensions: ['jpg', 'jpeg'],
      minBytes: 10,
      maxBytes: 600000,
      width: { exact: 390, min: null, max: null },
      height: { exact: 567, min: null, max: null },
      aspectRatio: { value: 390 / 567, tolerance: 0.015 },
      dpi: null,
      count: { max: 1 },
      background: null,
      semanticRequirements: [],
      confidence: 0.8,
      sources: [{
        type: 'ai',
        priority: 200,
        evidence: ['尺寸390×567'],
        confidence: 0.8,
        advisoryOnly: false
      }],
      conflicts: [],
      advisories: [],
      safetyFlags: [],
      actionable: true
    };
    globalThis.__s3Controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      parseRulesFn: () => [],
      resolveRulesFn: () => ruleSet
    });
    globalThis.__s3Controller.start();
  });
  await page.evaluate(async () => {
    const response = await window.fetch('/tests/fixtures/generated/jpeg-390x567-small.jpg');
    const transfer = new DataTransfer();
    transfer.items.add(new File([await response.arrayBuffer()], 'original.jpg', {
      type: 'image/jpeg'
    }));
    globalThis.__s3Input.files = transfer.files;
    globalThis.__s3Input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await expect.poll(
    () => page.evaluate(() => globalThis.__s3Controller.getSnapshot().activeTask?.status),
    { timeout: 20_000 }
  ).toBe('NEEDS_CONFIRMATION');
  const pending = await page.evaluate(() => {
    const task = globalThis.__s3Controller.getSnapshot().activeTask;
    return {
      taskId: task.taskId,
      confirmation: task.policyConfirmation
        ?? task.plan.confirmations.find((item) => item.type === 'RULE_CONFIDENCE'),
      changes: globalThis.__s3Changes
    };
  });
  expect(pending.confirmation.resolved).toBe(false);
  expect(pending.changes).toBe(0);
  const result = await page.evaluate(({ taskId, confirmation }) => (
    globalThis.__s3Controller.confirmTask(taskId, {
      id: confirmation.id,
      type: 'RULE_CONFIDENCE',
      accepted: false,
      payload: null
    })
  ), pending);
  expect(result).toMatchObject({ ok: true, status: 'STOPPED' });
  await page.evaluate(() => globalThis.__s3Controller.dispose());
});

test('C08: invalid process output stops before injection', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    const label = document.createElement('label');
    label.textContent = 'JPG格式，10KB—120KB，390×567像素';
    label.append(input);
    document.body.append(label);
    globalThis.__s3Input = input;
    globalThis.__s3InjectCalls = 0;
    globalThis.__s3Controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      processImageFn: async (file) => ({
        file,
        metadata: { mime: file.type, size: file.size, width: 390, height: 567 },
        operations: ['CONVERT'],
        validation: { valid: false, violations: [{ code: 'OUTPUT_VALIDATION_FAILED' }] },
        durationMs: 1,
        warnings: []
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
    { timeout: 20_000 }
  ).toBe('STOPPED');
  const result = await page.evaluate(() => ({
    errorCode: globalThis.__s3Controller.getSnapshot().activeTask.errorCode,
    injectCalls: globalThis.__s3InjectCalls,
    currentType: globalThis.__s3Input.files[0].type
  }));
  expect(result).toEqual({
    errorCode: 'OUTPUT_VALIDATION_FAILED',
    injectCalls: 0,
    currentType: 'image/png'
  });
  await page.evaluate(() => globalThis.__s3Controller.dispose());
});

test('L08: a rapid second selection cancels the stale task before it can inject', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    const label = document.createElement('label');
    label.textContent = 'JPG格式，10KB—120KB，390×567像素';
    label.append(input);
    document.body.append(label);
    globalThis.__s3Input = input;
    globalThis.__s3Resolvers = [];
    globalThis.__s3Controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      processImageFn: (file) => new Promise((resolve) => {
        globalThis.__s3Resolvers.push(() => resolve({
          file: new File(['processed:' + file.name], 'processed-' + file.name, {
            type: 'image/jpeg'
          }),
          metadata: { mime: 'image/jpeg', size: 20, width: 390, height: 567 },
          operations: ['CONVERT'],
          validation: { valid: true, violations: [] },
          durationMs: 1,
          warnings: []
        }));
      })
    });
    globalThis.__s3Controller.start();
  });
  await page.evaluate(async () => {
    const response = await window.fetch('/tests/fixtures/generated/png-1170x1701.png');
    const bytes = await response.arrayBuffer();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'first.png', { type: 'image/png' }));
    globalThis.__s3Input.files = transfer.files;
    globalThis.__s3Input.dispatchEvent(new Event('change', {
      bubbles: true,
      composed: true
    }));
  });
  await expect.poll(
    () => page.evaluate(() => globalThis.__s3Controller.getSnapshot().activeTask?.status),
    { timeout: 10_000 }
  ).toBe('PROCESSING');
  await page.evaluate(async () => {
    const response = await window.fetch('/tests/fixtures/generated/png-1170x1701.png');
    const transfer = new DataTransfer();
    transfer.items.add(new File([await response.arrayBuffer()], 'second.png', {
      type: 'image/png'
    }));
    globalThis.__s3Input.files = transfer.files;
    globalThis.__s3Input.dispatchEvent(new Event('change', {
      bubbles: true,
      composed: true
    }));
  });
  await page.evaluate(() => globalThis.__s3Resolvers[0]());
  await expect.poll(
    () => page.evaluate(() => globalThis.__s3Resolvers.length),
    { timeout: 10_000 }
  ).toBe(2);
  await page.evaluate(() => globalThis.__s3Resolvers[1]());
  await expect.poll(
    () => page.evaluate(() => globalThis.__s3Controller.getSnapshot().activeTask?.status),
    { timeout: 10_000 }
  ).toBe('SUCCESS');
  const result = await page.evaluate(() => ({
    tasks: [...globalThis.__s3Controller.tasks.values()].map((task) => ({
      status: task.status,
      errorCode: task.errorCode ?? null,
      originalName: task.originalFile.name
    })),
    currentName: globalThis.__s3Input.files[0].name
  }));
  expect(result.tasks).toEqual([
    { status: 'STOPPED', errorCode: 'USER_CANCELLED', originalName: 'first.png' },
    { status: 'SUCCESS', errorCode: null, originalName: 'second.png' }
  ]);
  expect(result.currentName).toBe('processed-second.png');
  await page.evaluate(() => globalThis.__s3Controller.dispose());
});

test('L10: DataTransfer failure stops without claiming a successful upload', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    const label = document.createElement('label');
    label.textContent = 'JPG格式，10KB—120KB，390×567像素';
    label.append(input);
    document.body.append(label);
    globalThis.__s3Input = input;
    globalThis.__s3InjectCalls = 0;
    globalThis.__s3Controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      processImageFn: async (file) => ({
        file: new File(['processed'], 'processed.jpg', { type: 'image/jpeg' }),
        metadata: { mime: 'image/jpeg', size: 9, width: 390, height: 567 },
        operations: ['CONVERT'],
        validation: { valid: true, violations: [] },
        durationMs: 1,
        warnings: []
      }),
      injectFileFn: () => {
        globalThis.__s3InjectCalls += 1;
        return {
          ok: false,
          inputFilesVerified: false,
          eventsDispatched: [],
          fallback: 'download',
          errorCode: 'DATATRANSFER_UNAVAILABLE'
        };
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
    { timeout: 20_000 }
  ).toBe('STOPPED');
  const result = await page.evaluate(() => {
    const task = [...globalThis.__s3Controller.tasks.values()][0];
    return {
      errorCode: task.errorCode,
      fallback: task.injection?.fallback,
      taskStatus: task.status,
      injectCalls: globalThis.__s3InjectCalls
    };
  });
  expect(result).toEqual({
    errorCode: 'DATATRANSFER_UNAVAILABLE',
    fallback: 'download',
    taskStatus: 'STOPPED',
    injectCalls: 2
  });
  await page.evaluate(() => globalThis.__s3Controller.dispose());
});

test('L11: restoreTask puts back the original file without a business click', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    const label = document.createElement('label');
    label.textContent = 'JPG格式，10KB—120KB，390×567像素';
    label.append(input);
    document.body.append(label);
    globalThis.__s3Input = input;
    globalThis.__s3Clicks = 0;
    document.addEventListener('click', () => { globalThis.__s3Clicks += 1; });
    globalThis.__s3Controller = api.createTaskController({ documentRef: document, globalRef: window });
    globalThis.__s3Controller.start();
  });
  await page.evaluate(async () => {
    const response = await window.fetch('/tests/fixtures/generated/png-1170x1701.png');
    const transfer = new DataTransfer();
    transfer.items.add(new File([await response.arrayBuffer()], 'original.png', {
      type: 'image/png'
    }));
    globalThis.__s3Input.files = transfer.files;
    globalThis.__s3Input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await expect.poll(
    () => page.evaluate(() => globalThis.__s3Controller.getSnapshot().activeTask?.status),
    { timeout: 20_000 }
  ).toBe('SUCCESS');
  const taskId = await page.evaluate(() => (
    globalThis.__s3Controller.getSnapshot().activeTask.taskId
  ));
  const result = await page.evaluate((id) => {
    const restored = globalThis.__s3Controller.restoreTask(id);
    return {
      restored,
      file: {
        name: globalThis.__s3Input.files[0].name,
        type: globalThis.__s3Input.files[0].type
      },
      clicks: globalThis.__s3Clicks,
      status: globalThis.__s3Controller.getSnapshot().activeTask.status
    };
  }, taskId);
  expect(result.restored.ok).toBe(true);
  expect(result.file).toEqual({ name: 'original.png', type: 'image/png' });
  expect(result.clicks).toBe(0);
  expect(result.status).toBe('STOPPED');
  await page.evaluate(() => globalThis.__s3Controller.dispose());
});
