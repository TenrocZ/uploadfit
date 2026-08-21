import { test, expect } from '@playwright/test';
import { createAudioWorkerRuntime } from '../../src/audio/worker-runtime.js';

class FakeWorker {
  static instances = [];
  constructor() {
    this.messages = [];
    this.terminated = false;
    FakeWorker.instances.push(this);
  }
  postMessage(message) {
    this.messages.push(message);
    queueMicrotask(() => {
      if (message.type === 'START') {
        this.onmessage?.({ data: { type: 'READY', taskId: message.taskId, capabilities: {} } });
        this.onmessage?.({ data: { type: 'PROGRESS', taskId: message.taskId, phase: 'encode', ratio: 1 } });
        this.onmessage?.({
          data: {
            type: 'RESULT', taskId: message.taskId,
            blob: new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x64])], { type: 'audio/mpeg' }),
            stats: { workerUsed: true }
          }
        });
      }
    });
  }
  terminate() { this.terminated = true; }
}

function globals() {
  const urls = new Set();
  return {
    Worker: FakeWorker,
    Blob,
    URL: {
      createObjectURL() { const value = `blob:test-${urls.size}`; urls.add(value); return value; },
      revokeObjectURL(value) { urls.delete(value); }
    },
    setTimeout,
    clearTimeout,
    performance,
    urls
  };
}

test.describe('S2 audio worker protocol', () => {
  test('uses strict task IDs and cleans the worker/object URL after RESULT', async () => {
    const globalRef = globals();
    const runtime = createAudioWorkerRuntime({ globalRef, workerSource: 'self.onmessage = () => {};' });
    const result = await runtime.run({ size: 1 }, { targetMaxBytes: 100, safeTargetBytes: 90 });
    expect(result.workerUsed).toBe(true);
    expect(result.blob.type).toBe('audio/mpeg');
    expect(result.cleanup.workerTerminated).toBe(true);
    expect(result.cleanup.objectUrlRevoked).toBe(true);
    expect(globalRef.urls.size).toBe(0);
    expect(FakeWorker.instances[0].messages.map((item) => item.type)).toEqual(['START', 'DISPOSE']);
  });

  test('maps AbortSignal to CANCEL and stable cancellation code', async () => {
    class CancelWorker extends FakeWorker {
      postMessage(message) {
        this.messages.push(message);
        if (message.type === 'START') queueMicrotask(() => this.onmessage?.({ data: { type: 'READY', taskId: message.taskId } }));
      }
    }
    const globalRef = globals();
    globalRef.Worker = CancelWorker;
    const runtime = createAudioWorkerRuntime({ globalRef, workerSource: '' });
    const controller = new AbortController();
    const pending = runtime.run({ size: 1 }, { targetMaxBytes: 100, safeTargetBytes: 90 }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'AUDIO_PROCESSING_CANCELLED' });
    await expect(pending).rejects.toMatchObject({
      details: { cleanup: { workerTerminated: true, objectUrlRevoked: true, queueCleared: true } }
    });
    expect(CancelWorker.instances.at(-1).messages.map((item) => item.type)).toContain('CANCEL');
  });

  test('rejects with AUDIO_WORKER_UNAVAILABLE when the Worker constructor throws', async () => {
    const globalRef = globals();
    globalRef.Worker = class {
      constructor() { throw new Error('blocked by CSP'); }
    };
    const runtime = createAudioWorkerRuntime({ globalRef, workerSource: 'self.onmessage = () => {};' });
    await expect(runtime.run({ size: 1 }, { targetMaxBytes: 100, safeTargetBytes: 90 }))
      .rejects.toMatchObject({ code: 'AUDIO_WORKER_UNAVAILABLE' });
    expect(globalRef.urls.size).toBe(0);
  });

  test('ignores messages whose taskId does not match the active task', async () => {
    class MismatchWorker extends FakeWorker {
      postMessage(message) {
        this.messages.push(message);
        if (message.type === 'START') {
          queueMicrotask(() => {
            // A stale/foreign task result arrives first and must be ignored.
            this.onmessage?.({ data: { type: 'RESULT', taskId: 'other-task', blob: new Blob([new Uint8Array([1])]) } });
            this.onmessage?.({ data: { type: 'READY', taskId: message.taskId, capabilities: {} } });
            this.onmessage?.({
              data: {
                type: 'RESULT', taskId: message.taskId,
                blob: new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x64])], { type: 'audio/mpeg' }),
                stats: { workerUsed: true }
              }
            });
          });
        }
      }
    }
    const globalRef = globals();
    globalRef.Worker = MismatchWorker;
    const runtime = createAudioWorkerRuntime({ globalRef, workerSource: 'self.onmessage = () => {};' });
    const result = await runtime.run({ size: 1 }, { targetMaxBytes: 100, safeTargetBytes: 90 });
    expect(result.workerUsed).toBe(true);
    expect(result.blob.size).toBe(4);
  });

  test('maps worker ERROR payloads to their stable code', async () => {
    class ErrorWorker extends FakeWorker {
      postMessage(message) {
        this.messages.push(message);
        if (message.type === 'START') {
          queueMicrotask(() => {
            this.onmessage?.({ data: { type: 'READY', taskId: message.taskId } });
            this.onmessage?.({ data: { type: 'ERROR', taskId: message.taskId, errorCode: 'AUDIO_DECODE_FAILED' } });
          });
        }
      }
    }
    const globalRef = globals();
    globalRef.Worker = ErrorWorker;
    const runtime = createAudioWorkerRuntime({ globalRef, workerSource: '' });
    await expect(runtime.run({ size: 1 }, { targetMaxBytes: 100, safeTargetBytes: 90 }))
      .rejects.toMatchObject({ code: 'AUDIO_DECODE_FAILED' });
  });

  test('force-terminates a worker that ignores CANCEL within the 1s deadline', async () => {
    class SilentWorker extends FakeWorker {
      postMessage(message) {
        this.messages.push(message);
        if (message.type === 'START') queueMicrotask(() => this.onmessage?.({ data: { type: 'READY', taskId: message.taskId } }));
        // CANCEL is swallowed on purpose: no CANCELLED, no RESULT, no ERROR.
      }
    }
    const globalRef = globals();
    globalRef.Worker = SilentWorker;
    const runtime = createAudioWorkerRuntime({ globalRef, workerSource: '' });
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = runtime.run({ size: 1 }, { targetMaxBytes: 100, safeTargetBytes: 90 }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: 'AUDIO_PROCESSING_CANCELLED',
      details: { forcedTerminate: true }
    });
    // The runtime's hard deadline is 1000ms; allow a small scheduler margin
    // while keeping this well below the old multi-second false-green window.
    expect(Date.now() - startedAt).toBeLessThanOrEqual(1500);
    expect(SilentWorker.instances.at(-1).terminated).toBe(true);
    expect(globalRef.urls.size).toBe(0);
  });

  test('runs a second task on the same runtime after the first completes', async () => {
    const globalRef = globals();
    const runtime = createAudioWorkerRuntime({ globalRef, workerSource: 'self.onmessage = () => {};' });
    const plan = { targetMaxBytes: 100, safeTargetBytes: 90 };
    const first = await runtime.run({ size: 1 }, plan);
    const second = await runtime.run({ size: 2 }, plan);
    expect(first.workerUsed).toBe(true);
    expect(second.workerUsed).toBe(true);
    expect(FakeWorker.instances.length).toBeGreaterThanOrEqual(2);
  });

  test('settles and fully cleans an active task immediately on dispose', async () => {
    class SilentWorker extends FakeWorker {
      postMessage(message) {
        this.messages.push(message);
        if (message.type === 'START') {
          queueMicrotask(() => this.onmessage?.({ data: { type: 'READY', taskId: message.taskId } }));
        }
      }
    }
    const globalRef = globals();
    globalRef.Worker = SilentWorker;
    const runtime = createAudioWorkerRuntime({ globalRef, workerSource: '' });
    const startedAt = Date.now();
    const pending = runtime.run(
      { size: 1 },
      { targetMaxBytes: 100, safeTargetBytes: 90 },
      { timeoutMs: 1000 }
    );
    runtime.dispose();
    await expect(pending).rejects.toMatchObject({
      code: 'AUDIO_PROCESSING_CANCELLED',
      details: { cleanup: { workerTerminated: true, objectUrlRevoked: true, queueCleared: true } }
    });
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(globalRef.urls.size).toBe(0);
    expect(SilentWorker.instances.at(-1).terminated).toBe(true);
    runtime.dispose();
    await expect(runtime.run({ size: 1 }, { targetMaxBytes: 100, safeTargetBytes: 90 }))
      .rejects.toMatchObject({ code: 'AUDIO_WORKER_UNAVAILABLE' });
  });

  test('ignores a late RESULT emitted after active dispose', async () => {
    class LateResultWorker extends FakeWorker {
      postMessage(message) {
        this.messages.push(message);
        if (message.type === 'START') {
          queueMicrotask(() => this.onmessage?.({ data: { type: 'READY', taskId: message.taskId } }));
        }
        if (message.type === 'DISPOSE') {
          queueMicrotask(() => this.onmessage?.({
            data: {
              type: 'RESULT', taskId: message.taskId,
              blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' })
            }
          }));
        }
      }
    }
    const globalRef = globals();
    globalRef.Worker = LateResultWorker;
    const runtime = createAudioWorkerRuntime({ globalRef, workerSource: '' });
    const pending = runtime.run({ size: 1 }, { targetMaxBytes: 100, safeTargetBytes: 90 });
    runtime.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'AUDIO_PROCESSING_CANCELLED' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(globalRef.urls.size).toBe(0);
  });
});
