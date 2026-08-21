import { expect, test } from '@playwright/test';
import { buildS2WorkerImplementation } from '../../scripts/audio-probe/build-s2-adapter.mjs';

/*
 * Real frozen-lamejs Worker coverage for the S2 engine.  These cases run the
 * full chain inspect -> plan -> resolveConfirmation -> processAudio ->
 * validateAudioOutput inside a real browser page with a real Blob Worker
 * (scripts/audio-probe/s2-worker-adapter.js, encoder frozen by ADR-005).
 * Fake-runtime protocol tests live in audio-worker.test.js / audio-pipeline.test.js.
 */

let implementationSourcePromise = null;
function implementationSource() {
  implementationSourcePromise ??= buildS2WorkerImplementation();
  return implementationSourcePromise;
}

async function installRunner(page, source) {
  await page.goto('/test-pages/probe.html');
  await page.evaluate(async (impl) => {
    const metadata = await import('/src/audio/metadata.js');
    const planner = await import('/src/audio/planner.js');
    const pipeline = await import('/src/audio/pipeline.js');
    const workerRuntime = await import('/src/audio/worker-runtime.js');
    const validators = await import('/src/audio/validators.js');
    window.__s2Runtime = workerRuntime.createAudioWorkerRuntime({ implementationSource: impl });
    window.__s2Wav = (seconds, sampleRate = 44100, channels = 2) => {
      const frames = Math.round(seconds * sampleRate);
      const dataBytes = frames * channels * 2;
      const bytes = new Uint8Array(44 + dataBytes);
      const view = new DataView(bytes.buffer);
      const put = (offset, value) => [...value].forEach((char, index) => {
        bytes[offset + index] = char.charCodeAt(0);
      });
      put(0, 'RIFF');
      view.setUint32(4, bytes.length - 8, true);
      put(8, 'WAVE');
      put(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, channels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * channels * 2, true);
      view.setUint16(32, channels * 2, true);
      view.setUint16(34, 16, true);
      put(36, 'data');
      view.setUint32(40, dataBytes, true);
      for (let frame = 0; frame < frames; frame += 1) {
        const sample = Math.round(Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 12000);
        for (let channel = 0; channel < channels; channel += 1) {
          view.setInt16(44 + (frame * channels + channel) * 2, sample, true);
        }
      }
      return new File([bytes], 'voice.wav', { type: 'audio/wav' });
    };
    window.__s2FakeMp4 = () => {
      const bytes = new Uint8Array(64);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, 64);
      bytes.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'
      bytes.set([0x4d, 0x34, 0x41, 0x20], 8); // 'M4A '
      bytes.set([0x69, 0x73, 0x6f, 0x6d], 12);
      return new File([bytes], 'voice.m4a', { type: 'audio/mp4' });
    };
    window.__s2Run = async (file, maxBytes, opts = {}) => {
      const rules = { mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes };
      const inspected = opts.metadataOverride ?? await metadata.inspectAudio(file);
      let plan = planner.createAudioProcessingPlan(inspected, rules, opts.planOptions ?? {});
      for (const confirmation of plan.confirmations) {
        plan = planner.resolveAudioConfirmation(plan, {
          ...confirmation,
          accepted: opts.decline === true ? false : true
        });
      }
      const planSnapshot = {
        passthrough: plan.passthrough,
        executable: plan.executable,
        operations: [...(plan.operations ?? [])],
        confirmations: plan.confirmations.map((item) => item.type),
        targetBitrateKbps: plan.targetBitrateKbps,
        targetChannels: plan.targetChannels,
        safeTargetBytes: plan.safeTargetBytes,
        unfixable: plan.unfixable
      };
      const progress = [];
      const controller = new AbortController();
      let abortedAt = null;
      const startedAt = performance.now();
      try {
        const result = await pipeline.processAudio(file, plan, {
          rules,
          metadata: inspected,
          signal: opts.signal === false ? undefined : controller.signal,
          workerRuntime: window.__s2Runtime,
          inputChunkBytes: opts.inputChunkBytes,
          onProgress: (event) => {
            progress.push({ ratio: event.ratio, at: performance.now() - startedAt });
            if (opts.abortOnFirstProgress && progress.length === 1) {
              abortedAt = performance.now();
              controller.abort();
            }
          }
        });
        const validation = opts.validateOutput === false ? { valid: true, violations: [] }
          : await validators.validateAudioOutputFile(result.file, rules, plan, inspected);
        window.__s2LastOutput = result.file;
        return {
          ok: true,
          plan: planSnapshot,
          passthrough: result.passthrough,
          encodePasses: result.encodePasses,
          workerUsed: result.workerUsed,
          outputBytes: result.outputBytes,
          outputSize: result.file.size,
          outputType: result.file.type,
          outputName: result.file.name,
          durationMs: result.metadata.durationMs,
          sampleRate: result.metadata.sampleRate,
          channels: result.metadata.channels,
          inputBytesRead: result.inputBytesRead,
          peakBufferedBytes: result.peakBufferedBytes,
          validationValid: validation.valid,
          violations: validation.violations.map((item) => item.code),
          progress
        };
      } catch (error) {
        return {
          ok: false,
          plan: planSnapshot,
          errorCode: error?.code ?? null,
          progress,
          abortLatencyMs: abortedAt === null ? null : performance.now() - abortedAt
        };
      }
    };
  }, source);
}

test.describe('S2 audio engine with the real frozen lamejs Worker', () => {
  test('encodes a PCM WAV through the full chain into a valid MP3', async ({ page }) => {
    await installRunner(page, await implementationSource());
    const result = await page.evaluate(() => window.__s2Run(window.__s2Wav(2), 1_000_000));
    expect(result.ok).toBe(true);
    expect(result.plan.passthrough).toBe(false);
    expect(result.plan.targetBitrateKbps).toBe(320);
    expect(result.encodePasses).toBe(1);
    expect(result.workerUsed).toBe(true);
    expect(result.outputType).toBe('audio/mpeg');
    expect(result.outputName).toBe('voice-uploadfit.mp3');
    expect(result.outputSize).toBeGreaterThan(0);
    expect(result.outputSize).toBeLessThanOrEqual(1_000_000);
    expect(result.validationValid).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.sampleRate).toBe(44100);
    expect(result.channels).toBe(2);
    expect(result.inputBytesRead).toBeGreaterThan(0);
    expect(result.peakBufferedBytes).toBeGreaterThan(0);
    const ratios = result.progress.map((event) => event.ratio);
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThanOrEqual(1);
    }
    for (let index = 1; index < ratios.length; index += 1) {
      expect(ratios[index]).toBeGreaterThanOrEqual(ratios[index - 1]);
    }
    expect(ratios.at(-1)).toBe(1);
  });

  test('honours the planner ladder when the page budget forces a lower rung', async ({ page }) => {
    await installRunner(page, await implementationSource());
    const result = await page.evaluate(() => {
      // maxBytes 147,072 over a 2s source pins the raw bitrate at exactly 64kbps.
      return window.__s2Run(window.__s2Wav(2), 147_072);
    });
    expect(result.ok).toBe(true);
    expect(result.plan.targetBitrateKbps).toBe(64);
    expect(result.outputSize).toBeLessThanOrEqual(147_072);
    // 2s at 64kbps is ~16KB of payload; the encoder must actually have used
    // the planned rung, not the 320kbps default.
    expect(result.outputSize).toBeGreaterThan(8_000);
    expect(result.outputSize).toBeLessThan(40_000);
    expect(result.validationValid).toBe(true);
  });

  test('passes a compliant real MP3 through untouched', async ({ page }) => {
    await installRunner(page, await implementationSource());
    const outcome = await page.evaluate(async () => {
      const first = await window.__s2Run(window.__s2Wav(2), 1_000_000);
      if (!first.ok) return { first };
      const output = window.__s2LastOutput;
      const passthrough = await window.__s2Run(output, 2_000_000);
      return { first, passthrough, outputSize: output.size };
    });
    expect(outcome.first.ok).toBe(true);
    expect(outcome.passthrough.ok).toBe(true);
    expect(outcome.passthrough.passthrough).toBe(true);
    expect(outcome.passthrough.encodePasses).toBe(0);
    expect(outcome.passthrough.workerUsed).toBe(false);
    expect(outcome.passthrough.outputSize).toBe(outcome.outputSize);
    expect(outcome.passthrough.validationValid).toBe(true);
  });

  test('runs a second task on the shared runtime without inherited state', async ({ page }) => {
    await installRunner(page, await implementationSource());
    const outcome = await page.evaluate(async () => {
      const first = await window.__s2Run(window.__s2Wav(1), 1_000_000);
      const second = await window.__s2Run(window.__s2Wav(3, 22050), 1_000_000);
      return { first, second };
    });
    expect(outcome.first.ok).toBe(true);
    expect(outcome.second.ok).toBe(true);
    expect(outcome.second.encodePasses).toBe(1);
    expect(outcome.second.workerUsed).toBe(true);
    expect(outcome.second.sampleRate).toBe(22050);
    expect(outcome.second.validationValid).toBe(true);
  });

  test('stops an M4A source as codec-unsupported instead of promising a transcode', async ({ page }) => {
    await installRunner(page, await implementationSource());
    const result = await page.evaluate(() => window.__s2Run(window.__s2FakeMp4(), 1_000_000, {
      // Fully-parsed M4A metadata: the stop must come from the frozen-subset
      // gate, not from a metadata parse error on the truncated fixture.
      metadataOverride: {
        mediaKind: 'audio',
        fileType: 'audio/mp4',
        signatureMime: 'audio/mp4',
        container: 'mp4',
        codec: 'aac-lc',
        size: 64,
        durationMs: 120_000,
        sampleRate: 44_100,
        channels: 2,
        bitDepth: null,
        averageBitrate: 128_000,
        variableBitrate: false,
        seekable: true,
        inspectedBytes: 64,
        errorCode: null,
        warnings: []
      }
    }));
    expect(result.ok).toBe(false);
    expect(result.plan.unfixable).toContain('AUDIO_CODEC_UNSUPPORTED');
    expect(result.plan.executable).toBe(false);
    expect(result.plan.operations).toEqual([]);
    expect(result.plan.confirmations).toEqual([]);
    expect(result.errorCode).toBe('AUDIO_CODEC_UNSUPPORTED');
  });

  test('cancels a real encode promptly and reports the stable cancellation code', async ({ page }) => {
    await installRunner(page, await implementationSource());
    const result = await page.evaluate(() => {
      // 64KiB chunks give the abort signal a boundary well inside the encode.
      return window.__s2Run(window.__s2Wav(20), 5_000_000, { abortOnFirstProgress: true, inputChunkBytes: 64 * 1024 });
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('AUDIO_PROCESSING_CANCELLED');
    expect(result.abortLatencyMs).not.toBeNull();
    // The runtime forces termination at the 1000ms deadline even if the
    // worker never honours CANCEL, so the rejection must land close to it.
    expect(result.abortLatencyMs).toBeLessThanOrEqual(1000);
  });
});
