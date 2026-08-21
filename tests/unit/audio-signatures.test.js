import { describe, expect, it } from 'vitest';
import {
  detectAudioSignature,
  findMp3Frame,
  parseM4aSignature,
  parseMp3Signature,
  parseWavChunks
} from '../../src/audio/signatures.js';

function mp3Frame(bitrateIndex = 9) {
  const header = new Uint8Array([0xff, 0xfb, bitrateIndex << 4 | 0x00, 0x00]);
  const bitrate = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bitrateIndex];
  const frameLength = Math.floor(144 * bitrate * 1000 / 44100);
  const body = new Uint8Array(frameLength);
  body.set(header);
  return body;
}

function concatBytes(...parts) {
  const bytes = new Uint8Array(parts.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function mp3Fixture({ frames = 3, id3 = false, bitrateIndex = 9 } = {}) {
  const frame = mp3Frame(bitrateIndex);
  const body = concatBytes(...Array.from({ length: frames }, () => frame));
  if (!id3) return body;
  const tag = new Uint8Array(10);
  tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  return concatBytes(tag, body);
}

function mp3VbrFixture({ frames = 6, id3 = false } = {}) {
  const indexes = [9, 8, 10, 7, 9, 8].slice(0, frames);
  const first = mp3Frame(indexes[0]);
  first.set([0x58, 0x69, 0x6e, 0x67], 36); // Xing, MPEG-1 stereo side-info offset
  new DataView(first.buffer).setUint32(40, 0x01, false); // frames field present
  new DataView(first.buffer).setUint32(44, frames, false);
  const body = concatBytes(first, ...indexes.slice(1).map((index) => mp3Frame(index)));
  if (!id3) return body;
  const tag = new Uint8Array(10);
  tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  return concatBytes(tag, body);
}

function wavFixture({ channels = 1, sampleRate = 16_000, frames = 1600 } = {}) {
  const dataBytes = frames * channels * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const put = (offset, text) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
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
  return bytes;
}

function m4aFixture({ duration = 2000, sampleRate = 44100, channels = 2 } = {}) {
  const text = (value) => new Uint8Array([...value].map((char) => char.charCodeAt(0)));
  const box = (type, payload) => {
    const bytes = new Uint8Array(8 + payload.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, bytes.length, false);
    bytes.set(text(type), 4);
    bytes.set(payload, 8);
    return bytes;
  };
  const concat = (...parts) => {
    const bytes = new Uint8Array(parts.reduce((sum, item) => sum + item.length, 0));
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return bytes;
  };
  const ftyp = box('ftyp', concat(text('M4A '), new Uint8Array([0, 0, 0, 0]), text('M4A ')));
  const mdhdPayload = new Uint8Array(24);
  const mdhdView = new DataView(mdhdPayload.buffer);
  mdhdView.setUint32(12, 1000, false);
  mdhdView.setUint32(16, duration, false);
  const frequencies = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
    16000, 12000, 11025, 8000, 7350];
  const frequencyIndex = frequencies.indexOf(sampleRate);
  const audioSpecificConfig = new Uint8Array([
    (2 << 3) | (frequencyIndex >> 1),
    ((frequencyIndex & 1) << 7) | (channels << 3)
  ]);
  const esdsPayload = new Uint8Array([
    0, 0, 0, 0, // version/flags
    0x03, 0x10, 0, 0, 0, 0,
    0x04, 0x08, 0, 0, 0, 0,
    0x05, 0x02, audioSpecificConfig[0], audioSpecificConfig[1]
  ]);
  const samplePayload = new Uint8Array(28);
  const sampleView = new DataView(samplePayload.buffer);
  sampleView.setUint16(16, channels, false);
  sampleView.setUint16(18, 16, false);
  sampleView.setUint32(24, sampleRate << 16, false);
  const sampleEntry = box('mp4a', concat(samplePayload, box('esds', esdsPayload)));
  const stsdPayload = new Uint8Array(8 + sampleEntry.length);
  new DataView(stsdPayload.buffer).setUint32(4, 1, false);
  stsdPayload.set(sampleEntry, 8);
  const stbl = box('stbl', box('stsd', stsdPayload));
  const moov = box('moov', box('trak', box('mdia', concat(box('mdhd', mdhdPayload), box('minf', stbl)))));
  return concat(ftyp, moov);
}

describe('audio signature readers', () => {
  it('recognises MPEG frames and skips ID3v2', () => {
    const bytes = mp3Fixture({ id3: true });
    expect(findMp3Frame(bytes, 10)?.sampleRate).toBe(44100);
    expect(parseMp3Signature(bytes, bytes.length)).toMatchObject({
      signatureMime: 'audio/mpeg',
      container: 'mp3',
      codec: 'mp3',
      channels: 2,
      id3Bytes: 10
    });
  });

  it('uses Xing frame count for a bounded VBR duration', () => {
    const bytes = mp3VbrFixture();
    expect(parseMp3Signature(bytes, bytes.length)).toMatchObject({
      codec: 'mp3',
      variableBitrate: true,
      xing: { kind: 'Xing', frames: 6 }
    });
  });

  it('recognises PCM16 WAV and rejects forged chunk lengths', () => {
    const bytes = wavFixture();
    expect(parseWavChunks(bytes, bytes.length)).toMatchObject({
      signatureMime: 'audio/wav',
      codec: 'pcm',
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16
    });
    const forged = bytes.slice();
    new DataView(forged.buffer).setUint32(40, 0xfffffff0, true);
    expect(parseWavChunks(forged, forged.length).errorCode).toBe('AUDIO_DECODE_FAILED');
  });

  it('rejects zero data, inconsistent PCM rates and truncated fmt chunks', () => {
    const zero = wavFixture({ frames: 1 });
    new DataView(zero.buffer).setUint32(40, 0, true);
    expect(parseWavChunks(zero, zero.length).errorCode).toBe('AUDIO_CODEC_UNSUPPORTED');

    const inconsistent = wavFixture({ channels: 2, sampleRate: 48_000, frames: 100 });
    const inconsistentView = new DataView(inconsistent.buffer);
    inconsistentView.setUint16(32, 2, true); // should be channels * bytes/sample = 4
    expect(parseWavChunks(inconsistent, inconsistent.length).errorCode).toBe('AUDIO_CODEC_UNSUPPORTED');

    const truncatedFmt = new Uint8Array(28);
    truncatedFmt.set([0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
      0x66, 0x6d, 0x74, 0x20, 16, 0, 0, 0]);
    expect(parseWavChunks(truncatedFmt, truncatedFmt.length).errorCode)
      .toBe('AUDIO_DECODE_FAILED');
  });

  it('does not classify video/WebM or random bytes as a supported audio codec', () => {
    expect(detectAudioSignature(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toMatchObject({
      errorCode: 'AUDIO_CODEC_UNSUPPORTED'
    });
    expect(detectAudioSignature(new Uint8Array([1, 2, 3, 4]))).toMatchObject({
      errorCode: 'AUDIO_CODEC_UNSUPPORTED'
    });
    expect(parseM4aSignature(new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]), 8).errorCode)
      .toBe('AUDIO_DECODE_FAILED');
  });

  it('recognises an AAC-LC M4A sample description and timescale', () => {
    const bytes = m4aFixture();
    expect(parseM4aSignature(bytes, bytes.length)).toMatchObject({
      signatureMime: 'audio/mp4',
      container: 'mp4',
      codec: 'aac-lc',
      sampleRate: 44100,
      channels: 2,
      durationMs: 2000
    });
    expect(parseM4aSignature(m4aFixture({ duration: 1000, sampleRate: 48000, channels: 1 }), 172))
      .toMatchObject({ codec: 'aac-lc', sampleRate: 48000, channels: 1, durationMs: 1000 });
  });
});

export { m4aFixture, mp3Fixture, mp3VbrFixture, wavFixture };
