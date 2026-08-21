import { test, expect } from '@playwright/test';
import { createAudioHandler } from '../../src/audio/handler.js';
import { createAudioProcessingPlan, resolveAudioConfirmation } from '../../src/audio/planner.js';
import { createMediaHandlerRegistry } from '../../src/core/media-handlers.js';

test.describe('S2 audio MediaHandler boundary', () => {
  test('exposes the ordered S2 methods without controller/UI registration', () => {
    const handler = createAudioHandler();
    expect(handler.kind).toBe('audio');
    expect(handler.supports(new File([new Uint8Array([1])], 'voice.mp3', { type: 'audio/mpeg' }), {
      mediaKind: 'audio', multiple: false
    })).toBe(true);
    expect(handler.supports(new File([new Uint8Array([1])], 'voice.mp3', { type: 'audio/mpeg' }), {
      mediaKind: 'image', multiple: false
    })).toBe(false);
    expect(typeof handler.inspect).toBe('function');
    expect(typeof handler.validate).toBe('function');
    expect(typeof handler.plan).toBe('function');
    expect(typeof handler.resolveConfirmation).toBe('function');
    expect(typeof handler.process).toBe('function');
    expect(typeof handler.validateOutput).toBe('function');
    handler.dispose();
  });

  test('registers image and audio adapters and rejects unknown kinds', () => {
    const registry = createMediaHandlerRegistry({ audioHandler: createAudioHandler() });
    expect(registry.kinds()).toEqual(['image', 'audio']);
    expect(registry.get('audio').kind).toBe('audio');
    expect(registry.get('video').supports()).toBe(false);
    registry.dispose();
  });

  test('active handler dispose settles a self-created runtime without waiting for timeout', async () => {
    class SilentWorker {
      constructor() { this.terminated = false; }
      postMessage(message) {
        if (message.type === 'START') {
          queueMicrotask(() => this.onmessage?.({ data: { type: 'READY', taskId: message.taskId } }));
        }
      }
      terminate() { this.terminated = true; }
    }
    const urls = new Set();
    const globalRef = {
      Worker: SilentWorker,
      Blob,
      URL: {
        createObjectURL() { const url = `blob:handler-${urls.size}`; urls.add(url); return url; },
        revokeObjectURL(url) { urls.delete(url); }
      },
      setTimeout,
      clearTimeout,
      performance
    };
    const metadata = {
      mediaKind: 'audio', signatureMime: 'audio/wav', container: 'wav', codec: 'pcm',
      size: 2_000_000, durationMs: 10_000, sampleRate: 44_100, channels: 2,
      inspectedBytes: 1024
    };
    const rules = {
      mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 1_000_000
    };
    let plan = createAudioProcessingPlan(metadata, rules);
    plan = resolveAudioConfirmation(plan, { ...plan.confirmations[0], accepted: true });
    const handler = createAudioHandler({ workerOptions: { globalRef, workerSource: '' } });
    const startedAt = Date.now();
    const pending = handler.process(
      new File([new Uint8Array([1])], 'voice.wav', { type: 'audio/wav' }),
      plan,
      { metadata, rules, timeoutMs: 1000 }
    );
    handler.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'AUDIO_PROCESSING_CANCELLED' });
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(urls.size).toBe(0);
  });
});
