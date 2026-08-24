import { expect, test } from '@playwright/test';

async function openAudioUi(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => {
    (function installAudioUiHarness() {
      const api = globalThis.__uploadfit_debug_bundle__;
      api.cleanupSession();

      const task = {
        taskId: 'audio-ui-task',
        status: 'NEEDS_CONFIRMATION',
        mediaKind: 'audio',
        source: 'preflight',
        current: {
          mediaKind: 'audio', mime: 'audio/wav', size: 123456,
          durationMs: 125000, bitrateKbps: 128, channels: 2
        },
        rules: {
          mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'],
          minBytes: null, maxBytes: 250000,
          audio: { sampleRates: [], channels: [], bitDepths: [] },
          semanticRequirements: [], conflicts: [],
          sources: [{
            type: 'nearby-text', priority: 400,
            evidence: [
              'MP3 最大 250KB',
              '<img src=x onerror=alert(1)>',
              '</style><script>window.__audioUiInjected=1</script>'
            ]
          }]
        },
        plan: {
          mediaKind: 'audio', targetMime: 'audio/mpeg', targetBitrateKbps: 64,
          targetChannels: 1, estimatedOutputBytes: { min: 100000, max: 120000 },
          operations: ['TRANSCODE_AUDIO', 'DOWNMIX_MONO'],
          confirmations: [
            {
              id: 'audio-lossy', type: 'AUDIO_LOSSY_TRANSCODE', required: true,
              resolved: false, accepted: null, suggestedPayload: { allow: true }
            },
            {
              id: 'audio-mono', type: 'AUDIO_DOWNMIX_MONO', required: true,
              resolved: false, accepted: null, suggestedPayload: { allow: true }
            }
          ]
        },
        policyConfirmation: null,
        progress: null,
        result: null,
        errorCode: null,
        retryCount: 0,
        warnings: []
      };
      let snapshot = { sessionState: 'NEEDS_CONFIRMATION', uploaderCount: 1, activeTask: task, pageCard: null };
      const listeners = new Set();
      const confirmations = [];
      let processCalls = 0;
      let cancelCalls = 0;
      const publish = () => listeners.forEach((listener) => listener(snapshot));
      const controller = {
        subscribe(listener) {
          listeners.add(listener);
          listener(snapshot);
          return () => listeners.delete(listener);
        },
        getSnapshot: () => snapshot,
        confirmTask(taskId, confirmation) {
          confirmations.push({ taskId, ...confirmation });
          const pending = task.plan.confirmations.find((item) => item.id === confirmation.id);
          if (pending) {
            pending.resolved = true;
            pending.accepted = confirmation.accepted;
          }
          if (!confirmation.accepted) task.status = 'STOPPED';
          else if (task.plan.confirmations.some((item) => item.required && !item.resolved)) task.status = 'NEEDS_CONFIRMATION';
          else {
            task.status = 'PROCESSING';
            processCalls += 1;
          }
          publish();
        },
        cancelTask() {
          cancelCalls += 1;
          task.status = 'STOPPED';
          task.errorCode = 'USER_CANCELLED';
          publish();
        },
        setSnapshot(next) {
          snapshot = next;
          publish();
        },
        getTaskOutput: () => null,
        dispose() {
          listeners.clear();
        }
      };
      const ui = api.createUploadFitUi({
        documentRef: document,
        globalRef: window,
        controller,
        config: { shadowMode: 'open' }
      });
      globalThis.__audioUi = { controller, task, ui, confirmations, get processCalls() { return processCalls; }, get cancelCalls() { return cancelCalls; } };
      ui.expand();
    }());
  });
}

test('V2-S3 audio UI renders evidence, independent confirmations, accessible progress and audio copy', async ({ page }) => {
  await openAudioUi(page);

  const initial = await page.evaluate(() => {
    const shadow = document.querySelector('[data-uploadfit-ui-host]').shadowRoot;
    const card = shadow.querySelector('.uf-card');
    const start = shadow.querySelector('[data-uf-action="confirm-audio"]');
    const cancel = shadow.querySelector('[data-uf-action="decline-audio"]');
    const actions = start?.parentElement;
    const evidence = shadow.querySelector('.uf-evidence');
    start?.focus();
    return {
      text: card?.textContent ?? '',
      evidenceText: evidence?.textContent ?? '',
      executableNodes: evidence
        ? evidence.querySelectorAll('img,script,style').length : -1,
      sameActionsParent: Boolean(actions && cancel?.parentElement === actions),
      buttonTypes: [start?.type, cancel?.type],
      focusedStart: shadow.activeElement === start,
      confirmationType: start?.getAttribute('data-uf-action'),
      processCalls: globalThis.__audioUi.processCalls
    };
  });
  expect(initial.text).toContain('audio/wav');
  expect(initial.text).toContain('123456 字节');
  expect(initial.text).toContain('2 分 5 秒');
  expect(initial.text).toContain('MP3 (audio/mpeg)');
  expect(initial.text).toContain('64 kbps');
  expect(initial.text).toContain('100000 字节 – 120000 字节');
  expect(initial.text).toContain('单声道（会改变声道数）');
  expect(initial.text).toContain('有损处理，可能影响音质');
  expect(initial.evidenceText).toContain('<img src=x onerror=alert(1)>');
  expect(initial.evidenceText).toContain('</style><script>window.__audioUiInjected=1</script>');
  expect(initial.executableNodes).toBe(0);
  expect(initial.sameActionsParent).toBe(true);
  expect(initial.buttonTypes).toEqual(['button', 'button']);
  expect(initial.focusedStart).toBe(true);
  expect(initial.confirmationType).toBe('confirm-audio');
  expect(initial.processCalls).toBe(0);

  const afterCancel = await page.evaluate(() => {
    const host = document.querySelector('[data-uploadfit-ui-host]');
    host.shadowRoot.querySelector('[data-uf-action="decline-audio"]').click();
    return {
      cancelCalls: globalThis.__audioUi.cancelCalls,
      lastConfirmation: globalThis.__audioUi.confirmations.at(-1),
      processCalls: globalThis.__audioUi.processCalls
    };
  });
  expect(afterCancel.cancelCalls).toBe(0);
  expect(afterCancel.lastConfirmation.type).toBe('AUDIO_LOSSY_TRANSCODE');
  expect(afterCancel.lastConfirmation.accepted).toBe(false);
  expect(afterCancel.processCalls).toBe(0);

  const dualConfirm = await page.evaluate(() => {
    const harness = globalThis.__audioUi;
    harness.task.status = 'NEEDS_CONFIRMATION';
    harness.task.errorCode = null;
    harness.confirmations.length = 0;
    harness.task.plan.confirmations.forEach((item) => {
      item.resolved = false;
      item.accepted = null;
    });
    harness.controller.setSnapshot({
      sessionState: 'NEEDS_CONFIRMATION', uploaderCount: 1,
      activeTask: harness.task, pageCard: null
    });
    const shadow = document.querySelector('[data-uploadfit-ui-host]').shadowRoot;
    shadow.querySelector('[data-uf-action="confirm-audio"]').click();
    const pendingAfterFirst = harness.task.plan.confirmations
      .find((item) => item.required && !item.resolved);
    return {
      confirmations: harness.confirmations.map((item) => item.type),
      pendingAfterFirst: pendingAfterFirst?.type ?? null,
      processCalls: harness.processCalls
    };
  });
  expect(dualConfirm.confirmations).toEqual(['AUDIO_LOSSY_TRANSCODE']);
  expect(dualConfirm.pendingAfterFirst).toBe('AUDIO_DOWNMIX_MONO');
  expect(dualConfirm.processCalls).toBe(0);

  const finiteProgress = await page.evaluate(() => {
    const harness = globalThis.__audioUi;
    harness.task.status = 'PROCESSING';
    harness.task.progress = { phase: 'encode', ratio: 0.37, processedMs: 46250, totalMs: 125000 };
    harness.controller.setSnapshot({
      sessionState: 'PROCESSING', uploaderCount: 1,
      activeTask: harness.task, pageCard: null
    });
    const shadow = document.querySelector('[data-uploadfit-ui-host]').shadowRoot;
    const bar = shadow.querySelector('.uf-progress-bar');
    return {
      className: bar.className,
      width: bar.style.width,
      now: bar.getAttribute('aria-valuenow'),
      min: bar.getAttribute('aria-valuemin'),
      max: bar.getAttribute('aria-valuemax'),
      text: shadow.querySelector('.uf-hint')?.textContent ?? '',
      animation: getComputedStyle(bar).animationName
    };
  });
  expect(finiteProgress.className).toContain('uf-progress-bar-determinate');
  expect(finiteProgress.className).not.toContain('indeterminate');
  expect(finiteProgress.width).toBe('37%');
  expect(finiteProgress.now).toBe('37');
  expect(finiteProgress.min).toBe('0');
  expect(finiteProgress.max).toBe('100');
  expect(finiteProgress.text).toContain('37%');
  expect(finiteProgress.animation).toBe('none');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const unknownProgress = await page.evaluate(() => {
    const harness = globalThis.__audioUi;
    harness.task.progress = { phase: 'read', ratio: null, processedMs: null, totalMs: null };
    harness.controller.setSnapshot({
      sessionState: 'PROCESSING', uploaderCount: 1,
      activeTask: harness.task, pageCard: null
    });
    const shadow = document.querySelector('[data-uploadfit-ui-host]').shadowRoot;
    const bar = shadow.querySelector('.uf-progress-bar');
    return {
      className: bar.className,
      now: bar.getAttribute('aria-valuenow'),
      animation: getComputedStyle(bar).animationName
    };
  });
  expect(unknownProgress.className).toContain('uf-progress-bar-indeterminate');
  expect(unknownProgress.now).toBeNull();
  expect(unknownProgress.animation).toBe('none');

  const inspecting = await page.evaluate(() => {
    const harness = globalThis.__audioUi;
    harness.task.status = 'INSPECTING';
    harness.task.progress = null;
    harness.controller.setSnapshot({
      sessionState: 'INSPECTING', uploaderCount: 1,
      activeTask: harness.task, pageCard: null
    });
    const host = document.querySelector('[data-uploadfit-ui-host]');
    return {
      card: host.shadowRoot.querySelector('.uf-card')?.textContent ?? '',
      pill: host.shadowRoot.querySelector('.uf-pill-text')?.textContent ?? ''
    };
  });
  expect(inspecting.card).toContain('正在检查音频');
  expect(inspecting.card).toContain('正在读取音频信息');
  expect(inspecting.card).not.toContain('图片');
  expect(inspecting.pill).toBe('正在检查音频');
  expect(inspecting.pill).not.toContain('图片');

  await page.evaluate(() => globalThis.__audioUi.ui.dispose());
});
