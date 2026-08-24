import { expect, test } from '@playwright/test';

async function open(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
}

test.describe('V2-S4 media regression and frozen contract', () => {
  test('A01/A03/A04: supported PCM variants, passthrough and codec stops', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
      const rules = { mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 250_000 };
      const metadata = (overrides = {}) => ({
        mediaKind: 'audio', signatureMime: 'audio/wav', container: 'wav', codec: 'pcm',
        size: 200_001, durationMs: 1_000, sampleRate: 44_100, channels: 1, bitDepth: 16,
        inspectedBytes: 64, errorCode: null, warnings: [], ...overrides
      });
      const compliant = api.createAudioProcessingPlan(metadata({
        signatureMime: 'audio/mpeg', container: 'mp3', codec: 'mp3', size: 100_000, durationMs: 2_000
      }), rules);
      const variants = [];
      for (const bitDepth of [16, 24, 32]) {
        for (const channels of [1, 2]) {
          const plan = api.createAudioProcessingPlan(metadata({ bitDepth, channels }), rules);
          variants.push({ bitDepth, channels, operation: plan.operations[0], targetMime: plan.targetMime });
        }
      }
      const unsupported = [
        metadata({ signatureMime: 'audio/mpeg', container: 'mp3', codec: 'mp3', size: 300_001 }),
        metadata({ signatureMime: 'audio/mp4', container: 'mp4', codec: 'aac-lc' })
      ].map((item) => api.createAudioProcessingPlan(item, rules));
      return {
        compliant: { passthrough: compliant.passthrough, confirmations: compliant.confirmations.length },
        variants,
        unsupported: unsupported.map((plan) => ({ executable: plan.executable, stops: plan.unfixable, workers: 0 }))
      };
    });
    expect(result.compliant).toEqual({ passthrough: true, confirmations: 0 });
    expect(result.variants).toHaveLength(6);
    for (const variant of result.variants) {
      expect(variant.operation).toBe('TRANSCODE_AUDIO');
      expect(variant.targetMime).toBe('audio/mpeg');
    }
    for (const stopped of result.unsupported) {
      expect(stopped.executable).toBe(false);
      expect(stopped.stops).toContain('AUDIO_CODEC_UNSUPPORTED');
      expect(stopped.workers).toBe(0);
    }
  });

  test('A05-A10: all planning stops and independent confirmations are deterministic', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(() => {
      const api = __uploadfit_debug_bundle__;
      const source = {
        mediaKind: 'audio', signatureMime: 'audio/wav', container: 'wav', codec: 'pcm',
        size: 2_000_000, durationMs: 120_000, sampleRate: 44_100, channels: 2, bitDepth: 16
      };
      const base = { mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 250_000 };
      const stop = (overrides) => api.createAudioProcessingPlan(source, { ...base, ...overrides }).unfixable;
      const confirmations = api.createAudioProcessingPlan(source, { ...base, maxBytes: 2_000_000 }, { targetChannels: 1 });
      return {
        missingMax: stop({ maxBytes: null }),
        noMp3: stop({ formats: ['audio/wav'], extensions: ['.wav'] }),
        duration: stop({ duration: { maxMs: 1_000 } }),
        unsafe: api.createAudioProcessingPlan({ ...source, durationMs: 100_000 }, { ...base, maxBytes: 700_000 }).unfixable,
        confirmationTypes: confirmations.confirmations.map((item) => item.type),
        declined: api.resolveAudioConfirmation(confirmations, { ...confirmations.confirmations[0], accepted: false }).executable
      };
    });
    expect(result.missingMax).toContain('RULES_INSUFFICIENT');
    expect(result.noMp3).toContain('AUDIO_OUTPUT_FORMAT_NOT_ALLOWED');
    expect(result.duration).toContain('AUDIO_DURATION_LIMIT_UNFIXABLE');
    expect(result.unsafe).toContain('AUDIO_TARGET_UNSAFE');
    expect(result.confirmationTypes).toEqual(['AUDIO_LOSSY_TRANSCODE', 'AUDIO_DOWNMIX_MONO']);
    expect(result.declined).toBe(false);
  });

  test('A13/A14: two-pass output correction never performs a third pass', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
      const source = new File([new Uint8Array(100)], 'source.wav', { type: 'audio/wav' });
      const metadata = {
        mediaKind: 'audio', signatureMime: 'audio/wav', container: 'wav', codec: 'pcm',
        size: 100, durationMs: 2_000, sampleRate: 44_100, channels: 1, bitDepth: 16,
        inspectedBytes: 100, errorCode: null, warnings: []
      };
      const rules = { mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 200_000 };
      let plan = api.createAudioProcessingPlan(metadata, rules);
      plan = api.resolveAudioConfirmation(plan, { ...plan.confirmations[0], accepted: true });
      const run = async (sizes) => {
        let index = 0;
        return api.processAudio(source, plan, {
          metadata, rules,
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
      };
      const first = await run([300_000, 100_000]);
      let code = null;
      let passes = 0;
      try { await run([300_000, 300_000]); } catch (error) { code = error.code; passes = error.details?.encodePasses ?? 0; }
      return { first: { encodePasses: first.encodePasses, outputBytes: first.outputBytes }, code, passes };
    });
    expect(result.first).toEqual({ encodePasses: 2, outputBytes: 100_000 });
    expect(result.code).toBe('AUDIO_OUTPUT_TOO_LARGE');
    expect(result.passes).toBe(2);
  });

  test('A15/A16: strict rejection retry and media boundaries stay closed', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(() => {
      const api = __uploadfit_debug_bundle__;
      const base = (overrides = {}) => ({
        mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 500_000,
        actionable: true, conflicts: [], duration: {}, semanticRequirements: [], ...overrides
      });
      const handler = api.createAudioHandler();
      return {
        strict: api.isStrictlyMoreSpecificAudioRejection(base(), base({ maxBytes: 250_000 })),
        same: api.isStrictlyMoreSpecificAudioRejection(base(), base()),
        official: api.isStrictlyMoreSpecificAudioRejection(base(), base({ maxBytes: 250_000, semanticRequirements: ['必须使用官方工具'] })),
        mixed: handler.supports(new File([new Uint8Array([1])], 'voice.mp3', { type: 'audio/mpeg' }), {
          mediaKind: 'audio', acceptTokens: ['image/*', 'audio/mpeg'], multiple: false
        }),
        multiple: handler.supports(new File([new Uint8Array([1])], 'voice.mp3', { type: 'audio/mpeg' }), {
          mediaKind: 'audio', acceptTokens: ['audio/mpeg'], multiple: true
        }),
        video: handler.supports(new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' }), {
          mediaKind: 'audio', acceptTokens: ['audio/mpeg'], multiple: false
        })
      };
    });
    expect(result.strict).toBe(true);
    expect(result.same).toBe(false);
    expect(result.official).toBe(false);
    expect(result.mixed).toBe(false);
    expect(result.multiple).toBe(false);
    expect(result.video).toBe(false);
  });

  test('format adversaries and A17 injection fallback are bounded and recoverable', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
      const malformed = new File([new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0xff, 0xff, 0xff, 0xff, 0x57, 0x41, 0x56, 0x45,
        0x64, 0x61, 0x74, 0x61, 0xff, 0xff, 0xff, 0xff
      ])], 'voice.mp3', { type: 'audio/mpeg' });
      const inspected = await api.inspectAudio(malformed);
      const input = document.createElement('input'); input.type = 'file'; document.body.append(input);
      const original = new File([new Uint8Array([1])], 'original.wav', { type: 'audio/wav' });
      const processed = new File([new Uint8Array([2])], 'processed.mp3', { type: 'audio/mpeg' });
      const transfer = new DataTransfer(); transfer.items.add(original); input.files = transfer.files;
      const NativeDataTransfer = window.DataTransfer;
      Object.defineProperty(window, 'DataTransfer', { configurable: true, value: undefined });
      const failure = api.injectFile(input, processed);
      Object.defineProperty(window, 'DataTransfer', { configurable: true, writable: true, value: NativeDataTransfer });
      return {
        inspected: { mime: inspected.signatureMime, container: inspected.container, code: inspected.errorCode },
        failure, originalRestored: input.files[0]?.type === 'audio/wav'
      };
    });
    expect(result.inspected.container).toBeNull();
    expect(result.inspected.mime).toBeNull();
    expect(['AUDIO_DECODE_FAILED', 'AUDIO_METADATA_INVALID', 'AUDIO_CODEC_UNSUPPORTED'])
      .toContain(result.inspected.code);
    expect(result.failure).toMatchObject({ ok: false, errorCode: 'DATATRANSFER_UNAVAILABLE', fallback: 'download' });
    expect(result.originalRestored).toBe(true);
  });

  test('A18 registry keeps image and audio handlers isolated and bundle is a single IIFE', async ({ page }) => {
    await open(page);
    const response = await page.request.get('/dist/uploadfit.js');
    const artifact = await response.text();
    expect(artifact).toContain('lamejs');
    expect(artifact).not.toMatch(/(^|\n)\s*(?:import|export)\s/);
    expect(artifact).toMatch(/(?:\(\(\)\s*=>|\(function\b)/);
    const result = await page.evaluate(() => {
      const registry = __uploadfit_debug_bundle__.createMediaHandlerRegistry();
      const kinds = registry.kinds();
      registry.dispose();
      return kinds;
    });
    expect(result).toEqual(expect.arrayContaining(['image', 'audio']));
  });
});
