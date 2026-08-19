import { expect, test } from '@playwright/test';

async function openApi(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
}

const CNIPA_TEXT = '（2）电子件要求：JPG格式，文件大小介于30KB—120KB之间，分辨率300dpi，宽：390像素，高：567像素。不得拉伸。';

function baseRules(overrides = {}) {
  return {
    formats: ['image/jpeg'],
    extensions: ['jpg', 'jpeg'],
    minBytes: 30720,
    maxBytes: 120000,
    width: { exact: 390, min: null, max: null },
    height: { exact: 567, min: null, max: null },
    aspectRatio: null,
    dpi: null,
    count: { max: 1 },
    background: null,
    semanticRequirements: [],
    confidence: 0.95,
    sources: [{ type: 'nearby-text', priority: 400, evidence: [CNIPA_TEXT], confidence: 0.95 }],
    conflicts: [],
    advisories: [],
    safetyFlags: [],
    actionable: true,
    ...overrides
  };
}

test('A10: provider unavailable degrades to local rules and the base flow continues', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    // 无 LLMBridge 的环境 → provider 返回 AI_UNAVAILABLE
    const controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      ruleProvider: { extractRules: async () => ({ ok: false, errorCode: 'AI_UNAVAILABLE', reason: 'LLMBRIDGE_MISSING' }) }
    });
    globalThis.__s4Controller = controller;
    controller.start();
    // 规则不完整（仅格式，无尺寸/大小）→ 允许调用 AI → AI_UNAVAILABLE 降级
    const label = document.createElement('label');
    label.textContent = '请上传JPG格式的证件照';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    label.append(input);
    document.body.append(label);
    for (let i = 0; i < 50 && !controller.uploaders.get(input); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 900;
    canvas.getContext('2d').fillRect(0, 0, 800, 900);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const file = new File([blob], 'fallback.jpg', { type: 'image/jpeg' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const snapshot = controller.getSnapshot();
    return {
      aiDiagnostics: controller.diagnostics.filter((item) => String(item.code).startsWith('AI')).length,
      taskStatus: snapshot.activeTask?.status,
      rulesWidth: snapshot.activeTask?.rules?.width?.exact,
      sessionState: snapshot.sessionState
    };
  });
  // AI 不可用被诊断记录；本地规则驱动基础流程（等待网页反馈，而非死锁）。
  expect(result.aiDiagnostics).toBeGreaterThan(0);
  expect(result.taskStatus).toBeTruthy();
  expect(['NEEDS_CONFIRMATION', 'PROCESSING', 'SUCCESS', 'STOPPED', 'WAITING_REJECTION', 'PASSTHROUGH']).toContain(result.taskStatus);
  await page.evaluate(() => globalThis.__s4Controller?.dispose());
});

test('A02/A13: invalid AI output falls back silently and processing continues locally', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      ruleProvider: { extractRules: async () => ({ ok: false, errorCode: 'AI_INVALID_OUTPUT', errors: ['NOT_JSON'] }) }
    });
    globalThis.__s4Controller = controller;
    controller.start();
    const label = document.createElement('label');
    label.textContent = '请上传JPG格式的证件照';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    label.append(input);
    document.body.append(label);
    for (let i = 0; i < 50 && !controller.uploaders.get(input); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 900;
    canvas.getContext('2d').fillRect(0, 0, 800, 900);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const file = new File([blob], 'invalid-ai.jpg', { type: 'image/jpeg' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const snapshot = controller.getSnapshot();
    return {
      invalidDiag: controller.diagnostics.filter((item) => item.code === 'AI_INVALID_OUTPUT').length,
      taskStatus: snapshot.activeTask?.status,
      taskPresent: Boolean(snapshot.activeTask)
    };
  });
  expect(result.invalidDiag).toBeGreaterThan(0);
  expect(result.taskPresent).toBe(true);
  await page.evaluate(() => globalThis.__s4Controller.dispose());
});

test('A08: high-priority local rules are never overridden by AI candidates', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    // adapter 优先级 700 的候选给出 maxBytes=100000
    const adapterCandidate = {
      sourceType: 'adapter',
      sourcePriority: 700,
      evidence: ['最大100KB'],
      confidence: 0.98,
      rules: {
        formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'],
        minBytes: null, maxBytes: 100000,
        width: { exact: 390, min: null, max: null },
        height: { exact: 567, min: null, max: null },
        aspectRatio: null, dpi: null, count: { max: 1 }, background: null,
        semanticRequirements: []
      },
      advisoryOnly: false,
      safetyFlags: []
    };
    // AI 候选（优先级 200）试图给出 maxBytes=999999
    const aiCandidate = {
      sourceType: 'ai',
      sourcePriority: 200,
      evidence: ['最大999999KB'],
      confidence: 0.99,
      rules: {
        formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'],
        minBytes: null, maxBytes: 999999,
        width: { exact: 390, min: null, max: null },
        height: { exact: 567, min: null, max: null },
        aspectRatio: null, dpi: null, count: { max: 1 }, background: null,
        semanticRequirements: []
      },
      advisoryOnly: false,
      safetyFlags: []
    };
    const rules = api.resolveRules([adapterCandidate, aiCandidate]);
    return {
      maxBytes: rules.maxBytes,
      conflicts: rules.conflicts.length,
      conflictFields: rules.conflicts.map((conflict) => conflict.field)
    };
  });
  // AI 的 999999 不得静默覆盖 adapter 的 100000：冲突被显式记录，字段不可解时不执行。
  expect(result.maxBytes).not.toBe(999999);
  expect(result.conflicts).toBeGreaterThan(0);
  expect(result.maxBytes === null || result.maxBytes === 100000).toBe(true);
});

test('S4-D8: real public guide page renders the preparation card with rules', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    // 模拟国知局公开说明页 DOM：.content 容器 + 照片要求文本（含全角冒号写法）
    const container = document.createElement('div');
    container.className = 'content';
    const heading = document.createElement('h2');
    heading.textContent = '国家知识产权局关于2026年度专利代理师资格考试的公告';
    const paragraph = document.createElement('p');
    paragraph.textContent = '本人近三个月彩色蓝底正面免冠证件照片的电子件。'
      + '（1）照片尺寸48mm×33mm；（2）电子件要求：JPG格式，文件大小介于30KB—120KB之间，分辨率300dpi，宽：390像素，高：567像素。'
      + '并不得使用拉伸严重的照片。';
    container.append(heading, paragraph);
    document.body.append(container);
    // 全角冒号与完整文章噪声由本地确定性解析处理；此验收不伪造 Tabbit 响应。
    const controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      ruleProvider: null
    });
    globalThis.__s4Controller = controller;
    controller.start();
    controller.adapterRegistry = {
      resolve: () => api.cnipaPublicGuideAdapter,
      list: () => [api.cnipaPublicGuideAdapter],
      register: () => false,
      unregister: () => false
    };
    const pageCard = await controller.prepareManualCard();
    return {
      state: pageCard?.state,
      rules: pageCard?.rules ? {
        formats: pageCard.rules.formats,
        minBytes: pageCard.rules.minBytes,
        maxBytes: pageCard.rules.maxBytes,
        width: pageCard.rules.width?.exact,
        height: pageCard.rules.height?.exact,
        dpi: pageCard.rules.dpi,
        semantic: pageCard.rules.semanticRequirements,
        sources: pageCard.rules.sources.map((source) => source.type)
      } : null
    };
  });
  expect(result.state).toBe('ready');
  expect(result.rules.formats).toContain('image/jpeg');
  expect(result.rules.minBytes).toBe(30720);
  expect(result.rules.maxBytes).toBe(120000);
  expect(result.rules.width).toBe(390);
  expect(result.rules.height).toBe(567);
  expect(result.rules.dpi).toBe(300);
  // 规则完整时走本地候选，不能用 mock AI 掩盖页面解析问题。
  expect(result.rules.sources).toContain('nearby-text');
  await page.evaluate(() => {
    globalThis.__s4Controller?.dispose();
    document.querySelector('.content')?.remove();
  });
});

test('S4-D8: manual card produces a download-only result without any input refill claim', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      processImageFn: (file, plan, progress, options) => api.processImage(file, plan, progress, { ...(options ?? {}), useWorker: false }),
      ruleProvider: {
        extractRules: async () => ({
          ok: true,
          candidate: {
            sourceType: 'ai',
            sourcePriority: 200,
            evidence: ['宽：390像素，高：567像素'],
            confidence: 0.97,
            rules: {
              formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'],
              minBytes: null, maxBytes: null,
              width: { exact: 390, min: null, max: null },
              height: { exact: 567, min: null, max: null },
              aspectRatio: null, dpi: null, count: { max: 1 }, background: null,
              semanticRequirements: []
            },
            advisoryOnly: false,
            safetyFlags: []
          }
        })
      }
    });
    globalThis.__s4Controller = controller;
    controller.start();
    controller.adapterRegistry = {
      resolve: () => api.cnipaPublicGuideAdapter,
      list: () => [api.cnipaPublicGuideAdapter],
      register: () => false,
      unregister: () => false
    };
    const container = document.createElement('div');
    container.className = 'content';
    container.textContent = '电子件要求：JPG格式，文件大小介于30KB—120KB之间，宽：390像素，高：567像素。';
    document.body.append(container);
    await controller.prepareManualCard();
    container.remove();
    // 横图 800×600 → 390×567 需要 CROP 确认：全链路走 UI 语义
    // 用噪声图保证编码后有足够字节满足 30KB 下限（纯色图会被压到 2KB 无法达标）。
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const context = canvas.getContext('2d');
    const noise = context.createImageData(800, 600);
    let seed = 123456789;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let index = 0; index < noise.data.length; index += 4) {
      noise.data[index] = 60 + Math.floor(random() * 180);
      noise.data[index + 1] = 80 + Math.floor(random() * 160);
      noise.data[index + 2] = 100 + Math.floor(random() * 140);
      noise.data[index + 3] = 255;
    }
    context.putImageData(noise, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    const file = new File([blob], 'manual.jpg', { type: 'image/jpeg' });
    const created = await controller.createManualTask(file);
    let snapshot = controller.getSnapshot();
    let attempts = 0;
    while (snapshot.activeTask?.status !== 'NEEDS_CONFIRMATION' && attempts < 40) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      snapshot = controller.getSnapshot();
      attempts += 1;
    }
    // 逐个确认（RULE_CONFIDENCE 策略确认 + CROP 有损确认按需出现）
    let confirmedCount = 0;
    for (let round = 0; round < 4; round += 1) {
      snapshot = controller.getSnapshot();
      if (snapshot.activeTask?.status !== 'NEEDS_CONFIRMATION') break;
      const task = snapshot.activeTask;
      const policy = task.policyConfirmation;
      const planPending = task.plan?.confirmations?.find((item) => item.required && !item.resolved);
      const target = policy && !policy.resolved
        ? { id: policy.id, type: policy.type, payload: { allow: true } }
        : planPending
          ? {
            id: planPending.id,
            type: planPending.type,
            payload: planPending.type === 'CROP'
              ? {
                x: planPending.suggestedPayload.x / (task.current.displayWidth ?? task.current.width),
                y: planPending.suggestedPayload.y / (task.current.displayHeight ?? task.current.height),
                width: planPending.suggestedPayload.width / (task.current.displayWidth ?? task.current.width),
                height: planPending.suggestedPayload.height / (task.current.displayHeight ?? task.current.height)
              }
              : planPending.suggestedPayload
          }
          : null;
      if (!target) break;
      const confirmResult = await controller.confirmTask(task.taskId, {
        id: target.id,
        type: target.type,
        accepted: true,
        payload: target.payload
      });
      if (!confirmResult.ok) break;
      confirmedCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    let final = controller.getSnapshot();
    let finalAttempts = 0;
    while (!['SUCCESS', 'STOPPED'].includes(final.activeTask?.status) && finalAttempts < 60) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      final = controller.getSnapshot();
      finalAttempts += 1;
    }
    const output = final.activeTask?.status === 'SUCCESS'
      ? controller.getTaskOutput(final.activeTask.taskId)
      : null;
    return {
      created: created.ok,
      confirmedCount,
      finalStatus: final.activeTask?.status,
      errorCode: final.activeTask?.errorCode,
      hasOutput: Boolean(output?.file),
      outputWidth: output?.metadata?.width,
      outputHeight: output?.metadata?.height,
      outputSizeOk: output ? output.file.size > 30720 && output.file.size < 120000 : null,
      warnings: final.activeTask?.warnings?.map((w) => w.code),
      sessionState: final.sessionState
    };
  });
  expect(result.created).toBe(true);
  expect(result.confirmedCount).toBeGreaterThan(0);
  expect(result.finalStatus).toBe('SUCCESS');
  expect(result.hasOutput).toBe(true);
  expect(result.outputWidth).toBe(390);
  expect(result.outputHeight).toBe(567);
  expect(result.outputSizeOk).toBe(true);
  expect(result.warnings).toContain('MANUAL_CARD_DOWNLOAD_ONLY');
  await page.evaluate(() => globalThis.__s4Controller?.dispose());
});

test('A11-shape: prepareManualCard consults the provider only when local rules are incomplete', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const calls = [];
    const provider = {
      extractRules: async ({ text }) => {
        calls.push(text.slice(0, 30));
        return {
          ok: true,
          candidate: {
            sourceType: 'ai',
            sourcePriority: 200,
            evidence: ['JPG格式'],
            confidence: 0.9,
            rules: {
              formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'],
              minBytes: null, maxBytes: null,
              width: { exact: 390, min: null, max: null },
              height: { exact: 567, min: null, max: null },
              aspectRatio: null, dpi: null, count: { max: 1 }, background: null,
              semanticRequirements: [], confidence: 0.9
            },
            advisoryOnly: false,
            safetyFlags: []
          }
        };
      }
    };
    const controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      ruleProvider: provider
    });
    controller.start();
    controller.adapterRegistry = {
      resolve: () => api.cnipaPublicGuideAdapter,
      list: () => [api.cnipaPublicGuideAdapter],
      register: () => false,
      unregister: () => false
    };
    // 场景1：完整明确规则（本地可解析格式+尺寸+大小）→ 不调用 AI
    const container = document.createElement('div');
    container.className = 'content';
    container.textContent = '电子件要求：JPG格式，文件大小介于30KB—120KB之间，390×567像素。';
    document.body.append(container);
    await controller.prepareManualCard();
    const callsAfterComplete = calls.length;
    container.remove();
    // 场景2：模糊文本（本地解析不出完整规则）→ 调用 AI
    const weak = document.createElement('div');
    weak.className = 'content';
    weak.textContent = '（2）电子件要求：格式为JPG。';
    document.body.append(weak);
    const controller2 = api.createTaskController({
      documentRef: document,
      globalRef: window,
      ruleProvider: provider
    });
    controller2.start();
    controller2.adapterRegistry = {
      resolve: () => api.cnipaPublicGuideAdapter,
      list: () => [api.cnipaPublicGuideAdapter],
      register: () => false,
      unregister: () => false
    };
    await controller2.prepareManualCard({ selectedText: weak.textContent });
    weak.remove();
    return { callsAfterComplete, callsAfterWeak: calls.length };
  });
  // 完整规则：0 次调用；模糊文本：触发 AI 补充（调用数增加）。
  expect(result.callsAfterComplete).toBe(0);
  expect(result.callsAfterWeak).toBeGreaterThan(result.callsAfterComplete);
});
