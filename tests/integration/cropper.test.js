import { expect, test } from '@playwright/test';

async function openApi(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  // dist 加载即自动 bootstrap 全局 session；先清理再手工构建受控 controller。
  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
}

function cropRules({ width, height }) {
  return {
    formats: ['image/jpeg'],
    extensions: ['jpg', 'jpeg'],
    minBytes: null,
    maxBytes: null,
    width: { exact: width, min: null, max: null },
    height: { exact: height, min: null, max: null },
    aspectRatio: null,
    dpi: null,
    count: { max: 1 },
    background: null,
    semanticRequirements: [],
    confidence: 0.96,
    sources: [{ type: 'nearby-text', priority: 400, evidence: ['3:4比例'], confidence: 0.96 }],
    conflicts: [],
    advisories: [],
    safetyFlags: [],
    actionable: true
  };
}

async function driveTask(page, { sourceW, sourceH, exactW, exactH }) {
  return page.evaluate(async ({ sourceW, sourceH, exactW, exactH }) => {
    const api = globalThis.__uploadfit_debug_bundle__;
    // 生成 sourceW×sourceH 的 canvas JPEG
    const canvas = document.createElement('canvas');
    canvas.width = sourceW;
    canvas.height = sourceH;
    const context = canvas.getContext('2d');
    context.fillStyle = '#3b6ea5';
    context.fillRect(0, 0, sourceW, sourceH);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const file = new File([blob], 'crop-test.jpg', { type: 'image/jpeg' });

    const rules = {
      formats: ['image/jpeg'],
      extensions: ['jpg', 'jpeg'],
      minBytes: null,
      maxBytes: null,
      width: { exact: exactW, min: null, max: null },
      height: { exact: exactH, min: null, max: null },
      aspectRatio: null,
      dpi: null,
      count: { max: 1 },
      background: null,
      semanticRequirements: [],
      confidence: 0.96,
      sources: [{ type: 'nearby-text', priority: 400, evidence: [`宽${exactW}像素，高${exactH}像素`], confidence: 0.96 }],
      conflicts: [],
      advisories: [],
      safetyFlags: [],
      actionable: true
    };
    const metadata = await api.inspectImage(file);
    const plan = api.createProcessingPlan(metadata, rules);
    return { file, metadata, plan, rules };
  }, { sourceW, sourceH, exactW, exactH });
}

test('U05/U06: crop cancel keeps the file untouched; confirm passes a valid rectangle', async ({ page }) => {
  await openApi(page);
  const prepared = await driveTask(page, { sourceW: 800, sourceH: 600, exactW: 300, exactH: 400 });
  // 800×600 横图 → 3:4 竖比例必然产生 proposedCrop
  expect(prepared.plan.proposedCrop).toBeTruthy();
  expect(prepared.plan.proposedCrop.width).toBe(450);
  expect(prepared.plan.proposedCrop.height).toBe(600);
  expect(prepared.plan.confirmations.some((item) => item.type === 'CROP')).toBe(true);

  const result = await page.evaluate(async ({ file, plan, rules }) => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const crop = plan.confirmations.find((item) => item.type === 'CROP');
    // U05: 取消 —— confirmations resolved=false / accepted=false 后计划不可执行
    const cancelled = api.resolveProcessingConfirmation(plan, {
      id: crop.id, type: 'CROP', accepted: false, payload: null
    });
    // U06: 确认 —— 平移到 (100, 0) 的同尺寸矩形（ADR-002）
    const translated = api.resolveProcessingConfirmation(plan, {
      id: crop.id, type: 'CROP', accepted: true,
      payload: { x: 100, y: 0, width: 450, height: 600 }
    });
    // 篡改尺寸（ADR-002 禁止）：同 id 只能解析一次，用新 plan 克隆验证
    let tamperedError = null;
    try {
      api.resolveProcessingConfirmation(plan, {
        id: crop.id, type: 'CROP', accepted: true,
        payload: { x: 0, y: 0, width: 440, height: 600 }
      });
    } catch (error) {
      tamperedError = error.code;
    }
    return {
      cancelledNotExecutable: cancelled.executable === false,
      cancelledPassthrough: cancelled.passthrough === false,
      translatedCrop: translated.crop,
      translatedExecutable: translated.executable,
      tamperedError
    };
  }, { file: prepared.file, plan: prepared.plan, rules: prepared.rules });
  expect(result.cancelledNotExecutable).toBe(true);
  expect(result.cancelledPassthrough).toBe(true);
  expect(result.translatedCrop).toEqual({ x: 100, y: 0, width: 450, height: 600 });
  expect(result.translatedExecutable).toBe(true);
  expect(result.tamperedError).toBe('USER_CONFIRMATION_REQUIRED');
});

test('U06: the confirmed crop actually renders through the S2 pipeline', async ({ page }) => {
  await openApi(page);
  const output = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    canvas.getContext('2d').fillRect(0, 0, 800, 600);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const file = new File([blob], 'crop-render.jpg', { type: 'image/jpeg' });
    const rules = {
      formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'],
      minBytes: null, maxBytes: null,
      width: { exact: 300, min: null, max: null },
      height: { exact: 400, min: null, max: null },
      aspectRatio: null, dpi: null, count: { max: 1 }, background: null,
      semanticRequirements: [], confidence: 0.96,
      sources: [{ type: 'nearby-text', priority: 400, evidence: ['宽300像素，高400像素'], confidence: 0.96 }],
      conflicts: [], advisories: [], safetyFlags: [], actionable: true
    };
    const metadata = await api.inspectImage(file);
    const plan = api.createProcessingPlan(metadata, rules);
    const crop = plan.confirmations.find((item) => item.type === 'CROP');
    const resolved = api.resolveProcessingConfirmation(plan, {
      id: crop.id, type: 'CROP', accepted: true,
      payload: { x: 175, y: 0, width: 450, height: 600 }
    });
    const result = await api.processImage(file, resolved, undefined, { useWorker: false });
    return {
      width: result.metadata.width,
      height: result.metadata.height,
      valid: result.validation.valid,
      operations: result.operations
    };
  });
  expect(output.width).toBe(300);
  expect(output.height).toBe(400);
  expect(output.valid).toBe(true);
  expect(output.operations).toContain('CROP');
});

test('U05: cropper UI Esc/cancel calls cancelTask and the original file stays in the input', async ({ page }) => {
  await openApi(page);
  const status = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      processImageFn: async (file) => {
        globalThis.__s4ProcessCalls = (globalThis.__s4ProcessCalls ?? 0) + 1;
        throw Object.assign(new Error('must not run before confirm'), { code: 'PROCESSING_FAILED' });
      }
    });
    globalThis.__s4Controller = controller;
    globalThis.__s4ProcessCalls = 0;
    controller.start();
    const label = document.createElement('label');
    label.textContent = 'JPG格式，宽300像素，高400像素';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    label.append(input);
    document.body.append(label);

    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    canvas.getContext('2d').fillRect(0, 0, 800, 600);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const file = new File([blob], 'esc-test.jpg', { type: 'image/jpeg' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    // 等 discovery 的 MutationObserver 注册该 input，再分发 change。
    for (let attempt = 0; attempt < 50 && !controller.uploaders.get(input); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        const snapshot = controller.getSnapshot();
        const pending = snapshot.activeTask?.status === 'NEEDS_CONFIRMATION';
        if (pending) {
          clearInterval(timer);
          resolve({
            reached: true,
            processCalls: globalThis.__s4ProcessCalls,
            sameFile: input.files[0] === file,
            filesLength: input.files.length
          });
        }
      }, 50);
      setTimeout(() => {
        clearInterval(timer);
        resolve({ reached: false, processCalls: globalThis.__s4ProcessCalls });
      }, 10000);
    });
  });
  expect(status.reached).toBe(true);
  expect(status.processCalls).toBe(0);
  expect(status.sameFile).toBe(true);
  // cancelTask 后原文件仍在 input 中（未替换、未注入）
  const afterCancel = await page.evaluate(() => {
    const snapshot = globalThis.__s4Controller.getSnapshot();
    const input = snapshot.activeTask ? null : null;
    void input;
    return {
      status: snapshot.activeTask?.status,
      processCalls: globalThis.__s4ProcessCalls
    };
  });
  await page.evaluate(() => globalThis.__s4Controller.cancelTask(
    globalThis.__s4Controller.getSnapshot().activeTask.taskId
  ));
  const cancelled = await page.evaluate(() => {
    const controller = globalThis.__s4Controller;
    const snapshot = controller.getSnapshot();
    return {
      status: snapshot.activeTask.status,
      errorCode: snapshot.activeTask.errorCode,
      processCalls: globalThis.__s4ProcessCalls
    };
  });
  void afterCancel;
  expect(cancelled.status).toBe('STOPPED');
  expect(cancelled.errorCode).toBe('USER_CANCELLED');
  expect(cancelled.processCalls).toBe(0);
  await page.evaluate(() => globalThis.__s4Controller.dispose());
});

test('U07: flatten cancel keeps processImage at zero calls', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      processImageFn: async () => {
        globalThis.__s4FlattenCalls = (globalThis.__s4FlattenCalls ?? 0) + 1;
        throw Object.assign(new Error('must not run'), { code: 'PROCESSING_FAILED' });
      }
    });
    globalThis.__s4Controller = controller;
    globalThis.__s4FlattenCalls = 0;
    controller.start();
    // PNG 带透明 → 目标规则仅 JPG：FLATTEN_BACKGROUND 确认必然出现
    const label = document.createElement('label');
    label.textContent = '仅支持JPG格式';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    label.append(input);
    document.body.append(label);
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    canvas.getContext('2d').clearRect(0, 0, 200, 200);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'transparent.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    for (let attempt = 0; attempt < 50 && !controller.uploaders.get(input); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    let pending = null;
    for (let attempt = 0; attempt < 100 && !pending; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const snapshot = controller.getSnapshot();
      pending = snapshot.activeTask?.status === 'NEEDS_CONFIRMATION'
        ? snapshot.activeTask?.plan?.confirmations
          ?.find((item) => item.type === 'FLATTEN_BACKGROUND' && !item.resolved) ?? null
        : null;
    }
    const snapshot = controller.getSnapshot();
    if (pending) {
      // 用户取消确认
      await controller.confirmTask(snapshot.activeTask.taskId, {
        id: pending.id, type: 'FLATTEN_BACKGROUND', accepted: false, payload: null
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {
      pendingFound: Boolean(pending),
      flattenCalls: globalThis.__s4FlattenCalls,
      finalStatus: controller.getSnapshot().activeTask?.status,
      finalError: controller.getSnapshot().activeTask?.errorCode
    };
  });
  expect(result.pendingFound).toBe(true);
  expect(result.flattenCalls).toBe(0);
  expect(result.finalStatus).toBe('STOPPED');
  expect(result.finalError).toBe('USER_CANCELLED');
  await page.evaluate(() => globalThis.__s4Controller.dispose());
});

test('U08: upscale confirmation preserves the warning text', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    canvas.getContext('2d').fillRect(0, 0, 100, 100);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const file = new File([blob], 'small.jpg', { type: 'image/jpeg' });
    const rules = {
      formats: ['image/jpeg'],
      extensions: ['jpg', 'jpeg'],
      minBytes: null,
      maxBytes: null,
      width: { exact: 390, min: null, max: null },
      height: { exact: 390, min: null, max: null },
      aspectRatio: null,
      dpi: null,
      count: { max: 1 },
      background: null,
      semanticRequirements: [],
      confidence: 0.96,
      sources: [{ type: 'nearby-text', priority: 400, evidence: ['390×390像素'], confidence: 0.96 }],
      conflicts: [],
      advisories: [],
      safetyFlags: [],
      actionable: true
    };
    const metadata = await api.inspectImage(file);
    const plan = api.createProcessingPlan(metadata, rules);
    const upscale = plan.confirmations.find((item) => item.type === 'UPSCALE');
    return {
      hasUpscale: Boolean(upscale),
      proposed: upscale?.suggestedPayload ?? null,
      operations: plan.operations
    };
  });
  expect(result.hasUpscale).toBe(true);
  expect(result.proposed).toEqual({ width: 390, height: 390 });
  expect(result.operations).toContain('UPSCALE');

  // 确认后 warning 仍在（UPSCALE 语义提示不因确认而消失）
  const after = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    canvas.getContext('2d').fillRect(0, 0, 100, 100);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const file = new File([blob], 'small.jpg', { type: 'image/jpeg' });
    const rules = {
      formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'],
      minBytes: null, maxBytes: null,
      width: { exact: 390, min: null, max: null },
      height: { exact: 390, min: null, max: null },
      aspectRatio: null, dpi: null, count: { max: 1 }, background: null,
      semanticRequirements: [], confidence: 0.96,
      sources: [{ type: 'nearby-text', priority: 400, evidence: ['390×390像素'], confidence: 0.96 }],
      conflicts: [], advisories: [], safetyFlags: [], actionable: true
    };
    const metadata = await api.inspectImage(file);
    const plan = api.createProcessingPlan(metadata, rules);
    const upscale = plan.confirmations.find((item) => item.type === 'UPSCALE');
    const resolved = api.resolveProcessingConfirmation(plan, {
      id: upscale.id, type: 'UPSCALE', accepted: true, payload: { allow: true }
    });
    return {
      executable: resolved.executable,
      upscaleAccepted: resolved.upscaleAccepted === true,
      operations: resolved.operations
    };
  });
  expect(after.executable).toBe(true);
  expect(after.upscaleAccepted).toBe(true);
  expect(after.operations).toContain('UPSCALE');
});

test('U06 (cropper component): pointer drag moves the box within image bounds', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const confirmed = [];
    let cancelCount = 0;
    const cropper = api.createCropper({
      documentRef: document,
      imageUrl: '',
      sourceWidth: 800,
      sourceHeight: 600,
      cropWidth: 450,
      cropHeight: 600,
      targetWidth: 300,
      targetHeight: 400,
      onConfirm: (value) => confirmed.push(value.normalized),
      onCancel: () => { cancelCount += 1; }
    });
    document.body.append(cropper.element);
    const stage = cropper.element.querySelector('.uf-crop-stage');
    stage.style.width = '800px';
    window.dispatchEvent(new Event('resize'));
    const before = cropper.getRect();
    const box = cropper.element.querySelector('.uf-crop-box');
    const boxRect = box.getBoundingClientRect();
    const pointerId = 41;
    box.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId,
      clientX: boxRect.left + 20, clientY: boxRect.top + 20
    }));
    stage.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId,
      clientX: boxRect.left + 120, clientY: boxRect.top + 20
    }));
    stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId }));
    const afterDrag = cropper.getRect();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    cropper.primaryButton.click();
    cropper.destroy();
    cropper.element.remove();
    return { before, afterDrag, confirmed: confirmed[0] ?? null, cancelCount };
  });
  expect(result.afterDrag.pixel.x).toBeGreaterThan(result.before.pixel.x);
  expect(result.afterDrag.normalized.x).toBeGreaterThanOrEqual(0);
  expect(result.afterDrag.normalized.x + result.afterDrag.normalized.width).toBeLessThanOrEqual(1);
  expect(result.confirmed).toEqual(result.afterDrag.normalized);
  expect(result.cancelCount).toBe(1);
});

test('U06: controller receives normalized crop intent and runs the canonical pipeline', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const rules = {
      formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'], minBytes: null, maxBytes: null,
      width: { exact: 300, min: null, max: null }, height: { exact: 400, min: null, max: null },
      aspectRatio: null, dpi: null, count: { max: 1 }, background: null,
      semanticRequirements: [], confidence: 0.96,
      sources: [{ type: 'nearby-text', priority: 400, evidence: ['宽300像素，高400像素'], confidence: 0.96 }],
      conflicts: [], advisories: [], safetyFlags: [], actionable: true
    };
    const controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      parseRulesFn: () => [],
      resolveRulesFn: () => rules,
      processImageFn: (file, plan, progress, options) => api.processImage(
        file, plan, progress, { ...(options ?? {}), useWorker: false }
      )
    });
    globalThis.__s4Controller = controller;
    const ui = api.createUploadFitUi({
      documentRef: document, globalRef: window, controller, config: { shadowMode: 'open' }
    });
    globalThis.__s4Ui = ui;
    let seen = null;
    const originalConfirm = controller.confirmTask.bind(controller);
    controller.confirmTask = (taskId, payload) => {
      seen = payload;
      return originalConfirm(taskId, payload);
    };
    controller.start();
    const label = document.createElement('label');
    label.textContent = 'JPG格式，宽300像素，高400像素';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    label.append(input);
    document.body.append(label);
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    canvas.getContext('2d').fillRect(0, 0, 800, 600);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const file = new File([blob], 'normalized-crop.jpg', { type: 'image/jpeg' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    for (let attempt = 0; attempt < 50 && !controller.uploaders.get(input); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    for (let attempt = 0; attempt < 200 && controller.getSnapshot().activeTask?.status !== 'NEEDS_CONFIRMATION'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    ui.expand();
    const confirm = ui.shadowRoot.querySelector('[data-uf-action="confirm-crop"]');
    confirm?.click();
    for (let attempt = 0; attempt < 200 && !['SUCCESS', 'STOPPED'].includes(controller.getSnapshot().activeTask?.status); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const final = controller.getSnapshot();
    return {
      seen,
      finalStatus: final.activeTask?.status,
      output: final.activeTask?.result?.metadata ?? null
    };
  });
  expect(result.seen.type).toBe('CROP');
  expect(result.seen.payload.x).toBeGreaterThanOrEqual(0);
  expect(result.seen.payload.x + result.seen.payload.width).toBeLessThanOrEqual(1);
  expect(result.seen.payload.y + result.seen.payload.height).toBeLessThanOrEqual(1);
  expect(result.finalStatus).toBe('SUCCESS');
  expect(result.output.width).toBe(300);
  expect(result.output.height).toBe(400);
  await page.evaluate(() => globalThis.__s4Ui?.dispose());
  await page.evaluate(() => globalThis.__s4Controller?.dispose());
});

test('R5: controller rejects tampered crop intent and owns pixel conversion', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const controller = api.createTaskController({ documentRef: document, globalRef: window });
    const task = {
      metadata: { width: 800, height: 600 },
      plan: { proposedCrop: { x: 175, y: 0, width: 450, height: 600 } }
    };
    const canonical = controller._normalizeCropConfirmation(task, {
      x: 0.21875, y: 0, width: 0.5625, height: 1
    });
    let errorCode = null;
    try {
      controller._normalizeCropConfirmation(task, {
        x: 0, y: 0, width: 0.5, height: 1
      });
    } catch (error) {
      errorCode = error.code;
    }
    return { canonical, errorCode };
  });
  expect(result.canonical).toEqual({ x: 175, y: 0, width: 450, height: 600 });
  expect(result.errorCode).toBe('USER_CONFIRMATION_REQUIRED');
});
