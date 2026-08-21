import { describe, expect, it } from 'vitest';
import {
  probeAudioCapabilities,
  S0_AUDIO_INPUT_SUBSET,
  S0_RESOURCE_LIMITS
} from '../../src/audio/capabilities.js';

function fakeRuntime() {
  class Decoder {}
  Decoder.isConfigSupported = async (config) => ({
    supported: config.codec === 'mp3' || config.codec === 'mp4a.40.2',
    config
  });
  class Encoder {}
  Encoder.isConfigSupported = async (config) => ({
    supported: config.codec === 'opus',
    config
  });
  return {
    File: function File() {},
    Blob: function Blob() {},
    ReadableStream: function ReadableStream() {},
    TransformStream: function TransformStream() {},
    Worker: undefined,
    URL: {},
    WebAssembly,
    AudioDecoder: Decoder,
    AudioEncoder: Encoder,
    AudioContext: function AudioContext() {},
    OfflineAudioContext: function OfflineAudioContext() {},
    MessageChannel,
    setTimeout,
    clearTimeout
  };
}

describe('V2-S0 audio capability probe', () => {
  it('records API/config outcomes without claiming an MP3 encoder', async () => {
    const result = await probeAudioCapabilities(fakeRuntime());
    expect(result.schemaVersion).toBe(1);
    expect(result.webCodecs.decoder.mp3.supported).toBe(true);
    expect(result.webCodecs.encoder.mp3.supported).toBe(false);
    expect(result.webCodecs.encoder.opus.supported).toBe(true);
    expect(result.blobWorker.api).toBe(false);
    expect(result.resourceLimits).toMatchObject(S0_RESOURCE_LIMITS);
    expect(result.inputSubset).toMatchObject({
      mp3: { required: true, codec: 'mp3' },
      m4a: { required: true, codec: 'aac-lc' }
    });
  });

  it('stops before probing when AbortSignal is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(probeAudioCapabilities(fakeRuntime(), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
