import { expect, test } from '@playwright/test';

test('S4.1 P01-P04 processes >=30MiB MP3/M4A, cancels, and reuses cleanly', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/test-pages/audio-s4-1-capability.html');
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const minimumLargeBytes = 30 * 1024 * 1024;
    const NativeWorker = window.Worker;
    let workerStarts = 0;
    let activeWorkers = 0;
    let maxActiveWorkers = 0;
    window.Worker = class CountingWorker extends NativeWorker {
      constructor(...args) {
        super(...args);
        workerStarts += 1;
        activeWorkers += 1;
        maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
      }

      terminate(...args) {
        activeWorkers = Math.max(0, activeWorkers - 1);
        return super.terminate(...args);
      }
    };

    const runtime = api.createAudioWorkerRuntime();
    const runFull = async (file, rules) => {
      const metadata = await api.inspectAudio(file);
      let plan = api.createAudioProcessingPlan(metadata, rules);
      if (metadata.errorCode || plan.unfixable.length) {
        throw new Error(`PRECHECK:${metadata.errorCode ?? 'NONE'}:${plan.unfixable.join(',')}`);
      }
      const operation = plan.operations[0] ?? null;
      for (const pending of plan.confirmations) {
        plan = api.resolveAudioConfirmation(plan, {
          id: pending.id,
          type: pending.type,
          accepted: true,
          suggestedPayload: pending.suggestedPayload
        });
      }
      const workerStats = [];
      const capturingRuntime = {
        async run(...args) {
          const value = await runtime.run(...args);
          workerStats.push(value.stats);
          return value;
        },
        dispose() {}
      };
      const beats = [performance.now()];
      const interval = setInterval(() => beats.push(performance.now()), 10);
      const startedAt = performance.now();
      let processed;
      try {
        processed = await api.processAudio(file, plan, {
          metadata, rules, workerRuntime: capturingRuntime,
          inputChunkBytes: 4 * 1024 * 1024
        });
      } finally {
        clearInterval(interval);
        beats.push(performance.now());
      }
      const gaps = beats.slice(1).map((value, index) => value - beats[index]);
      return {
        source: {
          bytes: file.size, durationMs: metadata.durationMs,
          signatureMime: metadata.signatureMime, codec: metadata.codec,
          errorCode: metadata.errorCode
        },
        plan: { operation, executable: plan.executable, unfixable: plan.unfixable },
        output: {
          bytes: processed.file.size, type: processed.file.type,
          durationMs: processed.metadata.durationMs,
          validationValid: processed.validation.valid,
          frameValidation: processed.validation.frameValidation
        },
        encodePasses: processed.encodePasses,
        totalMs: performance.now() - startedAt,
        maxHeartbeatGapMs: Math.max(0, ...gaps),
        peakBufferedBytes: processed.peakBufferedBytes,
        workerStats
      };
    };

    try {
      const largeMp3 = await globalThis.__createS41LargeMp3(minimumLargeBytes);
      const largeM4aFixture = await globalThis.__createS41M4aVariant({
        frames: 48,
        bitrate: 128_000,
        channels: 2,
        placement: 'after-mdat',
        table: 'co64',
        minimumMediaBytes: minimumLargeBytes
      });
      const mp3Rules = {
        mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'],
        maxBytes: 25 * 1024 * 1024
      };
      const m4aRules = {
        mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'],
        maxBytes: 25 * 1024 * 1024
      };
      let mp3;
      let m4a;
      try {
        mp3 = await runFull(largeMp3, mp3Rules);
      } catch (error) {
        throw new Error(`LARGE_MP3:${error?.code ?? error?.message}`);
      }
      try {
        m4a = await runFull(largeM4aFixture.file, m4aRules);
      } catch (error) {
        throw new Error(`LARGE_M4A:${error?.code ?? error?.message}`);
      }

      const cancelRun = async (file, rules) => {
        const metadata = await api.inspectAudio(file);
        let plan = api.createAudioProcessingPlan(metadata, rules);
        plan = api.resolveAudioConfirmation(plan, {
          ...plan.confirmations[0], accepted: true
        });
        const controller = new AbortController();
        let abortAt = null;
        let code = null;
        let cleanup = null;
        try {
          await runtime.run(file, plan, {
            signal: controller.signal,
            timeoutMs: 120_000,
            inputChunkBytes: 4 * 1024 * 1024,
            onProgress(event) {
              if (abortAt === null && event.phase === 'decode') {
                abortAt = performance.now();
                controller.abort();
              }
            }
          });
        } catch (error) {
          code = error?.code ?? null;
          cleanup = error?.details?.cleanup ?? null;
        }
        return {
          code,
          latencyMs: abortAt === null ? null : performance.now() - abortAt,
          cleanup
        };
      };
      const cancel = await cancelRun(largeMp3, mp3Rules);
      const m4aCancel = await cancelRun(largeM4aFixture.file, m4aRules);

      const small = await globalThis.__createS41M4aVariant({ frames: 4 });
      const reuse = await runtime.run(small.file, {
        sourceContainer: 'mp4', sourceCodec: 'aac-lc',
        targetMaxBytes: 1_000_000, safeTargetBytes: 900_000,
        targetBitrateKbps: 128, targetSampleRate: 48_000, targetChannels: 1
      }, { timeoutMs: 15_000, inputChunkBytes: 257 });

      runtime.dispose();
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        minimumLargeBytes,
        mp3,
        m4a,
        m4aFixture: largeM4aFixture.stats,
        cancel,
        m4aCancel,
        reuse: {
          bytes: reuse.blob.size,
          stats: reuse.stats,
          cleanup: reuse.cleanup
        },
        workers: { starts: workerStarts, active: activeWorkers, maxActive: maxActiveWorkers }
      };
    } finally {
      runtime.dispose();
      window.Worker = NativeWorker;
    }
  });

  console.log(`S4.1_PERFORMANCE_RESULT ${JSON.stringify(result)}`);

  for (const [kind, outcome] of [['mp3', result.mp3], ['m4a', result.m4a]]) {
    expect(outcome.source.bytes, kind).toBeGreaterThanOrEqual(result.minimumLargeBytes);
    expect(outcome.source.errorCode, kind).toBeNull();
    expect(outcome.plan, kind).toMatchObject({ executable: true, unfixable: [] });
    expect(outcome.output, kind).toMatchObject({
      type: 'audio/mpeg', validationValid: true,
      frameValidation: { valid: true, decodeValid: true, unclosedAudioData: 0 }
    });
    expect(outcome.output.bytes, kind).toBeGreaterThan(0);
    expect(outcome.encodePasses, kind).toBeLessThanOrEqual(2);
    expect(outcome.maxHeartbeatGapMs, kind).toBeLessThanOrEqual(500);
    const tolerance = Math.max(250, outcome.source.durationMs * 0.02);
    expect(Math.abs(outcome.output.durationMs - outcome.source.durationMs), kind).toBeLessThanOrEqual(tolerance);
  }
  expect(result.mp3.plan.operation).toBe('REENCODE_AUDIO');
  expect(result.mp3.output.bytes).toBeLessThanOrEqual(25 * 1024 * 1024);
  expect(result.mp3.workerStats.at(-1)).toMatchObject({
    decoderClosed: true, unclosedAudioData: 0,
    maxResidualBytes: expect.any(Number)
  });
  expect(result.mp3.workerStats.at(-1).maxResidualBytes).toBeLessThanOrEqual(4096);
  expect(result.m4a.plan.operation).toBe('TRANSCODE_AUDIO');
  expect(result.m4aFixture.mediaBytes).toBeGreaterThanOrEqual(result.minimumLargeBytes);
  expect(result.m4aFixture.frames).toBeGreaterThan(result.m4aFixture.seedFrames);
  expect(result.m4a.output.bytes).toBeLessThanOrEqual(25 * 1024 * 1024);
  expect(result.m4a.workerStats.at(-1)).toMatchObject({
    decoderClosed: true, unclosedAudioData: 0,
    table: 'co64', moovPlacement: 'after-mdat'
  });
  expect(result.cancel).toMatchObject({
    code: 'AUDIO_PROCESSING_CANCELLED',
    cleanup: { workerTerminated: true, objectUrlRevoked: true, queueCleared: true }
  });
  expect(result.cancel.latencyMs).not.toBeNull();
  expect(result.cancel.latencyMs).toBeLessThanOrEqual(1000);
  expect(result.m4aCancel).toMatchObject({
    code: 'AUDIO_PROCESSING_CANCELLED',
    cleanup: { workerTerminated: true, objectUrlRevoked: true, queueCleared: true }
  });
  expect(result.m4aCancel.latencyMs).not.toBeNull();
  expect(result.m4aCancel.latencyMs).toBeLessThanOrEqual(1000);
  expect(result.reuse.bytes).toBeGreaterThan(0);
  expect(result.reuse.stats).toMatchObject({
    decoderClosed: true, unclosedAudioData: 0, outputAudioData: expect.any(Number)
  });
  expect(result.reuse.cleanup).toMatchObject({
    workerTerminated: true, objectUrlRevoked: true, queueCleared: true
  });
  expect(result.workers.maxActive).toBe(1);
  expect(result.workers.active).toBe(0);
});
