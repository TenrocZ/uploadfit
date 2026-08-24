import { expect, test } from '@playwright/test';

/*
 * V2-S4's scenario matrix deliberately stays small and deterministic.  The
 * S3 page tests exercise the production IIFE; this file exercises the same
 * public debug API in a browser so that the QA assertions can name each S4
 * case without adding another production code path.
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

async function install(page, ruleSet = rules()) {
  await page.evaluate((configuredRules) => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mpeg';
    input.setAttribute('aria-label', '录音转写 MP3');
    document.body.append(input);

    const NativeWorker = window.Worker;
    let workerStarts = 0;
    if (typeof NativeWorker === 'function') {
      window.Worker = class CountingWorker extends NativeWorker {
        constructor(...args) {
          workerStarts += 1;
          super(...args);
        }
      };
    }

    const controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      parseRulesFn: () => [],
      resolveRulesFn: () => configuredRules
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
      NativeWorker
    };
  }, ruleSet);
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
      const bytes = new Uint8Array(64);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, bytes.length, false);
      ascii(bytes, 4, 'ftyp'); ascii(bytes, 8, 'M4A '); ascii(bytes, 16, 'M4A ');
      return new File([bytes], 'voice.m4a', { type: 'audio/mp4' });
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
  test('A01 compliant MP3 is passthrough with identity and no Worker', async ({ page }) => {
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

  test('A02 over-limit MP3 and A04 M4A/AAC stop as codec unsupported before Worker', async ({ page }) => {
    await open(page);
    for (const source of [
      { kind: 'mp3', metadata: { signatureMime: 'audio/mpeg', container: 'mp3', codec: 'mp3', size: 300_001 } },
      { kind: 'm4a', metadata: { signatureMime: 'audio/mp4', container: 'mp4', codec: 'aac-lc', size: 64 } }
    ]) {
      const result = await page.evaluate(({ sourceMetadata }) => {
        const api = __uploadfit_debug_bundle__;
        const metadata = {
          mediaKind: 'audio', fileType: sourceMetadata.signatureMime,
          durationMs: 120_000, sampleRate: 44_100, channels: 2, bitDepth: null,
          averageBitrate: 128_000, variableBitrate: false, seekable: true,
          inspectedBytes: 64, errorCode: null, warnings: [], ...sourceMetadata
        };
        const plan = api.createAudioProcessingPlan(metadata, {
          mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 250_000
        });
        return {
          executable: plan.executable,
          passthrough: plan.passthrough,
          confirmations: plan.confirmations.length,
          stops: plan.unfixable
        };
      }, { sourceMetadata: source.metadata });
      expect(result.executable).toBe(false);
      expect(result.passthrough).toBe(false);
      expect(result.confirmations).toBe(0);
      expect(result.stops).toContain('AUDIO_CODEC_UNSUPPORTED');
    }
  });

  test('A03 PCM WAV 16/24/32-bit mono/stereo converts through Worker and validates MP3', async ({ page }) => {
    await open(page);
    for (const bitDepth of [16, 24, 32]) {
      for (const channels of [1, 2]) {
        await install(page);
        await select(page, 'wav', { seconds: 0.6, bitDepth, channels });
        await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'NEEDS_CONFIRMATION');
        await confirm(page, true);
        await waitFor(page, () => __v2S4.controller.getSnapshot().activeTask?.status === 'SUCCESS');
        const result = await page.evaluate(() => ({
          task: __v2S4.controller.getSnapshot().activeTask,
          file: { type: __v2S4.input.files[0]?.type, size: __v2S4.input.files[0]?.size },
          workerStarts: __v2S4.workerStarts
        }));
        expect(result.file.type).toBe('audio/mpeg');
        expect(result.file.size).toBeGreaterThan(0);
        expect(result.file.size).toBeLessThanOrEqual(250_000);
        expect(result.task.result.workerUsed).toBe(true);
        expect(result.task.result.encodePasses).toBeLessThanOrEqual(2);
        expect(result.workerStarts).toBe(1);
        await dispose(page);
      }
    }
  });

  test('A05 missing maxBytes, A06 disallowed MP3, A07 duration-only and A08 unsafe target stop', async ({ page }) => {
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

  test('A09 decline keeps original; A10 mono is an independent confirmation', async ({ page }) => {
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

  test('A11 cancellation and A12 input detach stop within the lifecycle boundary', async ({ page }) => {
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

  test('A13 first oversized output gets one lower-rate pass; A14 second oversized output stops', async ({ page }) => {
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

  test('A15 only a strictly tighter rejection can retry; A16 ambiguous/official rules never process', async ({ page }) => {
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

  test('A17 DataTransfer failure returns a fallback; A18 dispose is idempotent and prevents stale work', async ({ page }) => {
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
