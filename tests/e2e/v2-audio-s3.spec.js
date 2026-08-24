import { expect, test } from '@playwright/test';

function audioRules(overrides = {}) {
  return {
    mediaKind: 'audio',
    formats: ['audio/mpeg'],
    extensions: ['.mp3'],
    minBytes: null,
    maxBytes: 250_000,
    duration: { exactMs: null, minMs: null, maxMs: null },
    audio: { sampleRates: [], channels: [], bitDepths: [] },
    confidence: 0.95,
    sources: [{ type: 'nearby-text', priority: 400, confidence: 0.95, evidence: ['MP3 最大 250KB'] }],
    conflicts: [],
    advisories: [],
    safetyFlags: [],
    semanticRequirements: [],
    actionable: true,
    ...overrides
  };
}

async function open(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
}

async function installAudioController(page, rules = audioRules()) {
  return page.evaluate((ruleSet) => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mpeg';
    input.setAttribute('aria-label', '录音转写 MP3');
    document.body.append(input);
    const controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      parseRulesFn: () => [],
      resolveRulesFn: () => ruleSet
    });
    controller.registerUploader({
      input,
      uploaderId: 'audio-s3-uploader',
      label: '录音转写',
      mediaKind: 'audio',
      acceptTokens: ['audio/mpeg'],
      multiple: false,
      nearbyTexts: ['MP3 最大 250KB'],
      alertTexts: [],
      pageUrl: location.href,
      pageTitle: document.title
    });
    controller.start();
    globalThis.__audioS3 = { api, input, controller };
    return true;
  }, rules);
}

async function selectWav(page, seconds = 0.5) {
  await page.evaluate((duration) => {
    const sampleRate = 44100;
    const channels = 1;
    const bits = 16;
    const frames = Math.max(1, Math.round(sampleRate * duration));
    const dataBytes = frames * channels * bits / 8;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const ascii = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    ascii(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bits / 8, true);
    view.setUint16(32, channels * bits / 8, true); view.setUint16(34, bits, true);
    ascii(36, 'data'); view.setUint32(40, dataBytes, true);
    const transfer = new DataTransfer();
    transfer.items.add(new File([buffer], 's3-voice.wav', { type: 'audio/wav' }));
    __audioS3.input.files = transfer.files;
    __audioS3.input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }, seconds);
}

async function waitFor(page, predicate) {
  await expect.poll(() => page.evaluate(predicate), { timeout: 20_000 }).toBe(true);
}

test('V2-S3 PCM WAV follows confirmation → Worker processing → final validation → injection', async ({ page }) => {
  await open(page);
  await installAudioController(page);
  await selectWav(page);
  await waitFor(page, () => __audioS3.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
  const pending = await page.evaluate(() => {
    const task = __audioS3.controller.getSnapshot().activeTask;
    return task.plan.confirmations.find((item) => item.required && !item.resolved);
  });
  expect(pending.type).toBe('AUDIO_LOSSY_TRANSCODE');
  await page.evaluate((confirmation) => __audioS3.controller.confirmTask(
    __audioS3.controller.getSnapshot().activeTask.taskId,
    { id: confirmation.id, type: confirmation.type, accepted: true, payload: confirmation.suggestedPayload }
  ), pending);
  await waitFor(page, () => __audioS3.controller.getSnapshot().activeTask?.status === 'SUCCESS');
  const result = await page.evaluate(() => {
    const task = __audioS3.controller.getSnapshot().activeTask;
    return {
      task,
      file: { type: __audioS3.input.files[0].type, size: __audioS3.input.files[0].size },
      clickCount: [...__audioS3.controller.tasks.values()].find((item) => item.taskId === task.taskId)?.businessClickCount ?? -1
    };
  });
  expect(result.file.type).toBe('audio/mpeg');
  expect(result.file.size).toBeLessThanOrEqual(250_000);
  expect(result.task.mediaKind).toBe('audio');
  expect(result.task.result.workerUsed).toBe(true);
  expect(result.clickCount).toBe(0);
  await page.evaluate(() => __audioS3.controller.dispose());
});

test('V2-S3 compliant MP3 is passthrough with no process or injection replacement', async ({ page }) => {
  await open(page);
  await installAudioController(page);
  await selectWav(page, 0.25);
  await waitFor(page, () => __audioS3.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
  const pending = await page.evaluate(() => __audioS3.controller.getSnapshot().activeTask.plan.confirmations[0]);
  await page.evaluate((confirmation) => __audioS3.controller.confirmTask(
    __audioS3.controller.getSnapshot().activeTask.taskId,
    { id: confirmation.id, type: confirmation.type, accepted: true, payload: confirmation.suggestedPayload }
  ), pending);
  await waitFor(page, () => __audioS3.controller.getSnapshot().activeTask?.status === 'SUCCESS');
  const processed = await page.evaluate(() => ({
    type: __audioS3.input.files[0].type,
    size: __audioS3.input.files[0].size
  }));
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'audio/mpeg'; input.id = 'audio-passthrough';
    document.body.append(input);
    __audioS3.controller.registerUploader({
      input, uploaderId: 'audio-passthrough', label: 'MP3', mediaKind: 'audio',
      acceptTokens: ['audio/mpeg'], multiple: false, nearbyTexts: ['MP3 最大 250KB'], alertTexts: []
    });
    __audioS3.passthroughInput = input;
    const transfer = new DataTransfer();
    transfer.items.add(__audioS3.input.files[0]);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await waitFor(page, () => __audioS3.controller.getSnapshot().activeTask?.status === 'PASSTHROUGH');
  const result = await page.evaluate(() => ({
    task: __audioS3.controller.getSnapshot().activeTask,
    same: __audioS3.passthroughInput.files[0].type === 'audio/mpeg',
    size: __audioS3.passthroughInput.files[0].size
  }));
  expect(result.task.result).toBeNull();
  expect(result.same).toBe(true);
  expect(result.task.mediaKind).toBe('audio');
  expect(result.size).toBe(processed.size);
  await page.evaluate(() => __audioS3.controller.dispose());
});

test('V2-S3 local A-H page exposes production audio orchestration and accessible snapshot', async ({ page }) => {
  await page.goto('/test-pages/audio-s3.html?scenario=B');
  await expect(page.locator('[data-scenario-link]')).toHaveCount(8);
  await expect.poll(() => page.evaluate(() => Boolean(window.__uploadfitAudioS3?.controller))).toBe(true);
  await page.click('#audio-s3-generate-wav');
  await expect.poll(() => page.evaluate(() => (
    window.__uploadfitAudioS3.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION'
  )), { timeout: 20_000 }).toBe(true);
  const pending = await page.evaluate(() => {
    const task = window.__uploadfitAudioS3.controller.getSnapshot().activeTask;
    return task.plan.confirmations.find((item) => item.required && !item.resolved);
  });
  await page.evaluate((confirmation) => {
    const controller = window.__uploadfitAudioS3.controller;
    const task = controller.getSnapshot().activeTask;
    return controller.confirmTask(task.taskId, {
      id: confirmation.id,
      type: confirmation.type,
      accepted: true,
      payload: confirmation.suggestedPayload
    });
  }, pending);
  // The rejection observer may schedule the second confirmation in the same
  // turn as the first successful injection, so the transient SUCCESS state
  // is not required to be observable by the polling boundary.
  await expect.poll(() => page.evaluate(() => {
    const status = window.__uploadfitAudioS3.controller.getSnapshot().activeTask?.status;
    return status === 'SUCCESS' || status === 'NEEDS_CONFIRMATION';
  }), { timeout: 20_000 }).toBe(true);
  const pageResult = await page.evaluate(() => ({
    file: {
      type: window.__uploadfitAudioS3.input.files[0]?.type,
      bytes: window.__uploadfitAudioS3.input.files[0]?.size
    },
    snapshotText: document.getElementById('audio-s3-snapshot')?.textContent ?? '',
    businessSubmitButtons: [...document.querySelectorAll('button[type="submit"], input[type="submit"]')].length
  }));
  expect(pageResult.file.type).toBe('audio/mpeg');
  expect(pageResult.file.bytes).toBeLessThanOrEqual(250_000);
  expect(pageResult.snapshotText).toContain('audio');
  expect(pageResult.businessSubmitButtons).toBe(0);
  await page.evaluate(() => window.__uploadfit_session__?.cleanup?.());
});

test('V2-S3 stable page H performs at most one associated rejection retry', async ({ page }) => {
  await page.goto('/test-pages/audio-s3.html?scenario=H');
  await expect.poll(() => page.evaluate(() => Boolean(window.__uploadfitAudioS3?.controller))).toBe(true);
  await page.click('#audio-s3-generate-wav');
  await expect.poll(() => page.evaluate(() => (
    window.__uploadfitAudioS3.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION'
  )), { timeout: 20_000 }).toBe(true);
  const pending = await page.evaluate(() => {
    const task = window.__uploadfitAudioS3.controller.getSnapshot().activeTask;
    return task.plan.confirmations.find((item) => item.required && !item.resolved);
  });
  await page.evaluate((confirmation) => {
    const controller = window.__uploadfitAudioS3.controller;
    const task = controller.getSnapshot().activeTask;
    return controller.confirmTask(task.taskId, {
      id: confirmation.id,
      type: confirmation.type,
      accepted: true,
      payload: confirmation.suggestedPayload
    });
  }, pending);
  // The rejection observer may schedule the second confirmation in the same
  // turn as the first successful injection, so the transient SUCCESS state
  // is not required to be observable by the polling boundary.
  await expect.poll(() => page.evaluate(() => {
    const status = window.__uploadfitAudioS3.controller.getSnapshot().activeTask?.status;
    return status === 'SUCCESS' || status === 'NEEDS_CONFIRMATION';
  }), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const task = window.__uploadfitAudioS3.controller.getSnapshot().activeTask;
    return task?.status === 'NEEDS_CONFIRMATION'
      || (task?.status === 'SUCCESS' && task.retryCount === 1);
  }), { timeout: 20_000 }).toBe(true);
  const retryConfirmation = await page.evaluate(() => {
    const task = window.__uploadfitAudioS3.controller.getSnapshot().activeTask;
    return task?.status === 'NEEDS_CONFIRMATION'
      ? task.plan.confirmations.find((item) => item.required && !item.resolved)
      : null;
  });
  if (retryConfirmation) {
    await page.evaluate((confirmation) => {
      const controller = window.__uploadfitAudioS3.controller;
      const task = controller.getSnapshot().activeTask;
      return controller.confirmTask(task.taskId, {
        id: confirmation.id,
        type: confirmation.type,
        accepted: true,
        payload: confirmation.suggestedPayload
      });
    }, retryConfirmation);
  }
  await expect.poll(() => page.evaluate(() => {
    const task = window.__uploadfitAudioS3.controller.getSnapshot().activeTask;
    return task?.status === 'SUCCESS' && task.retryCount === 1;
  }), { timeout: 20_000 }).toBe(true);
  const result = await page.evaluate(() => ({
    task: window.__uploadfitAudioS3.controller.getSnapshot().activeTask,
    file: { type: window.__uploadfitAudioS3.input.files[0]?.type, bytes: window.__uploadfitAudioS3.input.files[0]?.size },
    submits: [...document.querySelectorAll('button[type="submit"], input[type="submit"]')].length
  }));
  expect(result.task.retryCount).toBe(1);
  expect(result.file.type).toBe('audio/mpeg');
  expect(result.submits).toBe(0);
  await page.evaluate(() => window.__uploadfit_session__?.cleanup?.());
});
