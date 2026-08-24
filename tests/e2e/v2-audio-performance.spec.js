import { expect, test } from '@playwright/test';

async function open(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
}

test.describe('V2-S4 quick audio performance matrix', () => {
  test('Q-S4-P06 [DEBUG_DIRECT_PIPELINE_REAL_WORKER] P01 records inspect/plan/confirm/process/validate timings', async ({ page }) => {
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
      const inspectStarted = performance.now();
      const metadata = await api.inspectAudio(file);
      const inspectMs = performance.now() - inspectStarted;
      const planStarted = performance.now();
      let plan = api.createAudioProcessingPlan(metadata, rules);
      const planMs = performance.now() - planStarted;
      const confirmStarted = performance.now();
      plan = api.resolveAudioConfirmation(plan, { ...plan.confirmations[0], accepted: true });
      const confirmMs = performance.now() - confirmStarted;
      const progress = [];
      let lastHeartbeat = performance.now();
      let maxHeartbeatGapMs = 0;
      const heartbeat = setInterval(() => {
        const now = performance.now();
        maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastHeartbeat);
        lastHeartbeat = now;
      }, 100);
      const started = performance.now();
      const processed = await api.processAudio(file, plan, {
        rules, metadata,
        onProgress: (event) => progress.push({ ratio: event.ratio, at: performance.now() }),
        timeoutMs: 30_000
      });
      clearInterval(heartbeat);
      const processMs = performance.now() - started;
      const validateStarted = performance.now();
      const validation = await api.validateAudioOutputFile(
        processed.file,
        rules,
        plan,
        metadata,
        { allowSingleFrame: true }
      );
      const validateMs = performance.now() - validateStarted;
      const intervals = progress.slice(1).map((event, index) => event.at - progress[index].at);
      return {
        outputBytes: processed.outputBytes,
        workerUsed: processed.workerUsed,
        encodePasses: processed.encodePasses,
        stages: { inspectMs, planMs, confirmMs, processMs, validateMs },
        validationValid: validation.valid,
        elapsedMs: processMs,
        maxHeartbeatGapMs,
        progressCount: progress.length,
        ratios: progress.map((event) => event.ratio),
        maxProgressRate: intervals.length ? 1000 / Math.max(100, Math.min(...intervals)) : 0,
        cleanup: processed.cleanup
      };
    });
    console.log(`V2-S4 Q-S4-P06 measured ${JSON.stringify({ stages: result.stages, heartbeatMs: result.maxHeartbeatGapMs, progressCount: result.progressCount, progressRate: result.maxProgressRate, encodePasses: result.encodePasses, outputBytes: result.outputBytes })}`);
    expect(result.outputBytes).toBeGreaterThan(0);
    expect(result.outputBytes).toBeLessThanOrEqual(1_000_000);
    expect(result.workerUsed).toBe(true);
    expect(result.validationValid).toBe(true);
    expect(result.encodePasses).toBeLessThanOrEqual(2);
    expect(result.elapsedMs).toBeLessThan(30_000);
    expect(Object.values(result.stages).every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(result.maxHeartbeatGapMs).toBeLessThanOrEqual(500);
    expect(result.progressCount).toBeGreaterThan(0);
    expect(result.maxProgressRate).toBeLessThanOrEqual(10.01);
    for (let index = 1; index < result.ratios.length; index += 1) {
      expect(result.ratios[index]).toBeGreaterThanOrEqual(result.ratios[index - 1]);
    }
    expect(result.ratios.at(-1)).toBe(1);
    expect(result.cleanup).toMatchObject({ workerTerminated: true, objectUrlRevoked: true, queueCleared: true });
  });

  test('P02 [DEBUG_DIRECT_PIPELINE_REAL_WORKER] processing cancellation stops within 1s and emits no late result', async ({ page }) => {
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

  test('P03 [DEBUG_SEQUENTIAL_CLEANUP_HARNESS] direct sequential audio tasks cleanly reuse no stale Worker/object URL state', async ({ page }) => {
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

  test('Q-S4-P07 [DEBUG_CONTROLLER_REAL_WORKER] P03 queues two audio uploaders with one active Worker at a time', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
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
      const rules = {
        mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'],
        minBytes: null, maxBytes: 500_000,
        duration: { exactMs: null, minMs: null, maxMs: null },
        audio: { sampleRates: [], channels: [], bitDepths: [] },
        confidence: 0.95,
        sources: [{ type: 'nearby-text', priority: 400, confidence: 0.95, evidence: ['MP3 最大 500KB'] }],
        conflicts: [], advisories: [], safetyFlags: [], semanticRequirements: [], actionable: true
      };
      const entries = [];
      let processing = 0;
      let maxProcessing = 0;
      const logger = {
        emit(event, fields = {}) {
          entries.push({ event, ...fields });
          if (event === 'AUDIO_PROCESSING_STARTED') {
            processing += 1;
            maxProcessing = Math.max(maxProcessing, processing);
          }
          if (event === 'AUDIO_PROCESSING_COMPLETED') processing = Math.max(0, processing - 1);
          return true;
        },
        getEntries() { return entries.slice(); },
        clear() { entries.length = 0; }
      };
      const pendingConfirmation = ({ plan }) => {
        const confirmation = plan?.confirmations?.find((item) => item.required && !item.resolved);
        return confirmation
          ? {
            id: confirmation.id,
            type: confirmation.type,
            accepted: true,
            payload: confirmation.suggestedPayload ?? null
          }
          : null;
      };
      const controller = api.createTaskController({
        documentRef: document,
        globalRef: window,
        logger,
        confirmationResolver: pendingConfirmation,
        parseRulesFn: () => [],
        resolveRulesFn: () => rules
      });
      const makeInput = (id) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/mpeg';
        input.id = id;
        document.body.append(input);
        controller.registerUploader({
          input,
          uploaderId: id,
          label: '录音转写',
          mediaKind: 'audio',
          acceptTokens: ['audio/mpeg'],
          multiple: false,
          nearbyTexts: ['MP3 最大 500KB'],
          alertTexts: []
        });
        return input;
      };
      const makeWav = (name) => {
        const sampleRate = 44_100;
        const frames = Math.round(sampleRate * 0.35);
        const dataBytes = frames * 2;
        const bytes = new Uint8Array(44 + dataBytes);
        const view = new DataView(bytes.buffer);
        const put = (offset, text) => [...text].forEach((char, index) => {
          bytes[offset + index] = char.charCodeAt(0);
        });
        put(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); put(8, 'WAVE');
        put(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
        view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
        view.setUint16(34, 16, true); put(36, 'data'); view.setUint32(40, dataBytes, true);
        return new File([bytes], name, { type: 'audio/wav' });
      };
      const assign = (input, file) => {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      };
      const first = makeInput('v2-s4-queue-first');
      const second = makeInput('v2-s4-queue-second');
      controller.start();
      assign(first, makeWav('queue-first.wav'));
      assign(second, makeWav('queue-second.wav'));
      const deadline = performance.now() + 30_000;
      while (performance.now() < deadline) {
        const tasks = [...controller.tasks.values()];
        if (tasks.length === 2 && tasks.every((task) => task.status === 'SUCCESS')) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const tasks = [...controller.tasks.values()];
      const taskResults = tasks.map((task) => ({
        status: task.status,
        retryCount: task.retryCount,
        businessClickCount: task.businessClickCount,
        objectUrls: task.objectUrls.length,
        cleanup: task.result?.cleanup ?? null
      }));
      const submitEvents = entries.filter((entry) => /SUBMIT|BUSINESS/.test(entry.event)).length;
      const completed = entries.filter((entry) => entry.event === 'AUDIO_PROCESSING_COMPLETED').length;
      const output = {
        taskCount: tasks.length,
        taskResults,
        completed,
        processingStarts: entries.filter((entry) => entry.event === 'AUDIO_PROCESSING_STARTED').length,
        maxProcessing,
        workerStarts,
        maxActiveWorkers,
        activeWorkers,
        submitEvents
      };
      controller.dispose();
      window.Worker = NativeWorker;
      return output;
    });
    console.log(`V2-S4 Q-S4-P07 measured ${JSON.stringify({ taskCount: result.taskCount, completed: result.completed, processingStarts: result.processingStarts, maxProcessing: result.maxProcessing, workerStarts: result.workerStarts, maxActiveWorkers: result.maxActiveWorkers, activeWorkers: result.activeWorkers })}`);
    expect(result.taskCount).toBe(2);
    expect(result.completed).toBe(2);
    expect(result.processingStarts).toBe(2);
    expect(result.maxProcessing).toBe(1);
    expect(result.workerStarts).toBe(2);
    expect(result.maxActiveWorkers).toBe(1);
    expect(result.activeWorkers).toBe(0);
    expect(result.submitEvents).toBe(0);
    for (const task of result.taskResults) {
      expect(task.status).toBe('SUCCESS');
      expect(task.retryCount).toBe(0);
      expect(task.businessClickCount).toBe(0);
      expect(task.objectUrls).toBe(0);
      expect(task.cleanup).toMatchObject({ workerTerminated: true, objectUrlRevoked: true, queueCleared: true });
    }
  });
});
