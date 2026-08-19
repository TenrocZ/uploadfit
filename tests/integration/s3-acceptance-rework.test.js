import { expect, test } from '@playwright/test';

async function openController(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => {
    globalThis.__uploadfit_debug_bundle__.cleanupSession();
    const baseRules = (confidence = 0.95) => ({
      formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'], minBytes: 1, maxBytes: 600000,
      width: { exact: null, min: null, max: null }, height: { exact: null, min: null, max: null },
      aspectRatio: null, dpi: null, count: { max: 1 }, background: null, semanticRequirements: [],
      confidence, sources: [{ type: confidence < 0.9 ? 'ai' : 'nearby-text',
        priority: confidence < 0.9 ? 200 : 400, evidence: ['synthetic S3 rule'], confidence,
        advisoryOnly: false }],
      conflicts: [], advisories: [], safetyFlags: [], actionable: true
    });
    const metadataFor = (file, fields = {}) => ({
      mime: file.type, signatureMime: file.type, declaredMime: file.type,
      declaredExtension: file.type === 'image/png' ? 'png' : 'jpg',
      signatureValid: true, mimeConsistent: true, extensionConsistent: true,
      decodable: true, errorCode: null, orientation: 1, hasAlpha: false, size: file.size,
      width: fields.width ?? 390, height: fields.height ?? 567
    });
    const replaceFiles = (input, file) => {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    };
    globalThis.__s3Harness = {
      baseRules, metadataFor, replaceFiles,
      install(mode) {
        const api = globalThis.__uploadfit_debug_bundle__;
        const timeline = [];
        const stats = { process: 0, inject: 0, restore: 0, started: [], active: 0, maxActive: 0, resolvers: [] };
        const input = document.createElement('input');
        input.type = 'file';
        const second = document.createElement('input');
        second.type = 'file';
        input.accept = 'image/*';
        second.accept = 'image/*';
        const inputs = mode === 'queue' || mode === 'queue-fail' ? [input, second] : [input];
        document.body.append(...inputs);
        let rules = baseRules(mode.startsWith('rule-') ? 0.8 : 0.95);
        if (mode === 'async-crop' || mode === 'async-compliant') {
          rules.width.exact = 390; rules.height.exact = 567;
          rules.aspectRatio = { value: 390 / 567, tolerance: 0.015 };
        }
        if (mode === 'async-resize') { rules.width.max = 600; rules.height.max = 1200; }
        if (mode === 'rule-process') rules.maxBytes = 1;
        if (mode === 'rule-passthrough') {
          rules.width.exact = 390; rules.height.exact = 567;
          rules.aspectRatio = { value: 390 / 567, tolerance: 0.015 };
        }
        if (mode === 'rule-crop') {
          rules.width.exact = 390; rules.height.exact = 567;
          rules.aspectRatio = { value: 390 / 567, tolerance: 0.015 };
        }
        const controller = api.createTaskController({
          documentRef: document, globalRef: window, parseRulesFn: () => [], resolveRulesFn: () => rules,
          inspectImageFn: async (file) => {
            timeline.push({ kind: 'inspect-start', at: performance.now() });
            if (mode === 'async-crop' || mode === 'async-compliant') {
              await Promise.resolve();
            }
            let fields = {};
            if (mode === 'async-crop' || mode === 'async-resize' || mode === 'rule-crop') {
              fields = { width: 1000, height: 1000 };
            }
            const metadata = metadataFor(file, fields);
            timeline.push({ kind: 'metadata', at: performance.now() });
            return metadata;
          },
          processImageFn: (file, plan) => {
            stats.process += 1;
            if (mode === 'async-compliant') throw new Error('unexpected process');
            if (mode === 'rule-process' || mode === 'rule-crop') {
              if (plan.confirmations.some((item) => item.type === 'RULE_CONFIDENCE')) {
                throw Object.assign(new Error('policy confirmation leaked into S2 plan'), { code: 'USER_CONFIRMATION_REQUIRED' });
              }
            }
            if (mode === 'queue' || mode === 'queue-fail') {
              stats.started.push(file.name); stats.active += 1; stats.maxActive = Math.max(stats.maxActive, stats.active);
              return new Promise((resolve, reject) => {
                stats.resolvers.push({
                  resolve: () => { stats.active -= 1; resolve({
                    file: new File(['processed'], 'processed-' + file.name, { type: 'image/jpeg' }),
                    metadata: { mime: 'image/jpeg', size: 20, width: 390, height: 567 },
                    operations: ['CONVERT'], validation: { valid: true, violations: [] }, durationMs: 1, warnings: []
                  }); },
                  reject: () => { stats.active -= 1; reject(Object.assign(new Error('synthetic failure'), { code: 'PROCESSING_FAILED' })); }
                });
              });
            }
            return Promise.resolve({
              file: new File(['processed'], 'processed.jpg', { type: 'image/jpeg' }),
              metadata: { mime: 'image/jpeg', size: 20, width: 390, height: 567 },
              operations: mode === 'async-resize' ? ['RESIZE'] : ['CONVERT'],
              validation: { valid: true, violations: [] }, durationMs: 1, warnings: []
            });
          },
          injectFileFn: (element, file) => {
            stats.inject += 1;
            if (mode === 'async-compliant') throw new Error('unexpected inject');
            if (mode === 'async-resize') {
              return api.injectFile(element, file, { dispatchEvents: true, reason: 'processed' });
            }
           return { ok: true, inputFilesVerified: true, eventsDispatched: mode === 'async-resize' ? ['input', 'change'] : [] };
          },
          restoreOriginalFn: () => { stats.restore += 1; return { ok: true, inputFilesVerified: true, eventsDispatched: [] }; },
          confirmationResolver: mode === 'rule-process'
            ? ({ type, plan, policyConfirmation }) => {
              const pending = policyConfirmation
                ?? plan.confirmations.find((item) => item.type === type && !item.resolved);
              return {
                id: pending.id,
                type,
                accepted: true,
                payload: type === 'RULE_CONFIDENCE' ? { allow: true } : pending.suggestedPayload
              };
            }
            : null
        });
        globalThis.__s3Controller = controller;
        globalThis.__s3Input = input;
        globalThis.__s3Inputs = inputs;
        globalThis.__s3Timeline = timeline;
        globalThis.__s3Stats = stats;
        controller.start();
        document.addEventListener('change', (event) => {
          if (!inputs.includes(event.target)) return;
          timeline.push({ kind: 'business', at: performance.now(), type: event.target.files[0]?.type ?? null });
        }, true);
        return { controller, input, inputs };
      },
      select(name, type = 'image/jpeg', index = 0) {
        const input = globalThis.__s3Inputs[index];
        replaceFiles(input, new File(['synthetic'], name, { type }));
      }
    };
  });
}

async function waitFor(page, predicate, timeout = 20_000) {
  await expect.poll(() => page.evaluate(predicate), { timeout }).toBe(true);
}

test('Q-S3-001: async dimension violation blocks the page event before CROP confirmation', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => __s3Harness.install('async-crop'));
  await page.evaluate(() => __s3Harness.select('square.jpg'));
  await waitFor(page, () => __s3Controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
  const result = await page.evaluate(() => ({ timeline: __s3Timeline, task: __s3Controller.getSnapshot().activeTask }));
  expect(result.timeline.filter((item) => item.kind === 'business')).toHaveLength(0);
  expect(result.timeline.some((item) => item.kind === 'metadata')).toBe(true);
  expect(result.task.plan.confirmations.some((item) => item.type === 'CROP')).toBe(true);
  await page.evaluate(() => __s3Controller.dispose());
});

test('Q-S3-002: async compliant image releases the original once after metadata decision', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => __s3Harness.install('async-compliant'));
  await page.evaluate(() => __s3Harness.select('compliant.jpg'));
  await waitFor(page, () => __s3Controller.getSnapshot().activeTask?.status === 'PASSTHROUGH');
  const result = await page.evaluate(() => ({ timeline: __s3Timeline, task: __s3Controller.getSnapshot().activeTask }));
  const business = result.timeline.filter((item) => item.kind === 'business');
  expect(business).toHaveLength(1);
  expect(business[0].type).toBe('image/jpeg');
  expect(result.timeline.findIndex((item) => item.kind === 'business'))
    .toBeGreaterThan(result.timeline.findIndex((item) => item.kind === 'metadata'));
  expect(result.task.result).toBeNull();
  expect(await page.evaluate(() => __s3Stats.process + __s3Stats.inject)).toBe(0);
  await page.evaluate(() => __s3Controller.dispose());
});

test('Q-S3-003: async resize sends only the processed file to the page', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => __s3Harness.install('async-resize'));
  await page.evaluate(() => __s3Harness.select('original.jpg'));
  await waitFor(page, () => __s3Controller.getSnapshot().activeTask?.status === 'SUCCESS');
  const result = await page.evaluate(() => ({
    timeline: __s3Timeline,
    file: { name: __s3Input.files[0].name, type: __s3Input.files[0].type },
    task: __s3Controller.getSnapshot().activeTask
  }));
  const business = result.timeline.filter((item) => item.kind === 'business');
  expect(business).toHaveLength(1);
  expect(business[0].type).toBe('image/jpeg');
  expect(result.file.name).toBe('processed.jpg');
  expect(result.task.result.operations).toContain('RESIZE');
  await page.evaluate(() => __s3Controller.dispose());
});

test('Q-S3-004: accepted RULE_CONFIDENCE enables the canonical processing plan', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => __s3Harness.install('rule-process'));
  await page.evaluate(() => __s3Harness.select('source.png', 'image/png'));
  await waitFor(page, () => __s3Controller.getSnapshot().activeTask?.status === 'SUCCESS');
  const result = await page.evaluate(() => ({ task: __s3Controller.getSnapshot().activeTask, stats: __s3Stats }));
  expect(result.stats.process).toBe(1);
  expect(result.stats.inject).toBe(1);
  expect(result.task.plan.confirmations.some((item) => item.type === 'RULE_CONFIDENCE')).toBe(false);
  await page.evaluate(() => __s3Controller.dispose());
});

test('Q-S3-005: policy acceptance passes through compliant input and rejection cancels safely', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => __s3Harness.install('rule-passthrough'));
  await page.evaluate(() => __s3Harness.select('accepted.jpg'));
  await waitFor(page, () => __s3Controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
  let policy = await page.evaluate(() => {
    const task = __s3Controller.getSnapshot().activeTask;
    return task.policyConfirmation ?? task.plan.confirmations.find((item) => item.type === 'RULE_CONFIDENCE');
  });
  await page.evaluate((confirmation) => __s3Controller.confirmTask(__s3Controller.getSnapshot().activeTask.taskId, {
    id: confirmation.id, type: 'RULE_CONFIDENCE', accepted: true, payload: { allow: true }
  }), policy);
  await waitFor(page, () => __s3Controller.getSnapshot().activeTask?.status === 'PASSTHROUGH');
  expect(await page.evaluate(() => ({ process: __s3Stats.process, inject: __s3Stats.inject }))).toEqual({ process: 0, inject: 0 });
  await page.evaluate(() => __s3Harness.select('rejected.jpg'));
  await waitFor(page, () => __s3Controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
  policy = await page.evaluate(() => {
    const task = __s3Controller.getSnapshot().activeTask;
    return task.policyConfirmation ?? task.plan.confirmations.find((item) => item.type === 'RULE_CONFIDENCE');
  });
  const rejected = await page.evaluate((confirmation) => __s3Controller.confirmTask(__s3Controller.getSnapshot().activeTask.taskId, {
    id: confirmation.id, type: 'RULE_CONFIDENCE', accepted: false, payload: null
  }), policy);
  expect(rejected).toMatchObject({ ok: true, status: 'STOPPED' });
  expect(await page.evaluate(() => __s3Controller.getSnapshot().activeTask.errorCode)).toBe('USER_CANCELLED');
  await page.evaluate(() => __s3Controller.dispose());
});

test('Q-S3-006: RULE_CONFIDENCE and CROP remain independent confirmations', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => __s3Harness.install('rule-crop'));
  await page.evaluate(() => __s3Harness.select('square.jpg'));
  await waitFor(page, () => __s3Controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
  const pending = await page.evaluate(() => __s3Controller.getSnapshot().activeTask);
  const policy = pending.policyConfirmation ?? pending.plan.confirmations.find((item) => item.type === 'RULE_CONFIDENCE');
  const crop = pending.plan.confirmations.find((item) => item.type === 'CROP');
  await page.evaluate(() => {
    const task = __s3Controller.getSnapshot().activeTask;
    const panel = document.createElement('section');
    panel.id = 's3-acceptance-evidence';
    panel.style.cssText = [
      'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483647',
      'width:360px', 'padding:20px', 'border-radius:16px',
      'background:#111827', 'color:#f9fafb', 'font:14px/1.7 system-ui,sans-serif',
      'box-shadow:0 12px 40px rgba(0,0,0,.28)', 'white-space:pre-wrap'
    ].join(';');
    panel.textContent = [
      'UploadFit S3 合成验收证据',
      '',
      '输入：合成图片 fixture',
      '当前状态：' + task.status,
      '策略确认：RULE_CONFIDENCE 待确认',
      '图像确认：CROP 待确认',
      '原始 change：已阻断（0 次）'
    ].join('\n');
    document.body.append(panel);
  });
  await page.screenshot({ path: 'docs/evidence/S3/s3-confirmation-before.png', fullPage: true });
  await page.evaluate((confirmation) => {
    const task = __s3Controller.getSnapshot().activeTask;
    return __s3Controller.confirmTask(task.taskId, {
      id: confirmation.id,
      type: 'CROP',
      accepted: true,
      payload: {
        x: task.plan.proposedCrop.x / task.current.width,
        y: task.plan.proposedCrop.y / task.current.height,
        width: task.plan.proposedCrop.width / task.current.width,
        height: task.plan.proposedCrop.height / task.current.height
      }
    });
  }, crop);
  expect(await page.evaluate(() => __s3Stats.process)).toBe(0);
  await page.evaluate((confirmation) => __s3Controller.confirmTask(__s3Controller.getSnapshot().activeTask.taskId, {
    id: confirmation.id, type: 'RULE_CONFIDENCE', accepted: true, payload: { allow: true }
  }), policy);
  await waitFor(page, () => __s3Controller.getSnapshot().activeTask?.status === 'SUCCESS');
  await page.evaluate(() => {
    const panel = document.getElementById('s3-acceptance-evidence');
    const task = __s3Controller.getSnapshot().activeTask;
    panel.textContent = [
      'UploadFit S3 合成验收证据',
      '',
      '输入：合成图片 fixture',
      '当前状态：' + task.status,
      '策略确认：已接受',
      '图像确认：已接受',
      '最终文件：通过复检并完成注入',
      '业务按钮点击：0 次'
    ].join('\n');
  });
  await page.screenshot({ path: 'docs/evidence/S3/s3-confirmation-after.png', fullPage: true });
  expect(await page.evaluate(() => __s3Stats.process)).toBe(1);
  await page.evaluate(() => __s3Controller.dispose());
});

test('Q-S3-007: two uploaders execute FIFO with one processing slot and no diagnostics', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => __s3Harness.install('queue'));
  await page.evaluate(() => { __s3Harness.select('A.png', 'image/png', 0); __s3Harness.select('B.png', 'image/png', 1); });
  await waitFor(page, () => __s3Controller.tasks.size === 2 && __s3Stats.resolvers.length === 1);
  await page.evaluate(() => __s3Stats.resolvers[0].resolve());
  await waitFor(page, () => __s3Stats.resolvers.length === 2);
  await page.evaluate(() => __s3Stats.resolvers[1].resolve());
  await waitFor(page, () => [...__s3Controller.tasks.values()].every((task) => task.status === 'SUCCESS'));
  const result = await page.evaluate(() => ({ started: __s3Stats.started, maxActive: __s3Stats.maxActive,
    statuses: [...__s3Controller.tasks.values()].map((task) => task.status), diagnostics: __s3Controller.getDiagnostics().diagnostics }));
  expect(result.started).toEqual(['A.png', 'B.png']);
  expect(result.maxActive).toBe(1);
  expect(result.statuses).toEqual(['SUCCESS', 'SUCCESS']);
  expect(result.diagnostics).toEqual([]);
  await page.evaluate(() => __s3Controller.dispose());
});

test('Q-S3-008: failed first task releases FIFO queue and second task succeeds cleanly', async ({ page }) => {
  await openController(page);
  await page.evaluate(() => __s3Harness.install('queue-fail'));
  await page.evaluate(() => { __s3Harness.select('A.png', 'image/png', 0); __s3Harness.select('B.png', 'image/png', 1); });
  await waitFor(page, () => __s3Stats.resolvers.length === 1);
  await page.evaluate(() => __s3Stats.resolvers[0].reject());
  await waitFor(page, () => __s3Stats.resolvers.length === 2);
  await page.evaluate(() => __s3Stats.resolvers[1].resolve());
  await waitFor(page, () => {
    const tasks = [...__s3Controller.tasks.values()];
    return tasks.length === 2 && tasks[0].status === 'STOPPED' && tasks[1].status === 'SUCCESS';
  });
  const result = await page.evaluate(() => ({ started: __s3Stats.started, maxActive: __s3Stats.maxActive,
    statuses: [...__s3Controller.tasks.values()].map((task) => task.status), diagnostics: __s3Controller.getDiagnostics().diagnostics }));
  expect(result.started).toEqual(['A.png', 'B.png']);
  expect(result.maxActive).toBe(1);
  expect(result.statuses).toEqual(['STOPPED', 'SUCCESS']);
  expect(result.diagnostics).toEqual([]);
  await page.evaluate(() => __s3Controller.dispose());
});
