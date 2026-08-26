import { test, expect } from '@playwright/test';
import { createAudioProcessingPlan, resolveAudioConfirmation } from '../../src/audio/planner.js';
import { createAudioPipeline, processAudio } from '../../src/audio/pipeline.js';

const metadata = {
  mediaKind: 'audio', signatureMime: 'audio/wav', container: 'wav', codec: 'pcm',
  size: 200_000_001, durationMs: 120_000, sampleRate: 16_000, channels: 2,
  inspectedBytes: 1024
};
const rules = { mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 100_000_000 };

function resolvedPlan() {
  let plan = createAudioProcessingPlan(metadata, rules);
  plan = resolveAudioConfirmation(plan, { ...plan.confirmations[0], accepted: true });
  return plan;
}

function fakeOutput(size) {
  return new Blob([new Uint8Array(size)], { type: 'audio/mpeg' });
}

function outputMetadata() {
  return {
    mediaKind: 'audio', fileType: 'audio/mpeg', signatureMime: 'audio/mpeg',
    container: 'mp3', codec: 'mp3', size: 1, durationMs: 120_000,
    sampleRate: 16_000, channels: 2, frameCount: 100
  };
}

test.describe('S2 audio pipeline harness', () => {
  test('re-encodes at most twice and accepts a second-pass output', async () => {
    const calls = [];
    let disposed = false;
    const runtime = {
      async run(_file, plan, options) {
        calls.push(plan.targetBitrateKbps);
        options.onProgress?.({ phase: 'encode', ratio: calls.length === 1 ? 0.4 : 1 });
        return {
          blob: fakeOutput(calls.length === 1 ? rules.maxBytes + 1 : rules.maxBytes - 1),
          stats: { workerUsed: true, inputBytesRead: metadata.size, peakBufferedBytes: 4 * 1024 * 1024 }
        };
      },
      dispose() { disposed = true; }
    };
    const input = new File([new Uint8Array([0])], 'source.wav', { type: 'audio/wav' });
    const result = await processAudio(input, resolvedPlan(), {
      metadata,
      rules,
      workerRuntime: runtime,
      inspectOutput: async () => outputMetadata(),
      validateOutput: () => ({ valid: true, violations: [], warnings: [], safeAutoFixes: [], requiredConfirmations: [], unfixable: [] })
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBeLessThan(calls[0]);
    expect(result.encodePasses).toBe(2);
    expect(result.workerUsed).toBe(true);
    expect(result.outputBytes).toBe(rules.maxBytes - 1);
    // R2-5: the pipeline does not dispose a caller-provided runtime; the
    // caller owns its lifecycle and can reuse it for a second task.
    expect(disposed).toBe(false);
    runtime.dispose();
    expect(disposed).toBe(true);
  });

  test('rejects concurrent pipelines and does not return a partial result on abort', async () => {
    let release;
    const runtime = {
      run(_file, _plan, options) {
        return new Promise((resolve, reject) => {
          release = () => resolve({ blob: fakeOutput(100), stats: { workerUsed: true } });
          options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('cancel'), { code: 'AUDIO_PROCESSING_CANCELLED' })), { once: true });
        });
      },
      dispose() {}
    };
    const input = new File([new Uint8Array([0])], 'source.wav', { type: 'audio/wav' });
    const controller = new AbortController();
    const first = processAudio(input, resolvedPlan(), {
      metadata, rules, signal: controller.signal, workerRuntime: runtime,
      inspectOutput: async () => outputMetadata(),
      validateOutput: () => ({ valid: true, violations: [], warnings: [], safeAutoFixes: [], requiredConfirmations: [], unfixable: [] })
    });
    await expect(processAudio(input, resolvedPlan(), { metadata, rules, workerRuntime: runtime })).rejects
      .toMatchObject({ code: 'AUDIO_PIPELINE_BUSY' });
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: 'AUDIO_PROCESSING_CANCELLED' });
    release?.();
  });

  test('succeeds in a single pass when the first output fits the budget', async () => {
    const calls = [];
    const runtime = {
      async run(_file, plan) {
        calls.push(plan.targetBitrateKbps);
        return { blob: fakeOutput(rules.maxBytes - 1), stats: { workerUsed: true, inputBytesRead: metadata.size } };
      },
      dispose() {}
    };
    const input = new File([new Uint8Array([0])], 'source.wav', { type: 'audio/wav' });
    const result = await processAudio(input, resolvedPlan(), {
      metadata, rules, workerRuntime: runtime,
      inspectOutput: async () => outputMetadata(),
      validateOutput: () => ({ valid: true, violations: [], warnings: [], safeAutoFixes: [], requiredConfirmations: [], unfixable: [] })
    });
    expect(calls).toHaveLength(1);
    expect(result.encodePasses).toBe(1);
    expect(result.workerUsed).toBe(true);
  });

  test('fails with AUDIO_OUTPUT_TOO_LARGE when both passes exceed the budget', async () => {
    const calls = [];
    const runtime = {
      async run(_file, plan) {
        calls.push(plan.targetBitrateKbps);
        return { blob: fakeOutput(rules.maxBytes + 1), stats: { workerUsed: true } };
      },
      dispose() {}
    };
    const input = new File([new Uint8Array([0])], 'source.wav', { type: 'audio/wav' });
    await expect(processAudio(input, resolvedPlan(), {
      metadata, rules, workerRuntime: runtime,
      inspectOutput: async () => outputMetadata(),
      validateOutput: () => ({ valid: true, violations: [], warnings: [], safeAutoFixes: [], requiredConfirmations: [], unfixable: [] })
    })).rejects.toMatchObject({ code: 'AUDIO_OUTPUT_TOO_LARGE' });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBeLessThan(calls[0]);
    expect(calls[1]).toBeGreaterThanOrEqual(48);
  });

  test('never calls the runtime for unresolved or declined confirmations', async () => {
    let runs = 0;
    const runtime = {
      async run() { runs += 1; return { blob: fakeOutput(1), stats: { workerUsed: true } }; },
      dispose() {}
    };
    const input = new File([new Uint8Array([0])], 'source.wav', { type: 'audio/wav' });
    const unresolved = createAudioProcessingPlan(metadata, rules);
    await expect(processAudio(input, unresolved, {
      metadata, rules, workerRuntime: runtime,
      inspectOutput: async () => outputMetadata(),
      validateOutput: () => ({ valid: true, violations: [], warnings: [], safeAutoFixes: [], requiredConfirmations: [], unfixable: [] })
    })).rejects.toMatchObject({ code: 'AUDIO_CONFIRMATION_REQUIRED' });
    let declined = createAudioProcessingPlan(metadata, rules);
    declined = resolveAudioConfirmation(declined, { ...declined.confirmations[0], accepted: false });
    await expect(processAudio(input, declined, {
      metadata, rules, workerRuntime: runtime,
      inspectOutput: async () => outputMetadata(),
      validateOutput: () => ({ valid: true, violations: [], warnings: [], safeAutoFixes: [], requiredConfirmations: [], unfixable: [] })
    })).rejects.toMatchObject({ code: 'AUDIO_PROCESSING_CANCELLED' });
    expect(runs).toBe(0);
  });

  test('recomputes canonical stops and rejects forged executable plans before runtime use', async () => {
    let runs = 0;
    const runtime = {
      async run() {
        runs += 1;
        return { blob: fakeOutput(10), stats: { workerUsed: true } };
      },
      dispose() {}
    };
    const input = new File([new Uint8Array([0])], 'source.wav', { type: 'audio/wav' });
    const cases = [
      { code: 'OFFICIAL_TOOL_REQUIRED', metadata, rules: { ...rules, safetyFlags: ['OFFICIAL_TOOL_REQUIRED'] } },
      { code: 'AUDIO_ORIGINAL_REQUIRED', metadata, rules: { ...rules, safetyFlags: ['AUDIO_ORIGINAL_REQUIRED'] } },
      { code: 'AUDIO_LOSSLESS_REQUIRED', metadata, rules: { ...rules, safetyFlags: ['AUDIO_LOSSLESS_REQUIRED'] } },
      {
        code: 'AUDIO_DURATION_LIMIT_UNFIXABLE',
        metadata,
        rules: { ...rules, duration: { minMs: null, maxMs: 60_000 } }
      },
      {
        code: 'AUDIO_TARGET_UNSAFE',
        metadata: { ...metadata, durationMs: 100_000 },
        rules: { ...rules, maxBytes: 700_000 }
      },
      {
        code: 'AUDIO_CODEC_UNSUPPORTED',
        metadata: {
          ...metadata,
          signatureMime: 'audio/mp4', container: 'mp4', codec: 'alac', size: 10_000_000
        },
        rules
      }
    ];
    for (const item of cases) {
      const canonical = createAudioProcessingPlan(item.metadata, item.rules);
      expect(canonical.unfixable).toContain(item.code);
      const forged = { ...canonical, executable: true, unfixable: [] };
      await expect(processAudio(input, forged, {
        metadata: item.metadata,
        rules: item.rules,
        workerRuntime: runtime,
        inspectOutput: async () => outputMetadata(),
        validateOutput: () => ({ valid: true, violations: [], warnings: [] })
      })).rejects.toMatchObject({ code: item.code });
    }
    expect(runs).toBe(0);
  });

  test('active pipeline dispose settles its self-created runtime immediately', async () => {
    class SilentWorker {
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
        createObjectURL() { const url = `blob:pipeline-${urls.size}`; urls.add(url); return url; },
        revokeObjectURL(url) { urls.delete(url); }
      },
      setTimeout,
      clearTimeout,
      performance
    };
    const pipeline = createAudioPipeline({ workerOptions: { globalRef, workerSource: '' } });
    const pending = pipeline.process(
      new File([new Uint8Array([0])], 'source.wav', { type: 'audio/wav' }),
      resolvedPlan(),
      { metadata, rules, timeoutMs: 1000 }
    );
    pipeline.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'AUDIO_PROCESSING_CANCELLED' });
    expect(urls.size).toBe(0);
  });

  test('surfaces decode errors and maps inspection/validation failures to the stable code', async () => {
    const decodeRuntime = {
      async run() { throw Object.assign(new Error('bad frame'), { code: 'AUDIO_DECODE_FAILED' }); },
      dispose() {}
    };
    const input = new File([new Uint8Array([0])], 'source.wav', { type: 'audio/wav' });
    await expect(processAudio(input, resolvedPlan(), {
      metadata, rules, workerRuntime: decodeRuntime,
      inspectOutput: async () => outputMetadata(),
      validateOutput: () => ({ valid: true, violations: [], warnings: [], safeAutoFixes: [], requiredConfirmations: [], unfixable: [] })
    })).rejects.toMatchObject({ code: 'AUDIO_DECODE_FAILED' });

    const encodeRuntime = {
      async run() { return { blob: fakeOutput(10), stats: { workerUsed: true } }; },
      dispose() {}
    };
    await expect(processAudio(input, resolvedPlan(), {
      metadata, rules, workerRuntime: encodeRuntime,
      inspectOutput: async () => { throw Object.assign(new Error('corrupt'), { code: 'AUDIO_DECODE_FAILED' }); },
      validateOutput: () => ({ valid: true, violations: [], warnings: [], safeAutoFixes: [], requiredConfirmations: [], unfixable: [] })
    })).rejects.toMatchObject({ code: 'AUDIO_OUTPUT_VALIDATION_FAILED' });

    let validateCalls = 0;
    await expect(processAudio(input, resolvedPlan(), {
      metadata, rules, workerRuntime: encodeRuntime,
      inspectOutput: async () => outputMetadata(),
      validateOutput: () => {
        validateCalls += 1;
        return { valid: false, violations: [{ code: 'AUDIO_NO_AUDIO_FRAMES' }], warnings: [], safeAutoFixes: [], requiredConfirmations: [], unfixable: [] };
      }
    })).rejects.toMatchObject({ code: 'AUDIO_OUTPUT_VALIDATION_FAILED', details: { violations: ['AUDIO_NO_AUDIO_FRAMES'] } });
    expect(validateCalls).toBe(1);
  });

  test('clamps progress to monotonic 0-1 values and throttles bursts', async () => {
    const emitted = [0.1, 0.5, 0.2, 0.6, 0.4, 1];
    const runtime = {
      async run(_file, _plan, options) {
        for (const ratio of emitted) {
          options.onProgress?.({ phase: 'encode', ratio });
        }
        return { blob: fakeOutput(10), stats: { workerUsed: true } };
      },
      dispose() {}
    };
    const received = [];
    const input = new File([new Uint8Array([0])], 'source.wav', { type: 'audio/wav' });
    await processAudio(input, resolvedPlan(), {
      metadata, rules, workerRuntime: runtime,
      onProgress: (event) => received.push(event.ratio),
      inspectOutput: async () => outputMetadata(),
      validateOutput: () => ({ valid: true, violations: [], warnings: [], safeAutoFixes: [], requiredConfirmations: [], unfixable: [] })
    });
    expect(received.length).toBeGreaterThan(0);
    expect(received.length).toBeLessThan(emitted.length);
    for (const ratio of received) {
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThanOrEqual(1);
    }
    for (let index = 1; index < received.length; index += 1) {
      expect(received[index]).toBeGreaterThanOrEqual(received[index - 1]);
    }
    expect(received.at(-1)).toBe(1);
  });

  test('reuses a caller-provided runtime across sequential tasks', async () => {
    let runs = 0;
    let disposed = false;
    const runtime = {
      async run() {
        runs += 1;
        return { blob: fakeOutput(10), stats: { workerUsed: true } };
      },
      dispose() { disposed = true; }
    };
    const input = new File([new Uint8Array([0])], 'source.wav', { type: 'audio/wav' });
    const options = {
      metadata, rules, workerRuntime: runtime,
      inspectOutput: async () => outputMetadata(),
      validateOutput: () => ({ valid: true, violations: [], warnings: [], safeAutoFixes: [], requiredConfirmations: [], unfixable: [] })
    };
    const first = await processAudio(input, resolvedPlan(), options);
    const second = await processAudio(input, resolvedPlan(), options);
    expect(first.encodePasses).toBe(1);
    expect(second.encodePasses).toBe(1);
    expect(runs).toBe(2);
    // The pipeline must not dispose a runtime it does not own.
    expect(disposed).toBe(false);
    runtime.dispose();
    expect(disposed).toBe(true);
  });
});
