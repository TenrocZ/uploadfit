/*
 * S2 frozen-encoder Worker adapter.  This module is never imported by the
 * production bundle; scripts/audio-probe/build-s2-adapter.mjs bundles it (with
 * the S0-frozen lamejs inlined) into a self-contained classic-script string
 * that the S2 worker runtime injects as its implementation source.
 *
 * Protocol contract (see src/audio/worker-runtime.js):
 *   self.__uploadfitAudioEncode(file, plan, limits, signal, emitProgress)
 *     -> { blob, stats }
 *
 * The planner is the authority for bitrate/channels; this adapter only maps
 * plan fields onto the frozen encoder.  It deliberately does NOT enforce
 * maxBytes on the output: the two-pass decision belongs to the pipeline after
 * its independent output validation.
 */
import { encodeWavToMp3 } from './encoder.js';

self.__uploadfitAudioEncode = async (file, plan, limits, signal, emitProgress) => {
  const result = await encodeWavToMp3(file, {
    // Infinite: the pipeline re-inspects and decides passes itself.
    maxBytes: Infinity,
    bitrateKbps: Number.isFinite(plan?.targetBitrateKbps) ? plan.targetBitrateKbps : undefined,
    targetChannels: plan?.targetChannels === 2 ? 2 : 1,
    inputChunkBytes: Number.isFinite(limits?.inputChunkBytes) ? limits.inputChunkBytes : undefined,
    signal,
    onProgress: (progress) => emitProgress({ phase: 'encode', ratio: progress.ratio })
  });
  return {
    blob: result.blob,
    stats: {
      inputBytesRead: result.inputBytesRead,
      peakBufferedBytes: result.peakBufferedBytes,
      peakPcmBytes: result.peakPcmBytes,
      encodePasses: 1,
      workerUsed: true
    }
  };
};
