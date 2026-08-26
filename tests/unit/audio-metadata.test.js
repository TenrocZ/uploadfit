import { describe, expect, it } from 'vitest';
import { inspectAudio, audioMetadataSnapshot } from '../../src/audio/metadata.js';
import { m4aFixture, mp3Fixture, mp3VbrFixture, wavFixture } from './audio-signatures.test.js';

function fileFromBytes(bytes, type, name) {
  const blob = new Blob([bytes], { type });
  Object.defineProperty(blob, 'name', { value: name, configurable: true });
  return blob;
}

describe('bounded audio metadata inspection', () => {
  it('returns MP3 metadata without trusting an incorrect type/name', async () => {
    const file = fileFromBytes(mp3Fixture({ frames: 20, id3: true }), 'audio/wav', 'voice.wav');
    const metadata = await inspectAudio(file);
    expect(metadata).toMatchObject({
      mediaKind: 'audio',
      signatureMime: 'audio/mpeg',
      container: 'mp3',
      codec: 'mp3',
      durationMs: expect.any(Number),
      sampleRate: 44100,
      channels: 2,
      errorCode: null
    });
    expect(metadata.durationMs).toBeGreaterThan(0);
    expect(metadata.inspectedBytes).toBe(file.size);
    expect(metadata.warnings.map((item) => item.code)).toEqual(expect.arrayContaining([
      'AUDIO_MIME_SIGNATURE_MISMATCH',
      'AUDIO_EXTENSION_SIGNATURE_MISMATCH'
    ]));
    const snapshot = audioMetadataSnapshot(metadata, 1.4);
    expect(snapshot).toEqual(expect.objectContaining({
      mediaKind: 'audio',
      mime: 'audio/mpeg',
      progress: 1
    }));
    expect(snapshot).not.toHaveProperty('name');
  });

  it('reads a real large WAV data chunk from its header within the one MiB budget', async () => {
    const file = fileFromBytes(
      wavFixture({ channels: 2, sampleRate: 48000, frames: 600_000 }),
      'audio/wav',
      'record.wav'
    );
    expect(file.size).toBeGreaterThan(1024 * 1024);
    const metadata = await inspectAudio(file);
    expect(metadata).toMatchObject({
      signatureMime: 'audio/wav',
      container: 'wav',
      codec: 'pcm',
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16,
      errorCode: null
    });
    expect(metadata.durationMs).toBeCloseTo(12_500, 3);
    expect(metadata.inspectedBytes).toBeLessThanOrEqual(1024 * 1024);
  });

  it('uses Xing metadata for a VBR MP3 instead of first-frame CBR math', async () => {
    const file = fileFromBytes(mp3VbrFixture(), 'audio/mpeg', 'vbr.mp3');
    const metadata = await inspectAudio(file);
    expect(metadata).toMatchObject({
      codec: 'mp3', variableBitrate: true, durationMs: expect.closeTo(156.73, 1)
    });
  });

  it('does not subtract an ID3v1 block from a large CBR MP3 unless TAG is present', async () => {
    const audio = mp3Fixture({ frames: 3000 });
    const withoutTag = fileFromBytes(audio, 'audio/mpeg', 'large-no-tag.mp3');
    const tag = new Uint8Array(128);
    tag.set([0x54, 0x41, 0x47]);
    const withTag = fileFromBytes(new Blob([audio, tag]), 'audio/mpeg', 'large-with-tag.mp3');

    const plain = await inspectAudio(withoutTag);
    const tagged = await inspectAudio(withTag);
    const expectedMs = (audio.byteLength * 8 / 128_000) * 1000;

    expect(withoutTag.size).toBeGreaterThan(1024 * 1024);
    expect(plain.durationMs).toBeCloseTo(expectedMs, 8);
    expect(tagged.durationMs).toBeCloseTo(expectedMs, 8);
    expect(tagged.averageBitrate).toBe(128_000);
  });

  it('honours AbortSignal before a second bounded read', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(inspectAudio(fileFromBytes(mp3Fixture(), 'audio/mpeg', 'voice.mp3'), {
      signal: controller.signal
    })).rejects.toMatchObject({ code: 'AUDIO_PROCESSING_CANCELLED' });
  });

  it('inspects the AAC-LC M4A subset through ISO-BMFF metadata', async () => {
    const metadata = await inspectAudio(fileFromBytes(m4aFixture(), 'audio/mp4', 'voice.m4a'));
    expect(metadata).toMatchObject({
      signatureMime: 'audio/mp4',
      container: 'mp4',
      codec: 'aac-lc',
      sampleRate: 44100,
      channels: 2,
      durationMs: 2000,
      errorCode: null
    });
    const alternate = await inspectAudio(fileFromBytes(
      m4aFixture({ duration: 1000, sampleRate: 48000, channels: 1 }),
      'audio/mp4',
      'short.m4a'
    ));
    expect(alternate).toMatchObject({ codec: 'aac-lc', sampleRate: 48000, channels: 1, durationMs: 1000 });
  });
});
