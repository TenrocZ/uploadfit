/**
 * S0's accepted codec contract.  S2 runtimes may provide the implementation
 * source through the worker build, but may not silently substitute another
 * encoder or a remote service.
 */
export const AUDIO_ENCODER_DESCRIPTOR = Object.freeze({
  package: 'lamejs',
  version: '1.2.1',
  source: 'upstream/lamejs@1.2.1 (S0 accepted provenance)',
  licenseSpdx: 'LGPL-3.0',
  licenseNotice: 'licenses/lamejs-1.2.1-LICENSE.txt',
  dependencyNotice: 'licenses/use-strict-1.0.1-LICENSE.txt',
  api: 'Mp3Encoder.encodeBuffer(Int16Array[, Int16Array]) + flush()',
  streaming: true,
  workerCompatible: true
});

export function isFrozenAudioEncoderDescriptor(value) {
  return Boolean(value
    && value.package === AUDIO_ENCODER_DESCRIPTOR.package
    && value.version === AUDIO_ENCODER_DESCRIPTOR.version
    && value.api === AUDIO_ENCODER_DESCRIPTOR.api
    && value.streaming === true
    && value.workerCompatible === true);
}

/*
 * Measured CBR behaviour of the frozen lamejs build: at low bitrates the
 * encoder silently picks a lower output sample rate (e.g. 44.1kHz stereo at
 * 64kbps comes back as 24kHz).  The planner must promise the rate the encoder
 * will actually emit, otherwise every low-bitrate plan fails output
 * validation.  Empirically frozen on 2026-08-21 against lamejs@1.2.1 via
 * scripts/build-audio.mjs (48 combinations, all 44.1/48kHz
 * ladder points, stereo and mono).  Unlisted combinations are not forecast;
 * the independent output validator remains the backstop for them.
 */
export const AUDIO_ENCODER_OUTPUT_SAMPLE_RATES = Object.freeze({
  '44100:2:320': 44100, '44100:2:256': 44100, '44100:2:224': 44100,
  '44100:2:192': 44100, '44100:2:160': 44100, '44100:2:128': 44100,
  '44100:2:112': 44100, '44100:2:96': 32000, '44100:2:80': 32000,
  '44100:2:64': 24000, '44100:2:56': 24000, '44100:2:48': 22050,
  '44100:1:320': 44100, '44100:1:256': 44100, '44100:1:224': 44100,
  '44100:1:192': 44100, '44100:1:160': 44100, '44100:1:128': 44100,
  '44100:1:112': 44100, '44100:1:96': 44100, '44100:1:80': 44100,
  '44100:1:64': 44100, '44100:1:56': 32000, '44100:1:48': 32000,
  '48000:2:320': 48000, '48000:2:256': 48000, '48000:2:224': 48000,
  '48000:2:192': 48000, '48000:2:160': 48000, '48000:2:128': 48000,
  '48000:2:112': 44100, '48000:2:96': 32000, '48000:2:80': 32000,
  '48000:2:64': 24000, '48000:2:56': 24000, '48000:2:48': 22050,
  '48000:1:320': 48000, '48000:1:256': 48000, '48000:1:224': 48000,
  '48000:1:192': 48000, '48000:1:160': 48000, '48000:1:128': 48000,
  '48000:1:112': 48000, '48000:1:96': 48000, '48000:1:80': 48000,
  '48000:1:64': 48000, '48000:1:56': 32000, '48000:1:48': 32000
});

/** Forecast the frozen encoder's actual output rate; null when unmeasured. */
export function frozenEncoderOutputSampleRate(sourceSampleRate, channels, bitrateKbps) {
  if (!Number.isFinite(sourceSampleRate) || !Number.isFinite(bitrateKbps)) return null;
  const key = `${sourceSampleRate}:${channels === 1 ? 1 : 2}:${bitrateKbps}`;
  const rate = AUDIO_ENCODER_OUTPUT_SAMPLE_RATES[key];
  return Number.isFinite(rate) ? rate : null;
}
