import { expect, test } from '@playwright/test';

async function open(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
}

test.describe('V2-S4 media regression and S4.1 migration contract', () => {
  test('A01/A03/A04 [DEBUG_PURE_PLAN]: PCM variants, passthrough and compressed plans', async ({ page }) => {
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
      const compressed = [
        metadata({ signatureMime: 'audio/mpeg', container: 'mp3', codec: 'mp3', size: 300_001, durationMs: 10_000 }),
        metadata({ signatureMime: 'audio/mp4', container: 'mp4', codec: 'aac-lc', durationMs: 10_000 })
      ].map((item) => api.createAudioProcessingPlan(item, rules));
      return {
        compliant: { passthrough: compliant.passthrough, confirmations: compliant.confirmations.length },
        variants,
        compressed: compressed.map((plan) => ({
          executable: plan.executable,
          operations: plan.operations,
          confirmations: plan.confirmations.map((item) => item.type),
          stops: plan.unfixable
        }))
      };
    });
    expect(result.compliant).toEqual({ passthrough: true, confirmations: 0 });
    expect(result.variants).toHaveLength(6);
    for (const variant of result.variants) {
      expect(variant.operation).toBe('TRANSCODE_AUDIO');
      expect(variant.targetMime).toBe('audio/mpeg');
    }
    expect(result.compressed[0]).toMatchObject({
      executable: false, operations: expect.arrayContaining(['REENCODE_AUDIO']),
      confirmations: ['AUDIO_LOSSY_TRANSCODE'], stops: []
    });
    expect(result.compressed[1]).toMatchObject({
      executable: false, operations: expect.arrayContaining(['TRANSCODE_AUDIO']),
      confirmations: ['AUDIO_LOSSY_TRANSCODE'], stops: []
    });
  });

  test('A05-A10 [DEBUG_PURE_PLAN]: all planning stops and independent confirmations are deterministic', async ({ page }) => {
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

  test('A13/A14 [DEBUG_FAKE_RUNTIME_BRANCH]: two-pass output correction never performs a third pass', async ({ page }) => {
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

  test('A15/A16 [DEBUG_PURE_PLAN]: strict rejection retry and media boundaries stay closed', async ({ page }) => {
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

  test('A17 [DEBUG_PURE_PLAN]: malformed format and injection fallback are bounded and recoverable', async ({ page }) => {
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

  test('A18 [PRODUCTION_IIFE_STATIC_ARTIFACT + DEBUG_REGISTRY] registry keeps image/audio isolated and bundle is a single IIFE', async ({ page }) => {
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

  test('Format adversaries [DEBUG_PURE_PLAN] cover MP3/WAV/M4A signatures, conflicts and media boundaries', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
      const concat = (...parts) => {
        const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
        let offset = 0;
        for (const part of parts) { bytes.set(part, offset); offset += part.length; }
        return bytes;
      };
      const ascii = (bytes, offset, value) => [...value].forEach((char, index) => {
        bytes[offset + index] = char.charCodeAt(0);
      });
      const mp3Frame = (bitrateIndex = 9, channelMode = 0) => {
        const bitrate = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bitrateIndex];
        const frameLength = Math.floor(144 * bitrate * 1000 / 44_100);
        const bytes = new Uint8Array(frameLength);
        bytes.set([0xff, 0xfb, bitrateIndex << 4, channelMode << 6]);
        return bytes;
      };
      const mp3 = (frames, name = 'fixture.mp3', type = 'audio/mpeg') => new File([
        concat(...frames.map((item) => mp3Frame(item)))
      ], name, { type });
      const mp3WithId3 = (tagBytes) => {
        const tag = new Uint8Array(10 + tagBytes);
        ascii(tag, 0, 'ID3');
        tag[3] = 4;
        tag[6] = (tagBytes >>> 21) & 0x7f;
        tag[7] = (tagBytes >>> 14) & 0x7f;
        tag[8] = (tagBytes >>> 7) & 0x7f;
        tag[9] = tagBytes & 0x7f;
        return new File([concat(tag, mp3Frame(9), mp3Frame(9), mp3Frame(9), mp3Frame(9))],
          `id3-${tagBytes}.mp3`, { type: 'audio/mpeg' });
      };
      const wav = ({ channels = 1, dataBytes = 1_764, declaredDataBytes = dataBytes, unknownChunk = false } = {}) => {
        const sampleRate = 44_100;
        const blockAlign = channels * 2;
        const fmt = new Uint8Array(24);
        ascii(fmt, 0, 'fmt ');
        const fmtView = new DataView(fmt.buffer);
        fmtView.setUint32(4, 16, true); fmtView.setUint16(8, 1, true);
        fmtView.setUint16(10, channels, true); fmtView.setUint32(12, sampleRate, true);
        fmtView.setUint32(16, sampleRate * blockAlign, true); fmtView.setUint16(20, blockAlign, true);
        fmtView.setUint16(22, 16, true);
        const extra = unknownChunk
          ? new Uint8Array([0x4a, 0x55, 0x4e, 0x4b, 0x03, 0x00, 0x00, 0x00, 1, 2, 3, 0])
          : new Uint8Array(0);
        const data = new Uint8Array(8 + dataBytes);
        ascii(data, 0, 'data'); new DataView(data.buffer).setUint32(4, declaredDataBytes, true);
        const bytes = concat(new Uint8Array(12), extra, fmt, data);
        ascii(bytes, 0, 'RIFF'); new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true); ascii(bytes, 8, 'WAVE');
        return new File([bytes], 'fixture.wav', { type: 'audio/wav' });
      };
      const box = (type, payload) => {
        const bytes = new Uint8Array(8 + payload.length);
        new DataView(bytes.buffer).setUint32(0, bytes.length, false);
        ascii(bytes, 4, type); bytes.set(payload, 8);
        return bytes;
      };
      const m4a = ({ moovAfterMdat = false, objectType = 2, truncate = false } = {}) => {
        const mdhdPayload = new Uint8Array(24);
        const mdhdView = new DataView(mdhdPayload.buffer);
        mdhdView.setUint32(12, 1000, false); mdhdView.setUint32(16, 2000, false);
        const frequencyIndex = 4;
        const asc = new Uint8Array([
          (objectType << 3) | (frequencyIndex >> 1),
          ((frequencyIndex & 1) << 7) | (2 << 3)
        ]);
        const esdsPayload = new Uint8Array([
          0, 0, 0, 0, 0x03, 0x10, 0, 0, 0, 0, 0x04, 0x08, 0, 0, 0, 0,
          0x05, 0x02, asc[0], asc[1]
        ]);
        const samplePayload = new Uint8Array(28);
        const sampleView = new DataView(samplePayload.buffer);
        sampleView.setUint16(16, 2, false); sampleView.setUint16(18, 16, false);
        sampleView.setUint32(24, 44100 << 16, false);
        const sampleEntry = box('mp4a', concat(samplePayload, box('esds', esdsPayload)));
        const stsdPayload = new Uint8Array(8 + sampleEntry.length);
        new DataView(stsdPayload.buffer).setUint32(4, 1, false); stsdPayload.set(sampleEntry, 8);
        const moov = box('moov', box('trak', box('mdia', concat(
          box('mdhd', mdhdPayload),
          box('minf', box('stbl', box('stsd', stsdPayload)))
        ))));
        const ftyp = box('ftyp', concat(new TextEncoder().encode('M4A '), new Uint8Array([0, 0, 0, 0]), new TextEncoder().encode('M4A ')));
        const mdat = box('mdat', new Uint8Array(16));
        const bytes = moovAfterMdat ? concat(ftyp, mdat, moov) : concat(ftyp, moov, mdat);
        const value = truncate ? bytes.slice(0, Math.max(0, bytes.length - 3)) : bytes;
        return new File([value], 'fixture.m4a', { type: 'audio/mp4' });
      };
      const rules = { mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 500_000 };
      const fixtures = [
        ['mp3-cbr', mp3([9, 9, 9, 9])],
        ['mp3-vbr', mp3([9, 10, 9, 10])],
        ['mp3-id3-small', mp3WithId3(16)],
        ['mp3-id3-large', mp3WithId3(16 * 1024)],
        ['mp3-truncated', new File([mp3Frame(9).slice(0, 100)], 'truncated.mp3', { type: 'audio/mpeg' })],
        ['wav-unknown-chunk', wav({ unknownChunk: true })],
        ['wav-three-channels', wav({ channels: 3 })],
        ['wav-data-pseudolong', wav({ dataBytes: 32, declaredDataBytes: 999_999 })],
        ['wav-pseudo-mp3-extension', new File([await wav().arrayBuffer()], 'pseudo.mp3', { type: 'audio/mpeg' })],
        ['m4a-moov-before-mdat', m4a()],
        ['m4a-moov-after-mdat', m4a({ moovAfterMdat: true })],
        ['m4a-non-aac', m4a({ objectType: 5 })],
        ['m4a-truncated-box', m4a({ truncate: true })],
        ['mp3-mime-extension-conflict', mp3([9, 9, 9, 9], 'conflict.wav', 'audio/wav')]
      ];
      const inspected = [];
      for (const [id, file] of fixtures) {
        const metadata = await api.inspectAudio(file);
        const plan = api.createAudioProcessingPlan(metadata, rules);
        inspected.push({
          id,
          metadata: {
            signatureMime: metadata.signatureMime,
            container: metadata.container,
            codec: metadata.codec,
            errorCode: metadata.errorCode,
            variableBitrate: metadata.variableBitrate,
            id3Bytes: metadata.id3Bytes,
            warnings: metadata.warnings
          },
          planExecutable: plan.executable,
          planStops: plan.unfixable
        });
      }
      const handler = api.createAudioHandler();
      const boundary = {
        multiple: handler.supports(mp3([9, 9]), { mediaKind: 'audio', acceptTokens: ['audio/mpeg'], multiple: true }),
        mixed: handler.supports(mp3([9, 9]), { mediaKind: 'audio', acceptTokens: ['image/*', 'audio/mpeg'], multiple: false }),
        videoOnly: handler.supports(new File([new Uint8Array([0])], 'video.mp4', { type: 'video/mp4' }), {
          mediaKind: 'audio', acceptTokens: ['audio/mpeg'], multiple: false
        })
      };
      handler.dispose();
      return { inspected, boundary };
    });

    const byId = Object.fromEntries(result.inspected.map((item) => [item.id, item]));
    for (const id of ['mp3-cbr', 'mp3-vbr', 'mp3-id3-small', 'mp3-id3-large', 'wav-unknown-chunk', 'm4a-moov-before-mdat', 'm4a-moov-after-mdat']) {
      expect(byId[id].metadata.errorCode, id).toBeNull();
    }
    expect(byId['mp3-cbr'].metadata).toMatchObject({ signatureMime: 'audio/mpeg', container: 'mp3', codec: 'mp3', variableBitrate: false });
    expect(byId['mp3-vbr'].metadata).toMatchObject({ signatureMime: 'audio/mpeg', container: 'mp3', codec: 'mp3', variableBitrate: true });
    expect(byId['mp3-id3-small'].metadata.id3Bytes).toBe(26);
    expect(byId['mp3-id3-large'].metadata.id3Bytes).toBe(16 * 1024 + 10);
    expect(['AUDIO_CODEC_UNSUPPORTED', 'AUDIO_DECODE_FAILED', 'AUDIO_METADATA_INVALID'])
      .toContain(byId['mp3-truncated'].metadata.errorCode);
    expect(byId['wav-three-channels'].metadata.errorCode).toBe('AUDIO_CODEC_UNSUPPORTED');
    expect(byId['wav-data-pseudolong'].metadata.errorCode).toBe('AUDIO_DECODE_FAILED');
    expect(byId['wav-pseudo-mp3-extension'].metadata).toMatchObject({ signatureMime: 'audio/wav', container: 'wav', codec: 'pcm' });
    expect(byId['wav-pseudo-mp3-extension'].metadata.warnings)
      .toEqual(expect.arrayContaining([{ code: 'AUDIO_MIME_SIGNATURE_MISMATCH' }, { code: 'AUDIO_EXTENSION_SIGNATURE_MISMATCH' }]));
    expect(byId['m4a-non-aac'].metadata.errorCode).toBe('AUDIO_CODEC_UNSUPPORTED');
    expect(['AUDIO_DECODE_FAILED', 'AUDIO_METADATA_INVALID', 'AUDIO_CODEC_UNSUPPORTED'])
      .toContain(byId['m4a-truncated-box'].metadata.errorCode);
    expect(byId['mp3-mime-extension-conflict'].metadata).toMatchObject({ signatureMime: 'audio/mpeg', container: 'mp3', codec: 'mp3' });
    expect(byId['mp3-mime-extension-conflict'].metadata.warnings)
      .toEqual(expect.arrayContaining([{ code: 'AUDIO_MIME_SIGNATURE_MISMATCH' }, { code: 'AUDIO_EXTENSION_SIGNATURE_MISMATCH' }]));
    expect(result.boundary).toEqual({ multiple: false, mixed: false, videoOnly: false });
  });
});
