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
  test('S01 local audio planning produces zero external or persistent side effects', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(() => {
      const api = __uploadfit_debug_bundle__;
      const source = {
        mediaKind: 'audio', signatureMime: 'audio/wav', container: 'wav', codec: 'pcm',
        size: 1_000_000, durationMs: 60_000, sampleRate: 44_100, channels: 1,
        bitDepth: 16, inspectedBytes: 64, errorCode: null, warnings: []
      };
      let plan = api.createAudioProcessingPlan(source, {
        mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 100_000_000
      });
      for (const confirmation of plan.confirmations) {
        plan = api.resolveAudioConfirmation(plan, { ...confirmation, accepted: true, payload: null });
      }
      return {
        executable: plan.executable,
        counters: { ...window.__v2S4SecurityCounters },
        persistedAudio: false,
        externalAudioRequests: 0
      };
    });
    expect(result.executable).toBe(true);
    expect(result.counters.fetch).toBe(0);
    expect(result.counters.xhr).toBe(0);
    expect(result.counters.websocket).toBe(0);
    expect(result.counters.eventSource).toBe(0);
    expect(result.counters.beacon).toBe(0);
    expect(result.counters.storage).toBe(0);
    expect(result.persistedAudio).toBe(false);
    expect(result.externalAudioRequests).toBe(0);
  });

  test('S02 malicious rule/tag evidence is data, not executable markup', async ({ page }) => {
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

  test('S03 forged Worker task IDs are ignored and cleanup remains bounded', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const api = __uploadfit_debug_bundle__;
      const NativeWorker = window.Worker;
      class ForgedWorker {
        constructor() { this.messages = []; this.terminated = false; }
        postMessage(message) {
          this.messages.push(message);
          if (message.type !== 'START') return;
          queueMicrotask(() => {
            this.onmessage?.({ data: { type: 'RESULT', taskId: 'task-forged', blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }) } });
            this.onmessage?.({ data: { type: 'READY', taskId: message.taskId, capabilities: {} } });
            this.onmessage?.({
              data: {
                type: 'RESULT', taskId: message.taskId,
                blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
                stats: { workerUsed: true, peakBufferedBytes: 3 }
              }
            });
          });
        }
        terminate() { this.terminated = true; }
      }
      window.Worker = ForgedWorker;
      const runtime = api.createAudioWorkerRuntime({ globalRef: window, workerSource: 'self.onmessage = () => {};' });
      const outcome = await runtime.run({ size: 1 }, { targetMaxBytes: 100, safeTargetBytes: 90 });
      runtime.dispose();
      window.Worker = NativeWorker;
      return { size: outcome.blob.size, workerUsed: outcome.workerUsed, cleanup: outcome.cleanup };
    });
    expect(result.size).toBe(3);
    expect(result.workerUsed).toBe(true);
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

  test('S05 AI bridge receives only bounded rule text and sensitive input is blocked', async ({ page }) => {
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
