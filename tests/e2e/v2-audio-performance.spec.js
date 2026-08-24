import { expect, test } from '@playwright/test';

async function open(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
}

test.describe('V2-S4 quick audio performance matrix', () => {
  test('P01 progress is monotonic, bounded to <=10 events/s and keeps heartbeat <=500ms', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
      const makeWav = (seconds, channels = 2, bitDepth = 16) => {
        const sampleRate = 44_100;
        const frames = Math.round(seconds * sampleRate);
        const bytesPerSample = bitDepth / 8;
        const blockAlign = channels * bytesPerSample;
        const dataBytes = frames * blockAlign;
        const bytes = new Uint8Array(44 + dataBytes);
        const view = new DataView(bytes.buffer);
        const put = (offset, text) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
        put(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); put(8, 'WAVE'); put(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
        view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true); view.setUint16(34, bitDepth, true); put(36, 'data');
        view.setUint32(40, dataBytes, true);
        return new File([bytes], 'voice.wav', { type: 'audio/wav' });
      };
      const file = makeWav(2);
      const rules = { mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 1_000_000 };
      const metadata = await api.inspectAudio(file);
      let plan = api.createAudioProcessingPlan(metadata, rules);
      plan = api.resolveAudioConfirmation(plan, { ...plan.confirmations[0], accepted: true });
      const progress = [];
      let lastHeartbeat = performance.now();
      let maxHeartbeatGapMs = 0;
      const heartbeat = setInterval(() => {
        const now = performance.now();
        maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastHeartbeat);
        lastHeartbeat = now;
      }, 100);
      const started = performance.now();
      const result = await api.processAudio(file, plan, {
        rules, metadata,
        onProgress: (event) => progress.push({ ratio: event.ratio, at: performance.now() }),
        timeoutMs: 30_000
      });
      clearInterval(heartbeat);
      const elapsedMs = performance.now() - started;
      const intervals = progress.slice(1).map((event, index) => event.at - progress[index].at);
      return {
        outputBytes: result.outputBytes,
        workerUsed: result.workerUsed,
        encodePasses: result.encodePasses,
        elapsedMs,
        maxHeartbeatGapMs,
        progressCount: progress.length,
        ratios: progress.map((event) => event.ratio),
        maxProgressRate: intervals.length ? 1000 / Math.max(100, Math.min(...intervals)) : 0,
        cleanup: result.cleanup
      };
    });
    expect(result.outputBytes).toBeGreaterThan(0);
    expect(result.outputBytes).toBeLessThanOrEqual(1_000_000);
    expect(result.workerUsed).toBe(true);
    expect(result.encodePasses).toBeLessThanOrEqual(2);
    expect(result.elapsedMs).toBeLessThan(30_000);
    expect(result.maxHeartbeatGapMs).toBeLessThanOrEqual(500);
    expect(result.progressCount).toBeGreaterThan(0);
    expect(result.maxProgressRate).toBeLessThanOrEqual(10.01);
    for (let index = 1; index < result.ratios.length; index += 1) {
      expect(result.ratios[index]).toBeGreaterThanOrEqual(result.ratios[index - 1]);
    }
    expect(result.ratios.at(-1)).toBe(1);
    expect(result.cleanup).toMatchObject({ workerTerminated: true, objectUrlRevoked: true, queueCleared: true });
  });

  test('P02 processing cancellation stops within 1s and emits no late result', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
      const sampleRate = 44_100;
      const frames = sampleRate * 20;
      const bytes = new Uint8Array(44 + frames * 2);
      const view = new DataView(bytes.buffer);
      const put = (offset, text) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
      put(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); put(8, 'WAVE'); put(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); put(36, 'data'); view.setUint32(40, frames * 2, true);
      const file = new File([bytes], 'voice.wav', { type: 'audio/wav' });
      const rules = { mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 5_000_000 };
      const metadata = await api.inspectAudio(file);
      let plan = api.createAudioProcessingPlan(metadata, rules);
      plan = api.resolveAudioConfirmation(plan, { ...plan.confirmations[0], accepted: true });
      const controller = new AbortController();
      let abortAt = null;
      let eventsAfterAbort = 0;
      let aborted = false;
      try {
        await api.processAudio(file, plan, {
          rules, metadata, signal: controller.signal, inputChunkBytes: 64 * 1024,
          onProgress: (event) => {
            if (!aborted && event.phase === 'encode') {
              aborted = true; abortAt = performance.now(); controller.abort();
            } else if (aborted) eventsAfterAbort += 1;
          },
          timeoutMs: 30_000
        });
        return { code: 'UNEXPECTED_SUCCESS', eventsAfterAbort, cancelLatencyMs: null };
      } catch (error) {
        return {
          code: error.code,
          eventsAfterAbort,
          cancelLatencyMs: abortAt === null ? null : performance.now() - abortAt,
          cleanup: error.details?.cleanup ?? null
        };
      }
    });
    expect(result.code).toBe('AUDIO_PROCESSING_CANCELLED');
    expect(result.cancelLatencyMs).not.toBeNull();
    expect(result.cancelLatencyMs).toBeLessThanOrEqual(1_000);
    expect(result.eventsAfterAbort).toBe(0);
    expect(result.cleanup).toMatchObject({ workerTerminated: true, objectUrlRevoked: true, queueCleared: true });
  });

  test('P03 sequential audio tasks cleanly reuse no stale Worker/object URL state', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
      const makeWav = (seconds) => {
        const sampleRate = 22_050; const frames = sampleRate * seconds; const dataBytes = frames * 2;
        const bytes = new Uint8Array(44 + dataBytes); const view = new DataView(bytes.buffer);
        const put = (offset, text) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
        put(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); put(8, 'WAVE'); put(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true); put(36, 'data'); view.setUint32(40, dataBytes, true);
        return new File([bytes], 'voice.wav', { type: 'audio/wav' });
      };
      const run = async (file) => {
        const rules = { mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 500_000 };
        const metadata = await api.inspectAudio(file);
        let plan = api.createAudioProcessingPlan(metadata, rules);
        plan = api.resolveAudioConfirmation(plan, { ...plan.confirmations[0], accepted: true });
        const result = await api.processAudio(file, plan, { rules, metadata, timeoutMs: 30_000 });
        return { outputBytes: result.outputBytes, workerUsed: result.workerUsed, cleanup: result.cleanup };
      };
      return { first: await run(makeWav(1)), second: await run(makeWav(1)) };
    });
    for (const outcome of [result.first, result.second]) {
      expect(outcome.outputBytes).toBeGreaterThan(0);
      expect(outcome.workerUsed).toBe(true);
      expect(outcome.cleanup).toMatchObject({ workerTerminated: true, objectUrlRevoked: true, queueCleared: true });
    }
  });
});
