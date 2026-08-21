import { describe, expect, it } from 'vitest';
import {
  AUDIO_BITRATE_LADDER_KBPS,
  createAudioProcessingPlan,
  isAudioPlanExecutable,
  resolveAudioConfirmation
} from '../../src/audio/planner.js';

function metadata(overrides = {}) {
  return {
    mediaKind: 'audio',
    signatureMime: 'audio/wav',
    container: 'wav',
    codec: 'pcm',
    size: 200_000_001,
    durationMs: 120_000,
    sampleRate: 16_000,
    channels: 2,
    bitDepth: 16,
    ...overrides
  };
}

function rules(overrides = {}) {
  return {
    mediaKind: 'audio',
    formats: ['audio/mpeg'],
    extensions: ['.mp3'],
    maxBytes: 100_000_000,
    ...overrides
  };
}

describe('S2 audio planner', () => {
  it('uses the 95% target and 64 KiB reserve without mutating inputs', () => {
    const source = metadata();
    const pageRules = rules();
    const sourceBefore = JSON.stringify(source);
    const rulesBefore = JSON.stringify(pageRules);
    const plan = createAudioProcessingPlan(source, pageRules);
    expect(plan.safeTargetBytes).toBe(95_000_000);
    expect(plan.targetMaxBytes).toBe(100_000_000);
    expect(plan.targetBitrateKbps).toBe(320);
    expect(plan.encodePassLimit).toBe(2);
    expect(JSON.stringify(source)).toBe(sourceBefore);
    expect(JSON.stringify(pageRules)).toBe(rulesBefore);
  });

  it('selects every discrete ladder boundary and rejects an impossible 48 kbps target', () => {
    for (const bitrate of AUDIO_BITRATE_LADDER_KBPS) {
      // Add exactly enough bytes for the requested raw bitrate plus reserve.
      const durationMs = 10_000;
      const maxBytes = Math.ceil((bitrate * 1000 * (durationMs / 1000) / 8) / 0.95) + 64 * 1024;
      const plan = createAudioProcessingPlan(metadata({ durationMs }), rules({ maxBytes }));
      expect(plan.targetBitrateKbps).toBeGreaterThanOrEqual(48);
      expect(AUDIO_BITRATE_LADDER_KBPS).toContain(plan.targetBitrateKbps);
    }
    const unsafe = createAudioProcessingPlan(
      metadata({ durationMs: 20_000 }),
      rules({ maxBytes: 65_537 })
    );
    expect(unsafe.unfixable).toContain('AUDIO_TARGET_UNSAFE');
    expect(unsafe.executable).toBe(false);
  });

  it('passes through an explicitly allowed, compliant MP3', () => {
    const plan = createAudioProcessingPlan(metadata({
      signatureMime: 'audio/mpeg',
      container: 'mp3',
      codec: 'mp3',
      size: 100_000,
      durationMs: 2_000,
      averageBitrate: 128_000
    }), rules({ maxBytes: 200_000 }));
    expect(plan.passthrough).toBe(true);
    expect(plan.executable).toBe(true);
    expect(plan.operations).toEqual([]);
    expect(plan.confirmations).toEqual([]);
  });

  it('requires lossy and mono confirmations and rejects tampered payloads', () => {
    const plan = createAudioProcessingPlan(metadata(), rules(), { targetChannels: 1 });
    expect(plan.confirmations.map((item) => item.type)).toEqual([
      'AUDIO_LOSSY_TRANSCODE',
      'AUDIO_DOWNMIX_MONO'
    ]);
    expect(plan.executable).toBe(false);
    const first = plan.confirmations[0];
    expect(() => resolveAudioConfirmation(plan, {
      ...first,
      accepted: true,
      payload: { ...first.suggestedPayload, bitrateKbps: 48 }
    })).toThrow();
    const accepted = resolveAudioConfirmation(plan, { ...first, accepted: true });
    expect(accepted.executable).toBe(false);
    const final = resolveAudioConfirmation(accepted, {
      ...accepted.confirmations[1],
      accepted: true
    });
    expect(final.executable).toBe(true);
    expect(plan.confirmations[0].resolved).toBe(false);
    expect(() => resolveAudioConfirmation(final, { ...final.confirmations[0], accepted: true })).toThrow();
    expect(() => resolveAudioConfirmation(final, {
      id: 'forged', type: 'AUDIO_LOSSY_TRANSCODE', accepted: true
    })).toThrow();
  });

  it('stops when MP3 is not explicitly allowed or maxBytes is missing', () => {
    expect(createAudioProcessingPlan(metadata(), rules({ formats: ['audio/wav'], extensions: [] })).unfixable)
      .toContain('AUDIO_OUTPUT_FORMAT_NOT_ALLOWED');
    expect(createAudioProcessingPlan(metadata(), rules({ maxBytes: undefined })).unfixable)
      .toContain('RULES_INSUFFICIENT');
  });

  it('never treats a plan with unfixable stops as executable', () => {
    const stopped = createAudioProcessingPlan(metadata(), rules({
      safetyFlags: ['OFFICIAL_TOOL_REQUIRED']
    }));
    expect(stopped.unfixable).toContain('OFFICIAL_TOOL_REQUIRED');
    expect(isAudioPlanExecutable({ ...stopped, executable: true })).toBe(false);
    expect(isAudioPlanExecutable({ ...stopped, executable: true, unfixable: null })).toBe(false);
  });

  it('pins exact ladder rungs from hand-computed budgets', () => {
    const cases = [
      // (maxBytes, durationMs) -> expected kbps.  Each maxBytes is chosen so
      // safeTarget = min(floor(0.95*max), max-64KiB) lands exactly on the raw
      // bitrate in the comment; see S2.1 step 4-6.
      { maxBytes: 4_800_000, durationMs: 100_000, expected: 320 }, // raw ~359kbps, clamped to the top rung
      { maxBytes: 2_000_000, durationMs: 100_000, expected: 128 }, // raw ~146kbps
      { maxBytes: 1_759_775, durationMs: 100_000, expected: 128 }, // raw exactly 128.5 -> 128
      { maxBytes: 1_753_065, durationMs: 100_000, expected: 112 }, // raw 127.99 falls through the gap to 112
      { maxBytes: 1_000_000, durationMs: 100_000, expected: 64 }, // raw ~69kbps, 48kbps floor is feasible
      { maxBytes: 147_072, durationMs: 2_000, expected: 64 } // raw exactly 64kbps at 2s
    ];
    for (const { maxBytes, durationMs, expected } of cases) {
      const plan = createAudioProcessingPlan(metadata({ durationMs }), rules({ maxBytes }));
      expect(plan.unfixable).toEqual([]);
      expect(plan.targetBitrateKbps).toBe(expected);
      expect(AUDIO_BITRATE_LADDER_KBPS).toContain(plan.targetBitrateKbps);
    }
  });

  it('stops as target-unsafe when even 48kbps cannot fit', () => {
    // raw ~45kbps at 100s is below the 48kbps floor.
    const plan = createAudioProcessingPlan(metadata({ durationMs: 100_000 }), rules({ maxBytes: 700_000 }));
    expect(plan.unfixable).toContain('AUDIO_TARGET_UNSAFE');
    expect(plan.executable).toBe(false);
    // An extremely long recording against a normal budget hits the same floor.
    const day = createAudioProcessingPlan(metadata({ durationMs: 86_400_000 }), rules());
    expect(day.unfixable).toContain('AUDIO_TARGET_UNSAFE');
  });

  it('computes safe targets for decimal MB, MiB and the 64KiB crossover', () => {
    // decimal: floor(0.95 * 100,000,000) wins
    expect(createAudioProcessingPlan(metadata(), rules()).safeTargetBytes).toBe(95_000_000);
    // MiB: floor(0.95 * 104,857,600) = 99,614,720 still wins over max-64KiB
    expect(createAudioProcessingPlan(metadata(), rules({ maxBytes: 104_857_600 })).safeTargetBytes)
      .toBe(99_614_720);
    // crossover: 0.95*max == max-64KiB exactly at 1,310,720
    expect(createAudioProcessingPlan(metadata(), rules({ maxBytes: 1_310_720 })).safeTargetBytes)
      .toBe(1_245_184);
  });

  it('rejects zero, negative, NaN and infinite durations as invalid metadata', () => {
    for (const durationMs of [0, -5, NaN, Infinity, -Infinity]) {
      const plan = createAudioProcessingPlan(metadata({ durationMs }), rules());
      expect(plan.unfixable).toContain('AUDIO_METADATA_INVALID');
      expect(plan.executable).toBe(false);
      expect(plan.passthrough).toBe(false);
    }
    // A very short but finite duration still plans a bounded, finite estimate.
    const short = createAudioProcessingPlan(metadata({ durationMs: 1 }), rules());
    expect(short.unfixable).toEqual([]);
    expect(Number.isFinite(short.estimatedOutputBytes.max)).toBe(true);
  });

  it('declines keep the plan non-executable and stop processing', () => {
    const plan = createAudioProcessingPlan(metadata(), rules());
    const declined = resolveAudioConfirmation(plan, { ...plan.confirmations[0], accepted: false });
    expect(declined.confirmations[0].resolved).toBe(true);
    expect(declined.confirmations[0].accepted).toBe(false);
    expect(declined.executable).toBe(false);
  });

  it('binds confirmation ids to their payload so stale replays are rejected', () => {
    const planA = createAudioProcessingPlan(metadata({ size: 200_000_001 }), rules({ maxBytes: 100_000_000 }));
    const planB = createAudioProcessingPlan(metadata({ size: 400_000_001 }), rules({ maxBytes: 100_000_000 }));
    expect(planA.confirmations[0].id).not.toBe(planB.confirmations[0].id);
    // A confirmation minted for plan A cannot resolve plan B's confirmation.
    expect(() => resolveAudioConfirmation(planB, {
      ...planA.confirmations[0], accepted: true
    })).toThrow(/stale or forged/);
  });

  it('stops over-limit MP3 and M4A sources as codec-unsupported under the frozen encoder', () => {
    const overLimitMp3 = createAudioProcessingPlan(metadata({
      signatureMime: 'audio/mpeg', container: 'mp3', codec: 'mp3', size: 150_000_000
    }), rules());
    expect(overLimitMp3.unfixable).toContain('AUDIO_CODEC_UNSUPPORTED');
    expect(overLimitMp3.confirmations).toEqual([]);
    expect(overLimitMp3.executable).toBe(false);
    expect(overLimitMp3.passthrough).toBe(false);
    const m4a = createAudioProcessingPlan(metadata({
      signatureMime: 'audio/mp4', container: 'mp4', codec: 'aac-lc', size: 50_000_000
    }), rules());
    expect(m4a.unfixable).toContain('AUDIO_CODEC_UNSUPPORTED');
    expect(m4a.confirmations).toEqual([]);
    expect(m4a.executable).toBe(false);
  });

  it('promises the frozen encoder output rate at low bitrates', () => {
    // 44.1kHz stereo forced to the 64kbps rung: the frozen lamejs emits 24kHz.
    const low = createAudioProcessingPlan(metadata({
      sampleRate: 44_100, durationMs: 2_000
    }), rules({ maxBytes: 147_072 }));
    expect(low.targetBitrateKbps).toBe(64);
    expect(low.targetSampleRate).toBe(24_000);
    expect(low.operations).toContain('RESAMPLE_AUDIO');
    // Top rung keeps the source rate.
    const high = createAudioProcessingPlan(metadata({ sampleRate: 44_100 }), rules());
    expect(high.targetBitrateKbps).toBe(320);
    expect(high.targetSampleRate).toBe(44_100);
    expect(high.operations).not.toContain('RESAMPLE_AUDIO');
    // Mono at 48kbps falls to 32kHz.
    const monoFloor = createAudioProcessingPlan(metadata({
      sampleRate: 44_100, channels: 1, durationMs: 100_000
    }), rules({ maxBytes: 800_000 }));
    expect(monoFloor.targetChannels).toBe(1);
    expect(monoFloor.targetBitrateKbps).toBe(48);
    expect(monoFloor.targetSampleRate).toBe(32_000);
  });
});
