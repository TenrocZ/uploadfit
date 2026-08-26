import { expect, test } from '@playwright/test';

test('S4.1 production-equivalent Worker decodes real MP3 and AAC-LC M4A into the frozen encoder', async ({ page }) => {
  await page.goto('/test-pages/audio-s4-1-capability.html');
  const result = await page.evaluate(() => globalThis.__runS41ProductionDecoderGate());

  for (const [codec, outcome] of Object.entries(result)) {
    expect(outcome.source.errorCode, codec).toBeNull();
    expect(outcome.output, codec).toMatchObject({
      signatureMime: 'audio/mpeg',
      sampleRate: 48_000,
      channels: 1,
      valid: true,
      violations: []
    });
    expect(outcome.output.bytes, codec).toBeGreaterThan(0);
    expect(outcome.stats, codec).toMatchObject({
      workerUsed: true,
      encodePasses: 1,
      unclosedAudioData: 0,
      decoderClosed: true
    });
    expect(outcome.stats.outputAudioData, codec).toBeGreaterThan(0);
    expect(outcome.stats.outputFrames, codec).toBeGreaterThan(0);
    expect(outcome.stats.maxDecodeQueueSize, codec).toBeLessThanOrEqual(8);
    expect(outcome.stats.peakPcmBytes, codec).toBeGreaterThan(0);
    expect(outcome.cleanup, codec).toMatchObject({
      workerTerminated: true,
      objectUrlRevoked: true,
      queueCleared: true,
      disposed: true
    });
    const ratios = outcome.progress.map((event) => event.ratio);
    expect(ratios.at(-1), codec).toBe(1);
    for (let index = 1; index < ratios.length; index += 1) {
      expect(ratios[index], codec).toBeGreaterThanOrEqual(ratios[index - 1]);
    }
  }
  expect(result.mp3.stats.maxResidualBytes).toBeGreaterThan(0);
  expect(result.m4a.stats).toMatchObject({ table: 'stco', moovPlacement: 'after-mdat' });
});

test('S4.1 real compressed files pass planner, confirmation, Worker, and independent output validation', async ({ page }) => {
  await page.goto('/test-pages/audio-s4-1-capability.html');
  const result = await page.evaluate(() => globalThis.__runS41ProductionPipelineGate());

  expect(result.mp3.plan).toMatchObject({
    operations: expect.arrayContaining(['REENCODE_AUDIO']),
    confirmationTypes: ['AUDIO_LOSSY_TRANSCODE'],
    executable: true,
    unfixable: []
  });
  expect(result.m4a.plan).toMatchObject({
    operations: expect.arrayContaining(['TRANSCODE_AUDIO']),
    confirmationTypes: ['AUDIO_LOSSY_TRANSCODE'],
    executable: true,
    unfixable: []
  });
  for (const [kind, outcome] of Object.entries(result)) {
    expect(outcome.source.errorCode, kind).toBeNull();
    expect(outcome.output, kind).toMatchObject({
      type: 'audio/mpeg', sameFile: false,
      signatureMime: 'audio/mpeg', container: 'mp3', codec: 'mp3'
    });
    expect(outcome.output.bytes, kind).toBeGreaterThan(0);
    expect(outcome.validation, kind).toMatchObject({ valid: true, violations: [] });
    expect(outcome.validation.frameValidation, kind).toMatchObject({
      valid: true,
      headerValid: true,
      decodeValid: true,
      workerUsed: true,
      unclosedAudioData: 0
    });
    expect(outcome.validation.frameValidation.decodedWindows, kind)
      .toBe(outcome.validation.frameValidation.representativeWindows);
    expect(outcome.validation.frameValidation.decodedWindows, kind).toBeGreaterThanOrEqual(2);
    expect(outcome.workerUsed, kind).toBe(true);
    expect(outcome.encodePasses, kind).toBeGreaterThanOrEqual(1);
    expect(outcome.encodePasses, kind).toBeLessThanOrEqual(2);
    expect(outcome.cleanup, kind).toMatchObject({
      workerTerminated: true,
      objectUrlRevoked: true,
      queueCleared: true
    });
    const tolerance = Math.max(250, outcome.source.durationMs * 0.02);
    expect(Math.abs(outcome.output.durationMs - outcome.source.durationMs), kind).toBeLessThanOrEqual(tolerance);
  }
  expect(result.mp3.output.bytes).toBeLessThanOrEqual(200_000);
  expect(result.m4a.output.bytes).toBeLessThanOrEqual(1_000_000);
});

test('S4.1 M4A matrix supports moov before/after mdat and stco/co64 without stale state', async ({ page }) => {
  await page.goto('/test-pages/audio-s4-1-capability.html');
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const runtime = api.createAudioWorkerRuntime();
    const outcomes = [];
    try {
      for (const placement of ['before-mdat', 'after-mdat']) {
        for (const table of ['stco', 'co64']) {
          const fixture = await globalThis.__createS41M4aVariant({ placement, table, frames: 12 });
          const source = await api.inspectAudio(fixture.file);
          const encoded = await runtime.run(fixture.file, {
            mediaKind: 'audio', sourceContainer: 'mp4', sourceCodec: 'aac-lc',
            targetMime: 'audio/mpeg', targetContainer: 'mp3', targetCodec: 'mp3',
            targetMaxBytes: 1_000_000, safeTargetBytes: 900_000,
            targetBitrateKbps: 128, targetSampleRate: source.sampleRate, targetChannels: source.channels
          }, { timeoutMs: 15_000, inputChunkBytes: 257 });
          const output = new File([encoded.blob], 'matrix.mp3', { type: 'audio/mpeg', lastModified: 0 });
          const inspected = await api.inspectAudio(output);
          outcomes.push({
            placement, table,
            sourceError: source.errorCode,
            output: { mime: inspected.signatureMime, codec: inspected.codec, bytes: output.size },
            stats: encoded.stats,
            cleanup: encoded.cleanup
          });
        }
      }
      return outcomes;
    } finally {
      runtime.dispose();
    }
  });

  expect(result).toHaveLength(4);
  for (const outcome of result) {
    expect(outcome.sourceError).toBeNull();
    expect(outcome.output).toMatchObject({ mime: 'audio/mpeg', codec: 'mp3' });
    expect(outcome.output.bytes).toBeGreaterThan(0);
    expect(outcome.stats).toMatchObject({
      table: outcome.table,
      moovPlacement: outcome.placement,
      unclosedAudioData: 0,
      decoderClosed: true
    });
    expect(outcome.cleanup).toMatchObject({
      workerTerminated: true, objectUrlRevoked: true, queueCleared: true
    });
  }
});

test('S4.1 rejects unsupported and corrupt M4A subsets before producing encoded output', async ({ page }) => {
  await page.goto('/test-pages/audio-s4-1-capability.html');
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const runtime = api.createAudioWorkerRuntime();
    const cases = [
      { name: 'he-aac', options: { objectType: 5 }, expected: 'AUDIO_CODEC_UNSUPPORTED' },
      { name: 'alac', options: { sampleEntryType: 'alac' }, expected: 'AUDIO_CODEC_UNSUPPORTED' },
      { name: 'encrypted', options: { sampleEntryType: 'enca' }, expected: 'AUDIO_CODEC_UNSUPPORTED' },
      { name: 'fragmented', options: { fragmented: true }, expected: 'AUDIO_CODEC_UNSUPPORTED' },
      { name: 'edit-list', options: { editList: true }, expected: 'AUDIO_CODEC_UNSUPPORTED' },
      { name: 'multiple-tracks', options: { multipleTracks: true }, expected: 'AUDIO_CODEC_UNSUPPORTED' },
      { name: 'bad-offset', options: { corruptOffset: true }, expected: 'AUDIO_DECODE_FAILED' },
      { name: 'bad-duration-table', options: { durationDelta: 1024 }, expected: 'AUDIO_DECODE_FAILED' }
    ];
    const outcomes = [];
    try {
      for (const item of cases) {
        const fixture = await globalThis.__createS41M4aVariant({ ...item.options, frames: 4 });
        let code = null;
        try {
          await runtime.run(fixture.file, {
            sourceContainer: 'mp4', sourceCodec: 'aac-lc',
            targetMaxBytes: 1_000_000, safeTargetBytes: 900_000,
            targetBitrateKbps: 128, targetChannels: 1
          }, { timeoutMs: 10_000, inputChunkBytes: 257 });
        } catch (error) {
          code = error?.code ?? null;
        }
        outcomes.push({ name: item.name, expected: item.expected, code });
      }
      return outcomes;
    } finally {
      runtime.dispose();
    }
  });

  for (const outcome of result) expect(outcome.code, outcome.name).toBe(outcome.expected);
});

test('S4.1 decodes true MP3 mono/stereo at 32, 44.1, and 48 kHz', async ({ page }) => {
  await page.goto('/test-pages/audio-s4-1-capability.html');
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const runtime = api.createAudioWorkerRuntime();
    const outcomes = [];
    try {
      for (const sampleRate of [32_000, 44_100, 48_000]) {
        for (const channels of [1, 2]) {
          const file = await globalThis.__createS41Mp3Variant({
            durationSeconds: 0.4, bitrateKbps: 128, sampleRate, channels
          });
          const source = await api.inspectAudio(file);
          const encoded = await runtime.run(file, {
            sourceContainer: 'mp3', sourceCodec: 'mp3',
            targetMaxBytes: 1_000_000, safeTargetBytes: 900_000,
            targetBitrateKbps: 128, targetSampleRate: sampleRate, targetChannels: channels
          }, { timeoutMs: 15_000, inputChunkBytes: 257 });
          const output = new File([encoded.blob], 'matrix.mp3', {
            type: 'audio/mpeg', lastModified: 0
          });
          const inspected = await api.inspectAudio(output);
          outcomes.push({
            sampleRate, channels,
            source: {
              sampleRate: source.sampleRate, channels: source.channels,
              codec: source.codec, errorCode: source.errorCode
            },
            output: {
              sampleRate: inspected.sampleRate, channels: inspected.channels,
              codec: inspected.codec, bytes: output.size
            },
            stats: encoded.stats
          });
        }
      }
      return outcomes;
    } finally {
      runtime.dispose();
    }
  });

  expect(result).toHaveLength(6);
  for (const outcome of result) {
    expect(outcome.source).toMatchObject({
      sampleRate: outcome.sampleRate,
      channels: outcome.channels,
      codec: 'mp3', errorCode: null
    });
    expect(outcome.output).toMatchObject({
      sampleRate: outcome.sampleRate,
      channels: outcome.channels,
      codec: 'mp3'
    });
    expect(outcome.output.bytes).toBeGreaterThan(0);
    expect(outcome.stats).toMatchObject({ unclosedAudioData: 0, decoderClosed: true });
  }
});

test('S4.1 decodes true AAC-LC M4A mono/stereo at 32, 44.1, and 48 kHz', async ({ page }) => {
  await page.goto('/test-pages/audio-s4-1-capability.html');
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const runtime = api.createAudioWorkerRuntime();
    const outcomes = [];
    try {
      for (const sampleRate of [32_000, 44_100, 48_000]) {
        for (const channels of [1, 2]) {
          const fixture = await globalThis.__createS41M4aVariant({
            frames: 6, sampleRate, channels, placement: 'after-mdat', table: 'stco'
          });
          const source = await api.inspectAudio(fixture.file);
          const encoded = await runtime.run(fixture.file, {
            sourceContainer: 'mp4', sourceCodec: 'aac-lc',
            targetMaxBytes: 1_000_000, safeTargetBytes: 900_000,
            targetBitrateKbps: 128, targetSampleRate: sampleRate, targetChannels: channels
          }, { timeoutMs: 15_000, inputChunkBytes: 257 });
          const output = new File([encoded.blob], 'matrix.mp3', {
            type: 'audio/mpeg', lastModified: 0
          });
          const inspected = await api.inspectAudio(output);
          outcomes.push({
            sampleRate, channels,
            source: {
              sampleRate: source.sampleRate, channels: source.channels,
              codec: source.codec, errorCode: source.errorCode
            },
            output: {
              sampleRate: inspected.sampleRate, channels: inspected.channels,
              codec: inspected.codec, bytes: output.size
            },
            stats: encoded.stats
          });
        }
      }
      return outcomes;
    } finally {
      runtime.dispose();
    }
  });

  expect(result).toHaveLength(6);
  for (const outcome of result) {
    expect(outcome.source).toMatchObject({
      sampleRate: outcome.sampleRate,
      channels: outcome.channels,
      codec: 'aac-lc', errorCode: null
    });
    expect(outcome.output).toMatchObject({
      sampleRate: outcome.sampleRate,
      channels: outcome.channels,
      codec: 'mp3'
    });
    expect(outcome.output.bytes).toBeGreaterThan(0);
    expect(outcome.stats).toMatchObject({ unclosedAudioData: 0, decoderClosed: true });
  }
});
