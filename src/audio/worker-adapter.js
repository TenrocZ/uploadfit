/*
 * Production audio Worker adapter, bundled by scripts/build-audio.mjs.
 * Protocol: self.__uploadfitAudioEncode(file, plan, limits, signal, emitProgress).
 * The planner chooses bitrate/channels; the pipeline validates the output.
 */
import { createMp3EncoderSession, encodeWavToMp3 } from './encoder.js';
import { decodeCompressedAudio } from './compressed-decoder.js';

const OUTPUT_OVERAGE_BUDGET = 16 * 1024 * 1024;

async function transcodeCompressed(file, plan, limits, signal, emitProgress) {
  if (!((plan?.sourceContainer === 'mp3' && plan?.sourceCodec === 'mp3')
    || (plan?.sourceContainer === 'mp4' && plan?.sourceCodec === 'aac-lc'))) {
    const error = new Error('AUDIO_CODEC_UNSUPPORTED');
    error.code = 'AUDIO_CODEC_UNSUPPORTED';
    throw error;
  }
  let encoder = null;
  const maxBytes = Number.isFinite(plan?.targetMaxBytes) ? plan.targetMaxBytes : 0;
  const maxOutputBytes = Math.min(
    100_000_000,
    Math.max(maxBytes + OUTPUT_OVERAGE_BUDGET, Math.ceil((plan?.safeTargetBytes ?? 0) * 1.25))
  );
  const decoded = await decodeCompressedAudio(
    file,
    plan,
    limits,
    signal,
    emitProgress,
    {
      onConfig({ sampleRate }) {
        if (encoder) {
          const error = new Error('AUDIO_DECODE_FAILED');
          error.code = 'AUDIO_DECODE_FAILED';
          throw error;
        }
        encoder = createMp3EncoderSession({
          channels: plan?.targetChannels === 2 ? 2 : 1,
          sampleRate,
          bitrateKbps: plan?.targetBitrateKbps,
          maxOutputBytes,
          signal
        });
      },
      onPcm(left, right) {
        encoder?.encode(left, right);
      }
    }
  );
  if (!encoder) {
    const error = new Error('AUDIO_DECODE_FAILED');
    error.code = 'AUDIO_DECODE_FAILED';
    throw error;
  }
  const encoded = await encoder.finish();
  emitProgress({ phase: 'encode', ratio: 0.98 });
  return {
    blob: encoded.blob,
    stats: {
      ...decoded,
      inputBytesRead: decoded.inputBytesRead,
      peakBufferedBytes: decoded.peakBufferedBytes + encoded.bufferedOutputBytes,
      peakPcmBytes: decoded.peakPcmBytes,
      encodePasses: 1,
      workerUsed: true,
      phases: ['demux', 'decode', 'encode']
    }
  };
}

self.__uploadfitAudioEncode = async (file, plan, limits, signal, emitProgress) => {
  if (plan?.sourceContainer === 'mp3' || plan?.sourceContainer === 'mp4') {
    return transcodeCompressed(file, plan, limits, signal, emitProgress);
  }
  const result = await encodeWavToMp3(file, {
    // The planner's max is mapped for encoder accounting, but the adapter
    // never rejects on it. The pipeline owns the two-pass decision after
    // independent output inspection.
    maxBytes: Number.isFinite(plan?.targetMaxBytes) ? plan.targetMaxBytes : Infinity,
    enforceMaxBytes: false,
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
