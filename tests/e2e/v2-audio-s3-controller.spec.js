import { expect, test } from '@playwright/test';

async function open(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
}

async function installSynthetic(page, mode, options = {}) {
  await page.evaluate(({ selectedMode, withImage }) => {
    const api = globalThis.__uploadfit_debug_bundle__;
    globalThis.__syntheticAudio?.controller?.dispose?.();
    globalThis.__syntheticAudio?.wrapper?.remove?.();
    globalThis.__syntheticAudio?.imageInput?.remove?.();
    const audioRules = {
      mediaKind: 'audio',
      formats: selectedMode === 'no-mp3' ? ['audio/wav'] : ['audio/mpeg'],
      extensions: selectedMode === 'no-mp3' ? ['.wav'] : ['.mp3'],
      minBytes: null, maxBytes: selectedMode === 'no-max' ? null : 250_000,
      duration: { exactMs: null, minMs: null, maxMs: selectedMode === 'duration' ? 1000 : null },
      audio: { sampleRates: [], channels: [], bitDepths: [] },
      confidence: 0.95,
      sources: [{ type: 'nearby-text', priority: 400, confidence: 0.95, evidence: ['MP3 最大 250KB'] }],
      conflicts: [], advisories: [], safetyFlags: [], semanticRequirements: [], actionable: true
    };
    const imageRules = {
      mediaKind: 'image', formats: ['image/jpeg'], extensions: ['.jpg'],
      minBytes: 1, maxBytes: 250_000,
      width: { exact: null, min: null, max: null }, height: { exact: null, min: null, max: null },
      aspectRatio: null, dpi: null, count: { max: 1 }, background: null,
      semanticRequirements: [], confidence: 0.95,
      sources: [{ type: 'nearby-text', priority: 400, confidence: 0.95, evidence: ['JPG'] }],
      conflicts: [], advisories: [], safetyFlags: [], actionable: true
    };
    const stats = { process: 0, imageProcess: 0, aborted: 0, injectReasons: [], submitClicks: 0 };
    const wrapper = document.createElement('section');
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'audio/mpeg'; input.id = 'synthetic-audio';
    const error = document.createElement('p');
    error.id = 'synthetic-audio-error'; error.setAttribute('role', 'alert');
    wrapper.append(input, error);
    document.body.append(wrapper);
    let imageInput = null;
    if (withImage) {
      imageInput = document.createElement('input');
      imageInput.type = 'file'; imageInput.accept = 'image/jpeg'; imageInput.id = 'synthetic-image';
      document.body.append(imageInput);
    }
    const metadataFor = (file) => {
      const isM4a = selectedMode === 'm4a';
      const isLarge = selectedMode === 'over-limit';
      const isLong = selectedMode === 'duration';
      return {
        mediaKind: 'audio', fileType: file.type,
        signatureMime: isM4a ? 'audio/mp4' : file.type === 'audio/mpeg' ? 'audio/mpeg' : 'audio/wav',
        container: isM4a ? 'mp4' : file.type === 'audio/mpeg' ? 'mp3' : 'wav',
        codec: isM4a ? 'aac-lc' : file.type === 'audio/mpeg' ? 'mp3' : 'pcm',
        size: isLarge ? 300_000 : file.size, durationMs: isLong ? 1500 : 500,
        sampleRate: 44100, channels: 1, bitDepth: file.type === 'audio/wav' ? 16 : null,
        averageBitrate: 128_000, errorCode: null, warnings: [], audioOffset: 0,
        firstFrame: file.type === 'audio/mpeg' ? {} : undefined,
        frameCount: file.type === 'audio/mpeg' ? 3 : undefined
      };
    };
    const audioHandler = {
      kind: 'audio',
      supports: (file, context) => context?.mediaKind === 'audio' && /^audio\//.test(file?.type ?? ''),
      inspect: async (file) => metadataFor(file),
      validate: (metadata, rules) => api.validateAudioMetadata(metadata, rules),
      plan: (metadata, rules) => {
        if (selectedMode === 'cancel' || selectedMode === 'detach'
          || selectedMode === 'rollback' || selectedMode === 'retry') {
          return {
            mediaKind: 'audio', sourceContainer: metadata.container, sourceCodec: metadata.codec,
            targetMime: 'audio/mpeg', targetContainer: 'mp3', targetCodec: 'mp3', targetMaxBytes: 250_000,
            safeTargetBytes: 237_500, targetBitrateKbps: 64, targetSampleRate: 44100, targetChannels: 1,
            operations: ['TRANSCODE_AUDIO'], confirmations: [], estimatedOutputBytes: { min: 1, max: 30_000 },
            encodePassLimit: 2, executable: true, passthrough: false, unfixable: [], warnings: []
          };
        }
        return api.createAudioProcessingPlan(metadata, rules);
      },
      resolveConfirmation: (plan, confirmation) => api.resolveAudioConfirmation(plan, confirmation),
      process: (file, plan, processOptions = {}) => {
        stats.process += 1;
        if (selectedMode === 'cancel' || selectedMode === 'detach') {
          return new Promise((resolve, reject) => {
            processOptions.signal?.addEventListener?.('abort', () => {
              stats.aborted += 1;
              reject(Object.assign(new Error('cancelled'), { code: 'AUDIO_PROCESSING_CANCELLED' }));
            }, { once: true });
            processOptions.onProgress?.({ phase: 'encode', ratio: 0.3, processedMs: 150, totalMs: 500 });
            globalThis.__syntheticAudio.resolve = resolve;
          });
        }
        const output = new File(['synthetic-output'], 'processed-audio.mp3', { type: 'audio/mpeg' });
        const metadata = {
          mediaKind: 'audio', mime: 'audio/mpeg', fileType: 'audio/mpeg', signatureMime: 'audio/mpeg',
          container: 'mp3', codec: 'mp3', size: output.size, durationMs: 500, sampleRate: 44100,
          channels: 1, averageBitrate: 64_000, audioOffset: 0, frameCount: 3, errorCode: null, warnings: []
        };
        processOptions.onProgress?.({ phase: 'encode', ratio: 0.5, processedMs: 250, totalMs: 500 });
        return Promise.resolve({ file: output, metadata, validation: { valid: true, violations: [] },
          operations: ['TRANSCODE_AUDIO'], durationMs: 1, outputBytes: output.size, inputBytesRead: file.size,
          encodePasses: 1, workerUsed: true, warnings: [], passthrough: false });
      },
      validateOutput: (metadata, rules, plan, source, validateOptions = {}) => api.validateAudioOutput(
        metadata, rules, plan, source, { ...validateOptions, allowUninspectedFrames: true, allowSingleFrame: true }
      ),
      dispose: () => {}
    };
    const imageHandler = {
      kind: 'image',
      supports: (file, context) => context?.mediaKind === 'image' && file?.type === 'image/jpeg',
      inspect: async (file) => ({ mediaKind: 'image', mime: file.type, signatureMime: file.type,
        size: file.size, width: 390, height: 567, displayWidth: 390, displayHeight: 567, errorCode: null }),
      validate: () => ({ valid: false, violations: [{ code: 'FILE_TOO_LARGE' }], warnings: [], safeAutoFixes: [], requiredConfirmations: [], unfixable: [] }),
      plan: () => ({ mediaKind: 'image', executable: true, passthrough: false, operations: ['CONVERT'], confirmations: [], unfixable: [], warnings: [] }),
      resolveConfirmation: (plan) => plan,
      process: async (file) => {
        stats.imageProcess += 1;
        const output = new File(['image-output'], 'processed.jpg', { type: 'image/jpeg' });
        return { file: output, metadata: { mime: 'image/jpeg', size: output.size, width: 390, height: 567 },
          operations: ['CONVERT'], validation: { valid: true, violations: [] }, warnings: [] };
      },
      validateOutput: () => ({ valid: true, violations: [], warnings: [] }),
      dispose: () => {}
    };
    const loggerEntries = [];
    const logger = {
      emit(event, fields = {}) { loggerEntries.push({ event, ...fields }); return true; },
      getEntries() { return loggerEntries.slice(); },
      clear() { loggerEntries.length = 0; }
    };
    const controller = api.createTaskController({
      documentRef: document, globalRef: window,
      audioHandler,
      imageHandler,
      logger,
      parseRulesFn: (bundle) => [bundle?.attributes?.accept?.includes('audio') ? audioRules : imageRules],
      resolveRulesFn: (candidates) => candidates[0]
    });
    controller.registerUploader({ input, uploaderId: 'synthetic-audio-uploader', label: '音频', mediaKind: 'audio', acceptTokens: ['audio/mpeg'], multiple: false, nearbyTexts: ['MP3 最大 250KB'], alertTexts: [] });
    if (imageInput) controller.registerUploader({ input: imageInput, uploaderId: 'synthetic-image-uploader', label: '图片', mediaKind: 'image', acceptTokens: ['image/jpeg'], multiple: false, nearbyTexts: ['JPG'], alertTexts: [] });
    controller.start();
    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('button,[type="submit"],[role="button"],a')) stats.submitClicks += 1;
    }, true);
    globalThis.__syntheticAudio = { api, controller, input, imageInput, wrapper, error, stats, logger, resolve: null };
  }, { selectedMode: mode, withImage: Boolean(options.withImage) });
}

async function selectFile(page, type = 'audio/wav', name = 'secret-source.wav', bytes = 44) {
  await page.evaluate(({ fileType, fileName, size }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(size)], fileName, { type: fileType }));
    __syntheticAudio.input.files = transfer.files;
    __syntheticAudio.input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }, { fileType: type, fileName: name, size: bytes });
}

async function waitFor(page, predicate, timeout = 20_000) {
  await expect.poll(() => page.evaluate(predicate), { timeout }).toBe(true);
}

test('V2-S3 unsupported MP3/M4A and duration constraints stop before process', async ({ page }) => {
  await open(page);
  for (const [mode, type, name] of [
    ['over-limit', 'audio/mpeg', 'secret-over-limit.mp3'],
    ['m4a', 'audio/mp4', 'secret-source.m4a'],
    ['no-max', 'audio/wav', 'secret-no-max.wav'],
    ['no-mp3', 'audio/wav', 'secret-no-mp3.wav'],
    ['duration', 'audio/wav', 'secret-long.wav']
  ]) {
    await installSynthetic(page, mode);
    await selectFile(page, type, name, mode === 'over-limit' ? 300_000 : 100);
    await waitFor(page, () => __syntheticAudio.controller.getSnapshot().activeTask?.status === 'STOPPED');
    const result = await page.evaluate(() => ({
      errorCode: __syntheticAudio.controller.getSnapshot().activeTask?.errorCode,
      process: __syntheticAudio.stats.process,
      entries: __syntheticAudio.logger.getEntries()
    }));
    expect(result.errorCode).toBe(
      mode === 'duration'
        ? 'AUDIO_DURATION_LIMIT_UNFIXABLE'
        : mode === 'no-max'
          ? 'RULES_INSUFFICIENT'
          : mode === 'no-mp3'
            ? 'AUDIO_OUTPUT_FORMAT_NOT_ALLOWED'
            : 'AUDIO_CODEC_UNSUPPORTED'
    );
    expect(result.process).toBe(0);
    expect(result.entries.some((entry) => entry.event === 'AUDIO_PROCESSING_STARTED')).toBe(false);
    await page.evaluate(() => __syntheticAudio.controller.dispose());
  }
});

test('V2-S3 confirmation decline keeps original audio and performs no worker work', async ({ page }) => {
  await open(page);
  await installSynthetic(page, 'wav');
  await selectFile(page);
  await waitFor(page, () => __syntheticAudio.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
  const pending = await page.evaluate(() => __syntheticAudio.controller.getSnapshot().activeTask.plan.confirmations[0]);
  await page.evaluate((confirmation) => {
    const task = __syntheticAudio.controller.getSnapshot().activeTask;
    return __syntheticAudio.controller.confirmTask(task.taskId, {
      id: confirmation.id, type: confirmation.type, accepted: false, payload: confirmation.suggestedPayload
    });
  }, pending);
  await waitFor(page, () => __syntheticAudio.controller.getSnapshot().activeTask?.status === 'STOPPED');
  const result = await page.evaluate(() => ({
    errorCode: __syntheticAudio.controller.getSnapshot().activeTask.errorCode,
    type: __syntheticAudio.input.files[0].type,
    process: __syntheticAudio.stats.process
  }));
  expect(result.errorCode).toBe('USER_CANCELLED');
  expect(result.type).toBe('audio/wav');
  expect(result.process).toBe(0);
  await page.evaluate(() => __syntheticAudio.controller.dispose());
});

test('V2-S3 cancellation and input detach abort the active audio operation', async ({ page }) => {
  await open(page);
  for (const mode of ['cancel', 'detach']) {
    await installSynthetic(page, mode);
    await selectFile(page);
    await waitFor(page, () => __syntheticAudio.controller.getSnapshot().activeTask?.status === 'PROCESSING');
    if (mode === 'cancel') {
      await page.evaluate(() => __syntheticAudio.controller.cancelTask(__syntheticAudio.controller.getSnapshot().activeTask.taskId));
    } else {
      await page.evaluate(() => __syntheticAudio.controller.unregisterUploader(__syntheticAudio.input));
    }
    await waitFor(page, () => __syntheticAudio.controller.getSnapshot().activeTask?.status === 'STOPPED');
    const result = await page.evaluate(() => ({
      errorCode: __syntheticAudio.controller.getSnapshot().activeTask.errorCode,
      aborted: __syntheticAudio.stats.aborted,
      file: __syntheticAudio.input.files[0]?.type ?? null
    }));
    expect(result.errorCode).toBe(mode === 'cancel' ? 'USER_CANCELLED' : 'INPUT_DETACHED');
    expect(result.aborted).toBe(1);
    expect(result.file).toBe('audio/wav');
    await page.evaluate(() => __syntheticAudio.controller.dispose());
  }
});

test('V2-S3 injection rollback leaves a downloadable processed result and restores the original input', async ({ page }) => {
  await open(page);
  await installSynthetic(page, 'rollback');
  await page.evaluate(() => {
    const originalInject = __syntheticAudio.api.injectFile;
    const controller = __syntheticAudio.controller;
    controller.injectFile = (element, file, options = {}) => {
      __syntheticAudio.stats.injectReasons.push(options.reason);
      if (options.reason === 'processed') return { ok: false, inputFilesVerified: false, errorCode: 'DATATRANSFER_UNAVAILABLE' };
      return originalInject(element, file, { ...options, dispatchEvents: false });
    };
  });
  await selectFile(page);
  await waitFor(page, () => __syntheticAudio.controller.getSnapshot().activeTask?.status === 'STOPPED');
  const result = await page.evaluate(() => {
    const task = __syntheticAudio.controller.getSnapshot().activeTask;
    const output = __syntheticAudio.controller.getTaskOutput(task.taskId);
    return {
      code: task.errorCode,
      originalType: __syntheticAudio.input.files[0]?.type,
      outputType: output?.file?.type ?? null,
      reasons: __syntheticAudio.stats.injectReasons
    };
  });
  expect(result.code).toBe('DATATRANSFER_UNAVAILABLE');
  expect(result.originalType).toBe('audio/wav');
  expect(result.outputType).toBe('audio/mpeg');
  expect(result.reasons).toEqual(['processed', 'restore']);
  await page.evaluate(() => __syntheticAudio.controller.dispose());
});

test('V2-S3 related rejection retries once, keeps media isolation, and redacts names from snapshot/logs', async ({ page }) => {
  await open(page);
  await installSynthetic(page, 'retry', { withImage: true });
  await selectFile(page, 'audio/wav', 'private-audio-name.wav');
  await waitFor(page, () => __syntheticAudio.controller.getSnapshot().activeTask?.status === 'SUCCESS');
  await page.evaluate(() => { __syntheticAudio.error.textContent = '格式不符合：仅支持 MP3，最大 250KB'; });
  await waitFor(page, () => {
    const task = __syntheticAudio.controller.getSnapshot().activeTask;
    return task?.status === 'SUCCESS' && task.retryCount === 1 && __syntheticAudio.stats.process === 2;
  });
  const result = await page.evaluate(() => ({
    task: __syntheticAudio.controller.getSnapshot().activeTask,
    logs: __syntheticAudio.logger.getEntries(),
    snapshot: JSON.stringify(__syntheticAudio.controller.getSnapshot()),
    imageProcess: __syntheticAudio.stats.imageProcess,
    clickCount: [...__syntheticAudio.controller.tasks.values()].find((task) => task.taskId === __syntheticAudio.controller.getSnapshot().activeTask.taskId)?.businessClickCount
  }));
  expect(result.task.retryCount).toBe(1);
  expect(result.imageProcess).toBe(0);
  expect(result.clickCount).toBe(0);
  expect(result.snapshot).not.toContain('private-audio-name.wav');
  expect(JSON.stringify(result.logs)).not.toContain('private-audio-name.wav');
  expect(result.logs.some((entry) => entry.event === 'AUDIO_PROCESSING_PROGRESS')).toBe(true);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(100)], 'private-image.jpg', { type: 'image/jpeg' }));
    __syntheticAudio.imageInput.files = transfer.files;
    __syntheticAudio.imageInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await waitFor(page, () => __syntheticAudio.stats.imageProcess === 1);
  expect(await page.evaluate(() => __syntheticAudio.stats.process)).toBe(2);
  await page.evaluate(() => __syntheticAudio.controller.dispose());
});
