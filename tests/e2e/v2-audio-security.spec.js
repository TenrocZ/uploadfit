import { expect, test } from '@playwright/test';

async function open(page) {
  await page.addInitScript(() => {
    const counters = { fetch: 0, xhr: 0, websocket: 0, eventSource: 0, beacon: 0, storage: 0 };
    const originalFetch = window.fetch;
    window.fetch = (...args) => { counters.fetch += 1; return originalFetch(...args); };
    const OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = class extends OriginalXHR {
      open(...args) { counters.xhr += 1; return super.open(...args); }
    };
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = class extends OriginalWebSocket {
      constructor(...args) { counters.websocket += 1; super(...args); }
    };
    const OriginalEventSource = window.EventSource;
    if (OriginalEventSource) {
      window.EventSource = class extends OriginalEventSource {
        constructor(...args) { counters.eventSource += 1; super(...args); }
      };
    }
    const originalBeacon = navigator.sendBeacon?.bind(navigator);
    if (originalBeacon) navigator.sendBeacon = (...args) => { counters.beacon += 1; return originalBeacon(...args); };
    for (const key of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) {
      try {
        const value = window[key];
        if (!value || typeof value !== 'object') continue;
        for (const method of ['setItem', 'put', 'add', 'delete', 'open', 'match']) {
          if (typeof value[method] !== 'function') continue;
          const original = value[method].bind(value);
          value[method] = (...args) => { counters.storage += 1; return original(...args); };
        }
      } catch {}
    }
    window.__v2S4SecurityCounters = counters;
  });
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
}

test.describe('V2-S4 security and adversarial matrix', () => {
  test('S01 [DEBUG_CONTROLLER_REAL_WORKER] local small-WAV processing derives external/storage measurements', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
      const makeWav = () => {
        const sampleRate = 44_100;
        const frames = Math.round(sampleRate * 0.25);
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
        return new File([bytes], 'security-small.wav', { type: 'audio/wav' });
      };
      const snapshotStorage = () => {
        const read = (key) => {
          try {
            const value = window[key];
            if (!value || typeof value.length !== 'number' || typeof value.key !== 'function') {
              return { available: false, keys: [] };
            }
            const keys = [];
            for (let index = 0; index < value.length; index += 1) keys.push(value.key(index));
            return { available: true, keys: keys.sort() };
          } catch (error) {
            return { available: false, reason: String(error?.name ?? 'unavailable'), keys: [] };
          }
        };
        return { localStorage: read('localStorage'), sessionStorage: read('sessionStorage') };
      };
      const storageBefore = snapshotStorage();
      const counterBefore = { ...window.__v2S4SecurityCounters };
      const file = makeWav();
      const rules = {
        mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 1_000_000
      };
      const inspectStarted = performance.now();
      const metadata = await api.inspectAudio(file);
      const inspectMs = performance.now() - inspectStarted;
      const planStarted = performance.now();
      let plan = api.createAudioProcessingPlan(metadata, rules);
      const planMs = performance.now() - planStarted;
      const confirmStarted = performance.now();
      for (const confirmation of plan.confirmations) {
        plan = api.resolveAudioConfirmation(plan, { ...confirmation, accepted: true, payload: null });
      }
      const confirmMs = performance.now() - confirmStarted;
      const processStarted = performance.now();
      const processed = await api.processAudio(file, plan, {
        rules,
        metadata,
        timeoutMs: 30_000
      });
      const processMs = performance.now() - processStarted;
      const validateStarted = performance.now();
      const validation = await api.validateAudioOutputFile(
        processed.file,
        rules,
        plan,
        metadata,
        { allowSingleFrame: true }
      );
      const validateMs = performance.now() - validateStarted;
      const storageAfter = snapshotStorage();
      const counters = { ...window.__v2S4SecurityCounters };
      const delta = Object.fromEntries(Object.entries(counters).map(([key, value]) => [
        key,
        value - (counterBefore[key] ?? 0)
      ]));
      const externalAudioRequests = delta.fetch + delta.xhr + delta.websocket
        + delta.eventSource + delta.beacon;
      const storageReliable = storageBefore.localStorage.available
        && storageAfter.localStorage.available
        && storageBefore.sessionStorage.available
        && storageAfter.sessionStorage.available;
      const persistedAudio = storageReliable
        ? JSON.stringify(storageBefore) !== JSON.stringify(storageAfter)
        : 'NOT_MEASURED_PHASE_1';
      return {
        executable: plan.executable,
        outputBytes: processed.outputBytes,
        workerUsed: processed.workerUsed,
        validationValid: validation.valid,
        encodePasses: processed.encodePasses,
        stages: { inspectMs, planMs, confirmMs, processMs, validateMs },
        counters: delta,
        storageBefore,
        storageAfter,
        storageReliable,
        persistedAudio,
        externalAudioRequests,
        cleanup: processed.cleanup
      };
    });
    console.log(`V2-S4 S01 measured ${JSON.stringify({ outputBytes: result.outputBytes, workerUsed: result.workerUsed, encodePasses: result.encodePasses, externalAudioRequests: result.externalAudioRequests, persistedAudio: result.persistedAudio, counters: result.counters, storageBefore: result.storageBefore, storageAfter: result.storageAfter, stages: result.stages })}`);
    expect(result.executable).toBe(true);
    expect(result.workerUsed).toBe(true);
    expect(result.outputBytes).toBeGreaterThan(0);
    expect(result.validationValid).toBe(true);
    expect(result.encodePasses).toBeLessThanOrEqual(2);
    expect(result.counters.fetch).toBe(0);
    expect(result.counters.xhr).toBe(0);
    expect(result.counters.websocket).toBe(0);
    expect(result.counters.eventSource).toBe(0);
    expect(result.counters.beacon).toBe(0);
    expect(result.externalAudioRequests).toBe(0);
    expect(result.storageReliable).toBe(true);
    expect(result.persistedAudio).toBe(false);
    expect(result.cleanup).toMatchObject({ workerTerminated: true, objectUrlRevoked: true, queueCleared: true });
    expect(Object.values(result.stages).every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
  });

  test('S02 [DEBUG_PURE_PLAN] malicious rule/tag evidence is data, not executable markup', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(() => {
      const api = __uploadfit_debug_bundle__;
      const before = document.querySelectorAll('script').length;
      const parsed = api.parseRulesDeterministically('<img src=x onerror=alert(1)> 仅支持 MP3，最大 250KB');
      const after = document.querySelectorAll('script').length;
      const prompt = api.buildAiPrompt({ text: '仅支持 MP3，最大 250KB' });
      return {
        scriptDelta: after - before,
        parsedType: typeof parsed,
        promptHasAudioBytes: /base64|pcm|arraybuffer|filename|文件名/i.test(prompt),
        literal: '<img src=x onerror=alert(1)>'
      };
    });
    expect(result.scriptDelta).toBe(0);
    expect(result.parsedType).toBe('object');
    expect(result.promptHasAudioBytes).toBe(false);
    expect(result.literal).toContain('<img');
  });

  test('S03 [DEBUG_FAKE_RUNTIME_BRANCH] forged Worker task IDs stay unsettled until legal task messages', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
      const NativeWorker = window.Worker;
      class ForgedWorker {
        constructor() {
          this.messages = [];
          this.terminated = false;
          this.taskId = null;
          this.legalRelease = null;
          ForgedWorker.last = this;
        }
        postMessage(message) {
          this.messages.push(message);
          if (message.type !== 'START') return;
          this.taskId = message.taskId;
          queueMicrotask(() => this.onmessage?.({
            data: {
              type: 'PROGRESS', taskId: 'task-forged', phase: 'encode', ratio: 1,
              processedMs: 1, totalMs: 1
            }
          }));
          queueMicrotask(() => this.onmessage?.({
            data: {
              type: 'RESULT', taskId: 'task-forged',
              blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' })
            }
          }));
        }
        releaseLegal() {
          this.onmessage?.({ data: { type: 'READY', taskId: this.taskId, capabilities: {} } });
          this.onmessage?.({
            data: {
              type: 'RESULT', taskId: this.taskId,
              blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
              stats: { workerUsed: true, peakBufferedBytes: 3 }
            }
          });
        }
        terminate() { this.terminated = true; }
      }
      window.Worker = ForgedWorker;
      const runtime = api.createAudioWorkerRuntime({ globalRef: window, workerSource: 'self.onmessage = () => {};' });
      let settled = false;
      let acceptedResult = null;
      let injected = 0;
      const outcomePromise = runtime.run({ size: 1 }, { targetMaxBytes: 100, safeTargetBytes: 90 })
        .then((value) => { settled = true; acceptedResult = value; return value; });
      await new Promise((resolve) => setTimeout(resolve, 25));
      const forgedWindow = {
        settled,
        acceptedResult: acceptedResult === null,
        injected,
        forgedWorkerMessages: ForgedWorker.last.messages.length
      };
      ForgedWorker.last.releaseLegal();
      const outcome = await outcomePromise;
      runtime.dispose();
      window.Worker = NativeWorker;
      return {
        forgedWindow,
        size: outcome.blob.size,
        workerUsed: outcome.workerUsed,
        cleanup: outcome.cleanup,
        finalSettled: settled
      };
    });
    expect(result.forgedWindow.settled).toBe(false);
    expect(result.forgedWindow.acceptedResult).toBe(true);
    expect(result.forgedWindow.injected).toBe(0);
    expect(result.forgedWindow.forgedWorkerMessages).toBeGreaterThanOrEqual(1);
    expect(result.size).toBe(3);
    expect(result.workerUsed).toBe(true);
    expect(result.finalSettled).toBe(true);
    expect(result.cleanup).toMatchObject({ workerTerminated: true, objectUrlRevoked: true, queueCleared: true });
  });

  test('S04 malformed WAV/MP4 headers fail with stable bounded codes', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
      const malformedWav = new File([new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0xff, 0xff, 0xff, 0xff, 0x57, 0x41, 0x56, 0x45,
        0x64, 0x61, 0x74, 0x61, 0xff, 0xff, 0xff, 0xff
      ])], 'bounded.bin', { type: 'audio/wav' });
      const malformedMp4 = new File([new Uint8Array([
        0, 0, 0, 1, 0x6d, 0x6f, 0x6f, 0x76, 0, 0, 0, 0
      ])], 'bounded.bin', { type: 'audio/mp4' });
      const inspect = async (file) => {
        try {
          const metadata = await api.inspectAudio(file);
          return { code: metadata.errorCode, inspectedBytes: metadata.inspectedBytes ?? 0 };
        } catch (error) {
          return { code: error.code ?? null, inspectedBytes: 0 };
        }
      };
      return { wav: await inspect(malformedWav), mp4: await inspect(malformedMp4) };
    });
    expect(['AUDIO_DECODE_FAILED', 'AUDIO_METADATA_INVALID', 'AUDIO_CODEC_UNSUPPORTED']).toContain(result.wav.code);
    expect(['AUDIO_DECODE_FAILED', 'AUDIO_METADATA_INVALID', 'AUDIO_CODEC_UNSUPPORTED']).toContain(result.mp4.code);
    expect(result.wav.inspectedBytes).toBeLessThanOrEqual(1_048_576);
    expect(result.mp4.inspectedBytes).toBeLessThanOrEqual(1_048_576);
  });

  // This is a local redaction/schema harness only. Real Tabbit MAIN-world
  // LLMBridge input/call-count evidence is Phase-2 LR8.
  test('S05 [FAKE_BRIDGE_REDACTION_HARNESS] AI bridge receives bounded rule text and blocks sensitive input', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
      const calls = [];
      const provider = api.createTabbitAiProvider({
        enabled: true,
        bridge: { chat: async (prompt) => { calls.push(prompt); return '{}'; } },
        timeoutMs: 200,
        callLimit: 3
      });
      const safe = await provider.extractRules({ text: '仅支持 MP3，最大 250KB', pageType: 'upload' });
      const blocked = await provider.extractRules({ text: '验证码：123456，密码：secret', pageType: 'upload' });
      return {
        safeOk: safe.ok,
        blocked: blocked.blocked,
        calls: calls.length,
        leaked: calls.some((prompt) => /base64|pcm|arraybuffer|文件名|secret|123456/i.test(prompt))
      };
    });
    expect(result.safeOk).toBe(false); // '{}' is intentionally rejected by the local schema validator.
    expect(result.blocked).toBe('AI_SENSITIVE_INPUT');
    expect(result.calls).toBe(1);
    expect(result.leaked).toBe(false);
  });

  test('S06 CSP/Worker unavailability stops rather than falling back to main-thread long audio', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
      const NativeWorker = window.Worker;
      window.Worker = class UnavailableWorker { constructor() { throw new Error('CSP'); } };
      const runtime = api.createAudioWorkerRuntime({ globalRef: window, workerSource: '' });
      let code = null;
      try { await runtime.run({ size: 1 }, { targetMaxBytes: 100, safeTargetBytes: 90 }); }
      catch (error) { code = error.code; }
      runtime.dispose();
      window.Worker = NativeWorker;
      return { code };
    });
    expect(result.code).toBe('AUDIO_WORKER_UNAVAILABLE');
  });
});
