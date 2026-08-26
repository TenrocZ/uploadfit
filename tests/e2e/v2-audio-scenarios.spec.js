import { expect, test } from '@playwright/test';

/*
 * Phase-1 evidence is provenance-labelled. These scenarios use the debug
 * bundle in a local page, but the controller paths use the real audio
 * handler/Worker and real File/DataTransfer objects. Plan-only and fake
 * runtime tests never claim production or Tabbit coverage.
 */

function rules(overrides = {}) {
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

async function install(page, ruleSet = rules(), options = {}) {
  await page.evaluate(({ configuredRules, forceMono }) => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mpeg';
    input.setAttribute('aria-label', '录音转写 MP3');
    document.body.append(input);

    const NativeWorker = window.Worker;
    let workerStarts = 0;
    let activeWorkers = 0;
    let maxActiveWorkers = 0;
    if (typeof NativeWorker === 'function') {
      window.Worker = class CountingWorker extends NativeWorker {
        constructor(...args) {
          workerStarts += 1;
          activeWorkers += 1;
          maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
          super(...args);
        }

        terminate(...args) {
          activeWorkers = Math.max(0, activeWorkers - 1);
          return super.terminate(...args);
        }
      };
    }

    const loggerEntries = [];
    const logger = {
      emit(event, fields = {}) {
        loggerEntries.push({ event, ...fields });
        return true;
      },
      getEntries() { return loggerEntries.slice(); },
      clear() { loggerEntries.length = 0; }
    };
    const nativeInject = api.injectFile;
    let injectionCalls = 0;
    const injectionReasons = [];
    const injectFileFn = (inputElement, file, injectOptions = {}) => {
      injectionCalls += 1;
      injectionReasons.push(injectOptions.reason ?? null);
      return nativeInject(inputElement, file, injectOptions);
    };

    const nativeAudio = forceMono ? api.createAudioHandler() : null;
    const audioHandler = nativeAudio ? {
      kind: 'audio',
      supports: (...args) => nativeAudio.supports(...args),
      inspect: (...args) => nativeAudio.inspect(...args),
      validate: (...args) => nativeAudio.validate(...args),
      plan: (metadata, audioRules, planOptions = {}) => api.createAudioProcessingPlan(
        metadata,
        audioRules,
        { ...planOptions, targetChannels: 1 }
      ),
      resolveConfirmation: (...args) => nativeAudio.resolveConfirmation(...args),
      process: (...args) => nativeAudio.process(...args),
      validateOutput: (...args) => nativeAudio.validateOutput(...args),
      dispose: () => nativeAudio.dispose()
    } : undefined;
    const controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      parseRulesFn: () => [],
      resolveRulesFn: () => configuredRules,
      logger,
      injectFileFn,
      ...(audioHandler ? { audioHandler } : {})
    });
    controller.registerUploader({
      input,
      uploaderId: 'v2-s4-audio-uploader',
      label: '录音转写',
      mediaKind: 'audio',
      acceptTokens: ['audio/mpeg'],
      multiple: false,
      nearbyTexts: ['MP3 最大 250KB'],
      alertTexts: []
    });
    controller.start();
    globalThis.__v2S4 = {
      api,
      input,
      controller,
      get workerStarts() { return workerStarts; },
      get activeWorkers() { return activeWorkers; },
      get maxActiveWorkers() { return maxActiveWorkers; },
      get injectionCalls() { return injectionCalls; },
      injectionReasons,
      logger,
      configuredRules,
      NativeWorker
    };
  }, {
    configuredRules: ruleSet,
    forceMono: options.forceMono === true,
  });
}

async function select(page, kind, options = {}) {
  await page.evaluate(({ sourceKind, seconds, channels, bitDepth, frameCount, bitrateIndex }) => {
    const ascii = (bytes, offset, text) => {
      for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
    };
    const wav = () => {
      const sampleRate = 44_100;
      const frames = Math.max(1, Math.round(sampleRate * seconds));
      const bytesPerSample = bitDepth / 8;
      const blockAlign = channels * bytesPerSample;
      const dataBytes = frames * blockAlign;
      const bytes = new Uint8Array(44 + dataBytes);
      const view = new DataView(bytes.buffer);
      ascii(bytes, 0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(bytes, 8, 'WAVE');
      ascii(bytes, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true);
      view.setUint16(34, bitDepth, true); ascii(bytes, 36, 'data'); view.setUint32(40, dataBytes, true);
      return new File([bytes], 'voice.wav', { type: 'audio/wav' });
    };
    const mp3 = () => {
      const bitrate = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bitrateIndex] ?? 128;
      const frameLength = Math.floor(144 * bitrate * 1000 / 44_100);
      const frame = new Uint8Array(frameLength);
      frame.set([0xff, 0xfb, bitrateIndex << 4, 0]);
      const bytes = new Uint8Array(frameLength * frameCount);
      for (let index = 0; index < frameCount; index += 1) bytes.set(frame, index * frameLength);
      return new File([bytes], 'voice.mp3', { type: 'audio/mpeg' });
    };
    const m4a = () => {
      const concat = (...parts) => {
        const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
        let offset = 0;
        for (const part of parts) { bytes.set(part, offset); offset += part.length; }
        return bytes;
      };
      const box = (type, payload) => {
        const bytes = new Uint8Array(8 + payload.length);
        const view = new DataView(bytes.buffer);
        view.setUint32(0, bytes.length, false);
        ascii(bytes, 4, type);
        bytes.set(payload, 8);
        return bytes;
      };
      const mdhdPayload = new Uint8Array(24);
      const mdhdView = new DataView(mdhdPayload.buffer);
      mdhdView.setUint32(12, 1000, false);
      mdhdView.setUint32(16, 2000, false);
      const frequencyIndex = 4;
      const asc = new Uint8Array([
        (2 << 3) | (frequencyIndex >> 1),
        ((frequencyIndex & 1) << 7) | (2 << 3)
      ]);
      const esds = new Uint8Array([
        0, 0, 0, 0, 0x03, 0x10, 0, 0, 0, 0, 0x04, 0x08, 0, 0, 0, 0,
        0x05, 0x02, asc[0], asc[1]
      ]);
      const samplePayload = new Uint8Array(28);
      const sampleView = new DataView(samplePayload.buffer);
      sampleView.setUint16(16, 2, false);
      sampleView.setUint16(18, 16, false);
      sampleView.setUint32(24, 44100 << 16, false);
      const sampleEntry = box('mp4a', concat(samplePayload, box('esds', esds)));
      const stsdPayload = new Uint8Array(8 + sampleEntry.length);
      new DataView(stsdPayload.buffer).setUint32(4, 1, false);
      stsdPayload.set(sampleEntry, 8);
      const stbl = box('stbl', box('stsd', stsdPayload));
      const moov = box('moov', box('trak', box('mdia', concat(
        box('mdhd', mdhdPayload),
        box('minf', stbl)
      ))));
      const ftyp = box('ftyp', concat(
        new TextEncoder().encode('M4A '),
        new Uint8Array([0, 0, 0, 0]),
        new TextEncoder().encode('M4A ')
      ));
      return new File([concat(ftyp, moov)], 'voice.m4a', { type: 'audio/mp4' });
    };
    const file = sourceKind === 'wav' ? wav() : sourceKind === 'mp3' ? mp3() : m4a();
    const transfer = new DataTransfer();
    transfer.items.add(file);
    __v2S4.originalFile = file;
    __v2S4.input.files = transfer.files;
    __v2S4.input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }, {
    sourceKind: kind,
    seconds: options.seconds ?? 1,
    channels: options.channels ?? 1,
    bitDepth: options.bitDepth ?? 16,
    frameCount: options.frameCount ?? 120,
    bitrateIndex: options.bitrateIndex ?? 9
  });
}

async function waitFor(page, predicate, timeout = 30_000) {
  await expect.poll(() => page.evaluate(predicate), { timeout }).toBe(true);
}

async function confirm(page, accepted = true) {
  const pending = await page.evaluate(() => {
    const task = __v2S4.controller.getSnapshot().activeTask;
    return task?.plan?.confirmations?.find((item) => item.required && !item.resolved) ?? null;
  });
  expect(pending).not.toBeNull();
  await page.evaluate(({ confirmation, accept }) => {
    const task = __v2S4.controller.getSnapshot().activeTask;
    __v2S4.controller.confirmTask(task.taskId, {
      id: confirmation.id,
      type: confirmation.type,
      accepted: accept,
      payload: confirmation.suggestedPayload
    });
  }, { confirmation: pending, accept: accepted });
}

async function dispose(page) {
  await page.evaluate(() => {
    try { __v2S4.controller.dispose(); } catch {}
    if (__v2S4.NativeWorker) window.Worker = __v2S4.NativeWorker;
  });
}

test.describe('V2-S4 A01-A18 audio QA matrix', () => {
  test('Q-S4-P01 [DEBUG_CONTROLLER_REAL_FILE] A02/A04 create confirmation-gated compressed plans', async ({ page }) => {
    await open(page);
    for (const source of [
      { kind: 'mp3', options: { frameCount: 330, bitrateIndex: 14 } },
      { kind: 'm4a', options: {} }
    ]) {
      await install(page);
      await select(page, source.kind, source.options);
      await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
      const result = await page.evaluate(() => {
        const task = __v2S4.controller.getSnapshot().activeTask;
        return {
          status: task?.status,
          errorCode: task?.errorCode,
          operations: task?.plan?.operations ?? [],
          confirmations: task?.plan?.confirmations?.map((item) => item.type) ?? [],
          sameFile: __v2S4.input.files[0] === __v2S4.originalFile,
          workerStarts: __v2S4.workerStarts,
          processStarts: __v2S4.logger.getEntries()
            .filter((entry) => entry.event === 'AUDIO_PROCESSING_STARTED').length,
          injectionCalls: __v2S4.injectionCalls,
          inputType: __v2S4.input.files[0]?.type ?? null
        };
      });
      expect(result.status).toBe('NEEDS_CONFIRMATION');
      expect(result.errorCode).toBeNull();
      expect(result.operations).toContain(source.kind === 'mp3' ? 'REENCODE_AUDIO' : 'TRANSCODE_AUDIO');
      expect(result.confirmations).toContain('AUDIO_LOSSY_TRANSCODE');
      expect(result.sameFile).toBe(true);
      expect(result.workerStarts).toBe(0);
      expect(result.processStarts).toBe(0);
      expect(result.injectionCalls).toBe(0);
      expect(result.inputType).toBe(source.kind === 'mp3' ? 'audio/mpeg' : 'audio/mp4');
      await confirm(page, false);
      await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'STOPPED');
      await dispose(page);
    }
  });

  test('Q-S4-P02 [DEBUG_CONTROLLER_REAL_FILE] A10 accepts lossy then rejects mono without processing', async ({ page }) => {
    await open(page);
    await install(page, rules({ maxBytes: 2_000_000 }), { forceMono: true });
    await select(page, 'wav', { seconds: 1, channels: 2, bitDepth: 16 });
    await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
    const first = await page.evaluate(() => __v2S4.controller.getSnapshot().activeTask.plan.confirmations
      .find((item) => item.required && !item.resolved)?.type);
    expect(first).toBe('AUDIO_LOSSY_TRANSCODE');
    await confirm(page, true);
    await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
    const second = await page.evaluate(() => __v2S4.controller.getSnapshot().activeTask.plan.confirmations
      .find((item) => item.required && !item.resolved)?.type);
    expect(second).toBe('AUDIO_DOWNMIX_MONO');
    await confirm(page, false);
    await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'STOPPED');
    const result = await page.evaluate(() => ({
      status: __v2S4.controller.getSnapshot().activeTask?.status,
      errorCode: __v2S4.controller.getSnapshot().activeTask?.errorCode,
      sameFile: __v2S4.input.files[0] === __v2S4.originalFile,
      inputType: __v2S4.input.files[0]?.type ?? null,
      workerStarts: __v2S4.workerStarts,
      processStarts: __v2S4.logger.getEntries()
        .filter((entry) => entry.event === 'AUDIO_PROCESSING_STARTED').length,
      injectionCalls: __v2S4.injectionCalls,
      processedInjectionCalls: __v2S4.injectionReasons.filter((reason) => reason === 'processed').length
    }));
    expect(result.status).toBe('STOPPED');
    expect(result.errorCode).toBe('USER_CANCELLED');
    expect(result.sameFile).toBe(true);
    expect(result.inputType).toBe('audio/wav');
    expect(result.workerStarts).toBe(0);
    expect(result.processStarts).toBe(0);
    expect(result.processedInjectionCalls).toBe(0);
    await dispose(page);
  });

  test('Q-S4-P03 [DEBUG_CONTROLLER_REAL_WORKER] A15 uses the real DOM rejection observer for one strict retry only', async ({ page }) => {
    await open(page);
    await install(page, rules({ maxBytes: 500_000 }));
    await page.evaluate(() => {
      const scope = document.createElement('form');
      scope.id = 'v2-s4-rejection-scope';
      const error = document.createElement('div');
      error.className = 'error';
      error.setAttribute('role', 'alert');
      scope.append(__v2S4.input, error);
      document.body.append(scope);
      __v2S4.rejectionNode = error;
    });
    await select(page, 'wav', { seconds: 0.6, channels: 1, bitDepth: 16 });
    await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
    await confirm(page, true);
    await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'SUCCESS');
    await page.evaluate(() => {
      __v2S4.controller.resolveRules = () => ({
        ...__v2S4.configuredRules,
        maxBytes: 250_000,
        sources: [{ type: 'nearby-text', priority: 500, confidence: 0.99, evidence: ['MP3 最大 250KB'] }]
      });
      __v2S4.rejectionNode.textContent = '文件大小不超过250KB';
    });
    await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
    await confirm(page, true);
    await waitFor(page, () => {
      const task = __v2S4.controller.getSnapshot().activeTask;
      return task?.status === 'SUCCESS' && task.retryCount === 1;
    });
    await page.evaluate(() => {
      __v2S4.rejectionNode.textContent = '文件大小不超过250KB（第二次拒收）';
    });
    await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'STOPPED');
    const result = await page.evaluate(() => {
      const task = __v2S4.controller.getSnapshot().activeTask;
      const entries = __v2S4.logger.getEntries();
      const internal = task ? __v2S4.controller.tasks.get(task.taskId) : null;
      return {
        status: task?.status,
        errorCode: task?.errorCode,
        retryCount: task?.retryCount,
        processingStarts: entries.filter((entry) => entry.event === 'AUDIO_PROCESSING_STARTED').length,
        workerStarts: __v2S4.workerStarts,
        retryEvents: entries.filter((entry) => entry.event === 'RETRY_TRIGGERED').length,
        rejectionEvents: entries.filter((entry) => entry.event === 'REJECTION_DETECTED').length,
        rejectionNodeText: __v2S4.rejectionNode?.textContent ?? null,
        businessClicks: internal?.businessClickCount ?? null,
        submitEvents: entries.filter((entry) => /SUBMIT|BUSINESS/.test(entry.event)).length
      };
    });
    expect(result.status).toBe('STOPPED');
    expect(result.errorCode).toBe('PROCESSING_FAILED');
    expect(result.retryCount).toBe(1);
    expect(result.processingStarts).toBe(2);
    expect(result.workerStarts).toBe(4);
    expect(result.retryEvents).toBe(1);
    expect(result.rejectionEvents).toBe(1);
    expect(result.rejectionNodeText).toContain('第二次拒收');
    expect(result.businessClicks).toBe(0);
    expect(result.submitEvents).toBe(0);
    await dispose(page);
  });

  test('Q-S4-P04 [DEBUG_CONTROLLER_REAL_FILE] A16 safety and ambiguity stops preserve distinct error codes', async ({ page }) => {
    await open(page);
    const cases = [
      { name: 'ambiguous', override: { actionable: false, conflicts: [{ field: 'maxBytes', unresolvable: true }] }, code: 'RULE_CONFLICT' },
      { name: 'network', override: { actionable: false, safetyFlags: ['NETWORK_OR_TIMEOUT'] }, code: 'NETWORK_OR_TIMEOUT' },
      { name: 'permission', override: { actionable: false, safetyFlags: ['PERMISSION_OR_LOGIN'] }, code: 'PERMISSION_OR_LOGIN' },
      { name: 'official', override: { actionable: false, safetyFlags: ['OFFICIAL_TOOL_REQUIRED'] }, code: 'OFFICIAL_TOOL_REQUIRED' }
    ];
    for (const item of cases) {
      await install(page, rules(item.override));
      await select(page, 'wav', { seconds: 0.4, channels: 1, bitDepth: 16 });
      await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'STOPPED');
      const result = await page.evaluate(() => {
        const task = __v2S4.controller.getSnapshot().activeTask;
        return {
          status: task?.status,
          errorCode: task?.errorCode,
          sameFile: __v2S4.input.files[0] === __v2S4.originalFile,
          workerStarts: __v2S4.workerStarts,
          processStarts: __v2S4.logger.getEntries()
            .filter((entry) => entry.event === 'AUDIO_PROCESSING_STARTED').length,
          injectionCalls: __v2S4.injectionCalls
        };
      });
      expect(result.status, item.name).toBe('STOPPED');
      expect(result.errorCode, item.name).toBe(item.code);
      expect(result.sameFile, item.name).toBe(true);
      expect(result.workerStarts, item.name).toBe(0);
      expect(result.processStarts, item.name).toBe(0);
      expect(result.injectionCalls, item.name).toBe(0);
      await dispose(page);
    }
  });

  test('Q-S4-P05 [DEBUG_CONTROLLER_REAL_WORKER] A17 real DataTransfer failure rolls back and exposes download fallback', async ({ page }) => {
    await open(page);
    await install(page, rules({ maxBytes: 2_000_000 }));
    await select(page, 'wav', { seconds: 0.6, channels: 1, bitDepth: 16 });
    await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
    await page.evaluate(() => {
      const NativeDataTransfer = window.DataTransfer;
      let calls = 0;
      class FailOnceDataTransfer {
        constructor(...args) {
          calls += 1;
          if (calls === 1) throw new TypeError('controlled DataTransfer constructor failure');
          return new NativeDataTransfer(...args);
        }
      }
      Object.defineProperty(window, 'DataTransfer', {
        configurable: true,
        writable: true,
        value: FailOnceDataTransfer
      });
      __v2S4.NativeDataTransfer = NativeDataTransfer;
      __v2S4.dataTransferCalls = () => calls;
    });
    await confirm(page, true);
    await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'STOPPED');
    const result = await page.evaluate(() => {
      const snapshot = __v2S4.controller.getSnapshot();
      const task = snapshot.activeTask;
      const internal = task ? __v2S4.controller.tasks.get(task.taskId) : null;
      const entries = __v2S4.logger.getEntries();
      const dataTransferCalls = __v2S4.dataTransferCalls();
      Object.defineProperty(window, 'DataTransfer', {
        configurable: true,
        writable: true,
        value: __v2S4.NativeDataTransfer
      });
      return {
        status: task?.status,
        errorCode: task?.errorCode,
        injection: internal?.injection ?? null,
        sameFile: __v2S4.input.files[0] === __v2S4.originalFile,
        fileCount: __v2S4.input.files.length,
        injectionCalls: __v2S4.injectionCalls,
        injectionReasons: __v2S4.injectionReasons.slice(),
        dataTransferCalls,
        workerStarts: __v2S4.workerStarts,
        activeWorkers: __v2S4.activeWorkers,
        processingStarts: entries.filter((entry) => entry.event === 'AUDIO_PROCESSING_STARTED').length,
        submitEvents: entries.filter((entry) => /SUBMIT|BUSINESS/.test(entry.event)).length,
        cleanup: internal?.result?.cleanup ?? null,
        objectUrls: internal?.objectUrls?.length ?? null
      };
    });
    expect(result.status).toBe('STOPPED');
    expect(result.errorCode).toBe('DATATRANSFER_UNAVAILABLE');
    expect(result.injection).toMatchObject({ ok: false, fallback: 'download', errorCode: 'DATATRANSFER_UNAVAILABLE' });
    expect(result.sameFile).toBe(true);
    expect(result.fileCount).toBe(1);
    expect(result.injectionCalls).toBe(2);
    expect(result.injectionReasons).toEqual(['processed', 'restore']);
    expect(result.dataTransferCalls).toBe(2);
    expect(result.workerStarts).toBe(2);
    expect(result.activeWorkers).toBe(0);
    expect(result.processingStarts).toBe(1);
    expect(result.submitEvents).toBe(0);
    expect(result.cleanup).toMatchObject({ workerTerminated: true, objectUrlRevoked: true, queueCleared: true });
    expect(result.objectUrls).toBe(0);
    await dispose(page);
  });

  test('A01 [DEBUG_CONTROLLER_REAL_FILE] compliant MP3 is passthrough with identity and no Worker', async ({ page }) => {
    await open(page);
    await install(page);
    await select(page, 'mp3', { frameCount: 120, bitrateIndex: 9 });
    await waitFor(page, () => ['PASSTHROUGH', 'SUCCESS'].includes(__v2S4.controller.getSnapshot().activeTask?.status));
    const result = await page.evaluate(() => ({
      status: __v2S4.controller.getSnapshot().activeTask?.status,
      sameFile: __v2S4.input.files[0] === __v2S4.originalFile,
      workerStarts: __v2S4.workerStarts,
      bytes: __v2S4.input.files[0]?.size ?? 0,
      type: __v2S4.input.files[0]?.type ?? null
    }));
    expect(result.status).toBe('PASSTHROUGH');
    expect(result.sameFile).toBe(true);
    expect(result.workerStarts).toBe(0);
    expect(result.type).toBe('audio/mpeg');
    expect(result.bytes).toBeLessThanOrEqual(250_000);
    await dispose(page);
  });

  test('A02/A04 [DEBUG_PURE_PLAN] verified compressed sources require lossy confirmation', async ({ page }) => {
    await open(page);
    for (const source of [
      { kind: 'mp3', metadata: { signatureMime: 'audio/mpeg', container: 'mp3', codec: 'mp3', size: 300_001 } },
      { kind: 'm4a', metadata: { signatureMime: 'audio/mp4', container: 'mp4', codec: 'aac-lc', size: 64 } }
    ]) {
      const result = await page.evaluate(({ sourceMetadata }) => {
        const api = __uploadfit_debug_bundle__;
        const metadata = {
          mediaKind: 'audio', fileType: sourceMetadata.signatureMime,
          durationMs: 10_000, sampleRate: 44_100, channels: 2, bitDepth: null,
          averageBitrate: 128_000, variableBitrate: false, seekable: true,
          inspectedBytes: 64, errorCode: null, warnings: [], ...sourceMetadata
        };
        const plan = api.createAudioProcessingPlan(metadata, {
          mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 250_000
        });
        return {
          executable: plan.executable,
          passthrough: plan.passthrough,
          operations: plan.operations,
          confirmations: plan.confirmations.map((item) => item.type),
          stops: plan.unfixable
        };
      }, { sourceMetadata: source.metadata });
      expect(result.executable).toBe(false);
      expect(result.passthrough).toBe(false);
      expect(result.operations).toContain(source.kind === 'mp3' ? 'REENCODE_AUDIO' : 'TRANSCODE_AUDIO');
      expect(result.confirmations).toEqual(['AUDIO_LOSSY_TRANSCODE']);
      expect(result.stops).toEqual([]);
    }
  });

  test('A03 [DEBUG_CONTROLLER_REAL_WORKER] PCM WAV 16/24/32-bit mono/stereo converts through Worker and validates MP3', async ({ page }) => {
    await open(page);
    for (const bitDepth of [16, 24, 32]) {
      for (const channels of [1, 2]) {
        await install(page);
        await select(page, 'wav', { seconds: 0.6, bitDepth, channels });
        await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
        await confirm(page, true);
        await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'SUCCESS');
        const result = await page.evaluate(async () => {
          const task = __v2S4.controller.getSnapshot().activeTask;
          const internal = __v2S4.controller.tasks.get(task.taskId);
          const independentValidation = await __v2S4.api.validateAudioOutputFile(
            __v2S4.input.files[0],
            __v2S4.configuredRules,
            internal.plan,
            internal.metadata,
            { allowSingleFrame: true }
          );
          const outputMetadata = internal.result.metadata;
          const sourceDurationMs = internal.metadata.durationMs;
          const outputDurationMs = outputMetadata.durationMs;
          const durationToleranceMs = Math.max(250, sourceDurationMs * 0.02);
          return {
            task,
            file: { type: __v2S4.input.files[0]?.type, size: __v2S4.input.files[0]?.size },
            outputMetadata: {
              signatureMime: outputMetadata.signatureMime,
              container: outputMetadata.container,
              codec: outputMetadata.codec,
              durationMs: outputDurationMs
            },
            sourceDurationMs,
            outputDurationMs,
            durationToleranceMs,
            durationDeltaMs: Math.abs(outputDurationMs - sourceDurationMs),
            independentValidation: {
              valid: independentValidation.valid,
              frameValidation: independentValidation.frameValidation,
              representativeFrames: independentValidation.representativeFrames
                ?? independentValidation.frameValidation?.count
            },
            workerStarts: __v2S4.workerStarts
          };
        });
        expect(result.file.type).toBe('audio/mpeg');
        expect(result.file.size).toBeGreaterThan(0);
        expect(result.file.size).toBeLessThanOrEqual(250_000);
        expect(result.task.result.workerUsed).toBe(true);
        expect(result.task.result.encodePasses).toBeLessThanOrEqual(2);
        expect(result.outputMetadata.signatureMime).toBe('audio/mpeg');
        expect(result.outputMetadata.container).toBe('mp3');
        expect(result.outputMetadata.codec).toBe('mp3');
        expect(result.independentValidation.valid).toBe(true);
        expect(result.independentValidation.frameValidation.valid).toBe(true);
        expect(result.independentValidation.frameValidation.count).toBeGreaterThanOrEqual(2);
        expect(result.independentValidation.representativeFrames).toBeGreaterThanOrEqual(2);
        expect(result.durationDeltaMs).toBeLessThanOrEqual(result.durationToleranceMs);
        // Processing + pipeline output decode + explicit independent decode.
        expect(result.workerStarts).toBe(3);
        await dispose(page);
      }
    }
  });

  test('A05-A08 [DEBUG_CONTROLLER_REAL_FILE] missing/unsafe rules stop before Worker', async ({ page }) => {
    await open(page);
    const cases = [
      { name: 'A05', override: { maxBytes: null }, expected: 'RULES_INSUFFICIENT', seconds: 1 },
      { name: 'A06', override: { formats: ['audio/wav'], extensions: ['.wav'] }, expected: 'AUDIO_OUTPUT_FORMAT_NOT_ALLOWED', seconds: 1 },
      { name: 'A07', override: { duration: { exactMs: null, minMs: null, maxMs: 500 } }, expected: 'AUDIO_DURATION_LIMIT_UNFIXABLE', seconds: 1 },
      { name: 'A08', override: { maxBytes: 65_537 }, expected: 'AUDIO_TARGET_UNSAFE', seconds: 20 }
    ];
    for (const item of cases) {
      const configured = rules(item.override);
      await install(page, configured);
      await select(page, 'wav', { seconds: item.seconds });
      await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'STOPPED');
      const result = await page.evaluate(() => ({
        code: __v2S4.controller.getSnapshot().activeTask?.errorCode,
        workerStarts: __v2S4.workerStarts,
        type: __v2S4.input.files[0]?.type
      }));
      expect(result.code, item.name).toBe(item.expected);
      expect(result.workerStarts, item.name).toBe(0);
      expect(result.type, item.name).toBe('audio/wav');
      await dispose(page);
    }
  });

  test('A09 [DEBUG_CONTROLLER_REAL_FILE] decline keeps original; A10 plan confirmation shape is supplementary to Q-S4-P02', async ({ page }) => {
    await open(page);
    await install(page);
    await select(page, 'wav', { seconds: 1, channels: 1 });
    await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
    await confirm(page, false);
    await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'STOPPED');
    const declined = await page.evaluate(() => ({
      code: __v2S4.controller.getSnapshot().activeTask?.errorCode,
      type: __v2S4.input.files[0]?.type,
      workerStarts: __v2S4.workerStarts
    }));
    expect(declined.code).toBe('USER_CANCELLED');
    expect(declined.type).toBe('audio/wav');
    expect(declined.workerStarts).toBe(0);
    await dispose(page);

    const mono = await page.evaluate(() => {
      const api = __uploadfit_debug_bundle__;
      const metadata = {
        mediaKind: 'audio', signatureMime: 'audio/wav', container: 'wav', codec: 'pcm',
        size: 2_000_000, durationMs: 120_000, sampleRate: 44_100, channels: 2
      };
      const plan = api.createAudioProcessingPlan(metadata, {
        mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 2_000_000
      }, { targetChannels: 1 });
      return plan.confirmations.map((item) => item.type);
    });
    expect(mono).toEqual(['AUDIO_LOSSY_TRANSCODE', 'AUDIO_DOWNMIX_MONO']);
  });

  test('A11/A12 [DEBUG_CONTROLLER_REAL_WORKER] cancellation and input detach stop within the task boundary', async ({ page }) => {
    await open(page);
    for (const mode of ['cancel', 'detach']) {
      await install(page);
      await select(page, 'wav', { seconds: 18 });
      await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
      await confirm(page, true);
      await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'PROCESSING');
      const started = await page.evaluate(() => performance.now());
      if (mode === 'cancel') {
        await page.evaluate(() => __v2S4.controller.cancelTask(__v2S4.controller.getSnapshot().activeTask.taskId));
      } else {
        await page.evaluate(() => __v2S4.controller.unregisterUploader(__v2S4.input));
      }
      await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'STOPPED');
      const result = await page.evaluate((start) => ({
        code: __v2S4.controller.getSnapshot().activeTask?.errorCode,
        elapsedMs: performance.now() - start,
        type: __v2S4.input.files[0]?.type ?? null,
        workerStarts: __v2S4.workerStarts
      }), started);
      expect(result.code).toBe(mode === 'cancel' ? 'USER_CANCELLED' : 'INPUT_DETACHED');
      expect(result.elapsedMs).toBeLessThanOrEqual(1_000);
      expect(result.type).toBe('audio/wav');
      expect(result.workerStarts).toBe(1);
      await dispose(page);
    }
  });

  test('A13/A14 [DEBUG_FAKE_RUNTIME_BRANCH] algorithmic two-pass upper bound and second-pass stop', async ({ page }) => {
    await open(page);
    const outcomes = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
      const source = new File([new Uint8Array(100)], 'source.wav', { type: 'audio/wav' });
      const metadata = {
        mediaKind: 'audio', signatureMime: 'audio/wav', container: 'wav', codec: 'pcm',
        size: 100, durationMs: 2_000, sampleRate: 44_100, channels: 1,
        bitDepth: 16, inspectedBytes: 100, errorCode: null, warnings: []
      };
      const ruleset = { mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 200_000 };
      let plan = api.createAudioProcessingPlan(metadata, ruleset);
      plan = api.resolveAudioConfirmation(plan, { ...plan.confirmations[0], accepted: true });
      const run = async (sizes) => {
        let index = 0;
        const result = await api.processAudio(source, plan, {
          metadata,
          rules: ruleset,
          workerRuntime: {
            run: async () => ({
              blob: new Blob([new Uint8Array(sizes[index++])], { type: 'audio/mpeg' }),
              stats: { inputBytesRead: 100, peakBufferedBytes: 1_024, workerUsed: true }
            }),
            dispose() {}
          },
          inspectOutput: async (file) => ({ ...metadata, signatureMime: 'audio/mpeg', container: 'mp3', codec: 'mp3', size: file.size }),
          validateOutput: async () => ({ valid: true, violations: [], warnings: [] })
        });
        return { encodePasses: result.encodePasses, outputBytes: result.outputBytes };
      };
      const first = await run([300_000, 100_000]);
      let secondCode = null;
      let secondPasses = 0;
      try { await run([300_000, 300_000]); } catch (error) {
        secondCode = error.code;
        secondPasses = error.details?.encodePasses ?? 0;
      }
      return { first, secondCode, secondPasses };
    });
    expect(outcomes.first).toEqual({ encodePasses: 2, outputBytes: 100_000 });
    expect(outcomes.secondCode).toBe('AUDIO_OUTPUT_TOO_LARGE');
    expect(outcomes.secondPasses).toBe(2);
  });

  test('A15/A16 [DEBUG_PURE_PLAN] strict rejection predicate and safety boundaries (controller proof is Q-S4-P03/P04)', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(() => {
      const api = __uploadfit_debug_bundle__;
      const base = rules => ({
        mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'],
        maxBytes: 500_000, actionable: true, conflicts: [], duration: {}, semanticRequirements: [],
        ...rules
      });
      return {
        strict: api.isStrictlyMoreSpecificAudioRejection(base({}), base({ maxBytes: 250_000 })),
        same: api.isStrictlyMoreSpecificAudioRejection(base({}), base({ maxBytes: 500_000 })),
        official: api.isStrictlyMoreSpecificAudioRejection(base({}), base({ maxBytes: 250_000, semanticRequirements: ['必须使用官方工具'] })),
        mixedSupports: api.createAudioHandler().supports(
          new File([new Uint8Array([1])], 'x.mp3', { type: 'audio/mpeg' }),
          { mediaKind: 'audio', acceptTokens: ['image/*', 'audio/mpeg'], multiple: false }
        ),
        videoSupports: api.createAudioHandler().supports(
          new File([new Uint8Array([1])], 'x.mp4', { type: 'video/mp4' }),
          { mediaKind: 'audio', acceptTokens: ['audio/mpeg'], multiple: false }
        )
      };
    });
    expect(result.strict).toBe(true);
    expect(result.same).toBe(false);
    expect(result.official).toBe(false);
    expect(result.mixedSupports).toBe(false);
    expect(result.videoSupports).toBe(false);
  });

  test('A17 [DEBUG_PURE_PLAN] direct DataTransfer fallback; A18 idempotent dispose only (LR1/LR9 remain NOT_VERIFIED_PHASE_2)', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(() => {
      const api = __uploadfit_debug_bundle__;
      const input = document.createElement('input');
      input.type = 'file';
      document.body.append(input);
      const transfer = new DataTransfer();
      const original = new File([new Uint8Array([1])], 'original.wav', { type: 'audio/wav' });
      const processed = new File([new Uint8Array([2])], 'processed.mp3', { type: 'audio/mpeg' });
      transfer.items.add(original); input.files = transfer.files;
      const NativeDataTransfer = window.DataTransfer;
      Object.defineProperty(window, 'DataTransfer', { configurable: true, value: undefined });
      const failure = api.injectFile(input, processed);
      Object.defineProperty(window, 'DataTransfer', { configurable: true, writable: true, value: NativeDataTransfer });
      const restored = input.files[0]?.type === 'audio/wav';
      const controller = api.createTaskController({ documentRef: document, globalRef: window });
      controller.dispose(); controller.dispose();
      return { failure, restored, disposed: controller.getSnapshot().sessionState };
    });
    expect(result.failure).toMatchObject({ ok: false, errorCode: 'DATATRANSFER_UNAVAILABLE', fallback: 'download' });
    expect(result.restored).toBe(true);
    expect(result.disposed).toBe('DISPOSED');
  });
});
