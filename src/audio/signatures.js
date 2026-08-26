/*
 * Small, dependency-free signature readers for the S0-frozen audio subset.
 * These functions only inspect caller-provided bounded byte ranges.  They do
 * not trust a filename or File.type and never perform network I/O.
 */

export const AUDIO_SIGNATURE_MIMES = Object.freeze([
  'audio/mpeg',
  'audio/mp4',
  'audio/wav'
]);

export const AUDIO_CONTAINERS = Object.freeze(['mp3', 'mp4', 'wav']);

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

export function readUint16LE(bytes, offset) {
  const value = asBytes(bytes);
  if (!value || offset < 0 || offset + 2 > value.length) return null;
  return value[offset] | (value[offset + 1] << 8);
}

export function readUint32LE(bytes, offset) {
  const value = asBytes(bytes);
  if (!value || offset < 0 || offset + 4 > value.length) return null;
  return (value[offset]
    | (value[offset + 1] << 8)
    | (value[offset + 2] << 16)
    | (value[offset + 3] * 0x1000000)) >>> 0;
}

export function readUint16BE(bytes, offset) {
  const value = asBytes(bytes);
  if (!value || offset < 0 || offset + 2 > value.length) return null;
  return (value[offset] << 8) | value[offset + 1];
}

export function readUint24BE(bytes, offset) {
  const value = asBytes(bytes);
  if (!value || offset < 0 || offset + 3 > value.length) return null;
  return (value[offset] << 16) | (value[offset + 1] << 8) | value[offset + 2];
}

export function readUint32BE(bytes, offset) {
  const value = asBytes(bytes);
  if (!value || offset < 0 || offset + 4 > value.length) return null;
  return ((value[offset] * 0x1000000)
    + (value[offset + 1] << 16)
    + (value[offset + 2] << 8)
    + value[offset + 3]) >>> 0;
}

function readUint64BE(bytes, offset) {
  const high = readUint32BE(bytes, offset);
  const low = readUint32BE(bytes, offset + 4);
  if (high === null || low === null) return null;
  const result = high * 0x100000000 + low;
  return Number.isSafeInteger(result) ? result : null;
}

function ascii(bytes, offset, length) {
  const value = asBytes(bytes);
  if (!value || offset < 0 || length < 0 || offset + length > value.length) return '';
  let result = '';
  for (let index = offset; index < offset + length; index += 1) {
    result += String.fromCharCode(value[index]);
  }
  return result;
}

function sameAscii(bytes, offset, value) {
  return ascii(bytes, offset, value.length) === value;
}

function syncSafe(bytes, offset) {
  const value = asBytes(bytes);
  if (!value || offset < 0 || offset + 4 > value.length) return null;
  if ([0, 1, 2, 3].some((index) => (value[offset + index] & 0x80) !== 0)) return null;
  return (value[offset] << 21)
    | (value[offset + 1] << 14)
    | (value[offset + 2] << 7)
    | value[offset + 3];
}

const MP3_SAMPLE_RATES = Object.freeze({
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000]
});

const MP3_BITRATES = Object.freeze({
  // Values are kbps, indexed by MPEG version group and layer.
  '3:1': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  '3:2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
  '3:3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  '2:1': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  '2:2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  '2:3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
});

function mp3Header(bytes, offset) {
  const value = asBytes(bytes);
  if (!value || offset < 0 || offset + 4 > value.length
    || value[offset] !== 0xff || (value[offset + 1] & 0xe0) !== 0xe0) return null;
  const versionBits = (value[offset + 1] >>> 3) & 0x03;
  const layerBits = (value[offset + 1] >>> 1) & 0x03;
  const bitrateIndex = (value[offset + 2] >>> 4) & 0x0f;
  const sampleRateIndex = (value[offset + 2] >>> 2) & 0x03;
  const padding = (value[offset + 2] >>> 1) & 0x01;
  const channelMode = value[offset + 3] >>> 6;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15
    || sampleRateIndex === 3) return null;
  const sampleRates = MP3_SAMPLE_RATES[versionBits];
  const sampleRate = sampleRates?.[sampleRateIndex] ?? null;
  const layer = 4 - layerBits;
  const versionGroup = versionBits === 3 ? 3 : 2;
  const bitrate = MP3_BITRATES[`${versionGroup}:${layer}`]?.[bitrateIndex] ?? 0;
  if (!sampleRate || !bitrate) return null;
  const samplesPerFrame = layer === 1
    ? 384
    : versionBits === 3
      ? 1152
      : 576;
  const frameLength = layer === 1
    ? Math.floor((12 * bitrate * 1000 / sampleRate) + padding) * 4
    : Math.floor((versionBits === 3 ? 144 : 72) * bitrate * 1000 / sampleRate) + padding;
  if (!Number.isFinite(frameLength) || frameLength < 4) return null;
  return {
    versionBits,
    layer,
    bitrateKbps: bitrate,
    sampleRate,
    channels: channelMode === 3 ? 1 : 2,
    channelMode,
    samplesPerFrame,
    frameLength,
    protectionAbsent: Boolean(value[offset + 1] & 0x01)
  };
}

export function findMp3Frame(bytes, start = 0, end = asBytes(bytes)?.length ?? 0) {
  const value = asBytes(bytes);
  if (!value) return null;
  const limit = Math.max(start, Math.min(end, value.length - 4));
  for (let offset = Math.max(0, start); offset <= limit; offset += 1) {
    const header = mp3Header(value, offset);
    if (!header) continue;
    if (offset + header.frameLength > value.length) continue;
    // A second frame sync makes accidental ID3/text bytes much less likely to
    // be accepted as an audio signature.
    if (offset + header.frameLength + 4 <= value.length
      && !mp3Header(value, offset + header.frameLength)) continue;
    return { offset, ...header };
  }
  return null;
}

function mp3AudioStart(bytes) {
  const value = asBytes(bytes);
  if (!value) return { offset: 0, id3Bytes: 0, malformed: true };
  if (!sameAscii(value, 0, 'ID3')) return { offset: 0, id3Bytes: 0, malformed: false };
  const tagSize = syncSafe(value, 6);
  if (tagSize === null || value.length < 10) return { offset: 0, id3Bytes: 0, malformed: true };
  const footer = (value[5] & 0x10) !== 0 ? 10 : 0;
  const id3Bytes = 10 + tagSize + footer;
  return { offset: id3Bytes, id3Bytes, malformed: false };
}

function findAscii(bytes, value, start = 0, end = asBytes(bytes)?.length ?? 0) {
  const source = asBytes(bytes);
  if (!source) return -1;
  for (let offset = Math.max(0, start); offset + value.length <= Math.min(end, source.length); offset += 1) {
    if (sameAscii(source, offset, value)) return offset;
  }
  return -1;
}

function parseXing(bytes, frame) {
  const value = asBytes(bytes);
  if (!value || !frame) return null;
  const sideInfo = frame.versionBits === 3
    ? (frame.channels === 1 ? 17 : 32)
    : (frame.channels === 1 ? 9 : 17);
  const crcBytes = frame.protectionAbsent ? 0 : 2;
  const offset = frame.offset + 4 + crcBytes + sideInfo;
  const marker = ascii(value, offset, 4);
  if (marker !== 'Xing' && marker !== 'Info') return null;
  const flags = readUint32BE(value, offset + 4);
  if (flags === null || (flags & 0x01) === 0) return null;
  const frames = readUint32BE(value, offset + 8);
  if (!frames) return null;
  return { kind: marker, frames };
}

function parseVbri(bytes, frame) {
  const value = asBytes(bytes);
  if (!value || !frame) return null;
  const offset = frame.offset + 4 + 32;
  if (ascii(value, offset, 4) !== 'VBRI') return null;
  const frames = readUint32BE(value, offset + 14);
  return frames ? { kind: 'VBRI', frames } : null;
}

export function parseMp3Signature(bytes, fileSize = asBytes(bytes)?.length ?? 0) {
  const value = asBytes(bytes);
  if (!value || value.length < 4) return { errorCode: 'AUDIO_CODEC_UNSUPPORTED' };
  const startInfo = mp3AudioStart(value);
  if (startInfo.malformed || startInfo.id3Bytes > fileSize) {
    return { errorCode: 'AUDIO_DECODE_FAILED' };
  }
  const frame = findMp3Frame(value, Math.min(startInfo.offset, value.length - 4));
  if (!frame) return { errorCode: 'AUDIO_CODEC_UNSUPPORTED' };
  const xing = parseXing(value, frame);
  const vbri = parseVbri(value, frame);
  return {
    signatureMime: 'audio/mpeg',
    container: 'mp3',
    codec: 'mp3',
    sampleRate: frame.sampleRate,
    channels: frame.channels,
    bitDepth: null,
    averageBitrate: null,
    variableBitrate: Boolean(xing || vbri),
    audioOffset: frame.offset,
    firstFrame: frame,
    xing,
    vbri,
    id3Bytes: startInfo.id3Bytes
  };
}

function parseWavChunks(bytes, fileSize) {
  const value = asBytes(bytes);
  if (!value || (value.length >= 4 && sameAscii(value, 0, 'RIFF') && value.length < 12)) {
    return { errorCode: 'AUDIO_DECODE_FAILED' };
  }
  if (value.length < 12 || !sameAscii(value, 0, 'RIFF') || !sameAscii(value, 8, 'WAVE')) {
    return { errorCode: 'AUDIO_CODEC_UNSUPPORTED' };
  }
  const riffSize = readUint32LE(value, 4);
  if (riffSize === null || riffSize < 4 || riffSize + 8 > fileSize) {
    return { errorCode: 'AUDIO_DECODE_FAILED' };
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= value.length) {
    const id = ascii(value, offset, 4);
    const chunkSize = readUint32LE(value, offset + 4);
    if (chunkSize === null) return { errorCode: 'AUDIO_DECODE_FAILED' };
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    if (!Number.isSafeInteger(dataStart) || !Number.isSafeInteger(dataEnd)
      || dataEnd < dataStart || dataEnd > fileSize) {
      return { errorCode: 'AUDIO_DECODE_FAILED' };
    }
    // A bounded head slice intentionally contains only the data header for a
    // long recording.  The declared PCM payload is metadata; do not require
    // the entire `data` chunk to be resident before calculating duration.
    if (id === 'data') {
      data = { offset: dataStart, size: chunkSize };
      if (fmt) break;
      if (dataEnd > value.length) break;
    } else if (dataEnd > value.length) {
      // We cannot safely skip an unknown oversized chunk in a bounded slice.
      // Returning a stable metadata failure is safer than guessing its next
      // header or allocating more than the read budget.
      return { errorCode: 'AUDIO_METADATA_INVALID' };
    }
    if (id === 'fmt ') {
      if (chunkSize < 16) return { errorCode: 'AUDIO_DECODE_FAILED' };
      fmt = {
        format: readUint16LE(value, dataStart),
        channels: readUint16LE(value, dataStart + 2),
        sampleRate: readUint32LE(value, dataStart + 4),
        byteRate: readUint32LE(value, dataStart + 8),
        blockAlign: readUint16LE(value, dataStart + 12),
        bitDepth: readUint16LE(value, dataStart + 14)
      };
    }
    offset = dataEnd + (chunkSize & 1);
    if (fmt && data) break;
  }
  if (!fmt || !data) return { errorCode: 'AUDIO_METADATA_INVALID' };
  if (fmt.format !== 1 || ![1, 2].includes(fmt.channels)
    || !Number.isFinite(fmt.sampleRate) || fmt.sampleRate <= 0
    || !Number.isFinite(fmt.bitDepth) || ![16, 24, 32].includes(fmt.bitDepth)
    || fmt.blockAlign !== fmt.channels * (fmt.bitDepth / 8)
    || fmt.byteRate !== fmt.sampleRate * fmt.blockAlign
    || data.size <= 0) {
    return { errorCode: 'AUDIO_CODEC_UNSUPPORTED' };
  }
  const durationMs = (data.size / fmt.byteRate) * 1000;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return { errorCode: 'AUDIO_METADATA_INVALID' };
  return {
    signatureMime: 'audio/wav',
    container: 'wav',
    codec: 'pcm',
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitDepth: fmt.bitDepth,
    averageBitrate: fmt.byteRate * 8,
    variableBitrate: false,
    durationMs,
    audioOffset: data.offset,
    audioBytes: data.size,
    seekable: true
  };
}

function boxHeader(bytes, offset, end) {
  const value = asBytes(bytes);
  if (!value || offset + 8 > end || offset + 8 > value.length) return null;
  const size32 = readUint32BE(value, offset);
  const type = ascii(value, offset + 4, 4);
  if (size32 === null || !type) return null;
  let headerSize = 8;
  let size = size32;
  if (size32 === 1) {
    size = readUint64BE(value, offset + 8);
    headerSize = 16;
  } else if (size32 === 0) {
    size = end - offset;
  }
  if (!Number.isSafeInteger(size) || size < headerSize || offset + size > end || offset + size > value.length) {
    return null;
  }
  return { offset, type, size, headerSize, dataStart: offset + headerSize, end: offset + size };
}

function walkBoxes(bytes, start, end, callback, depth = 0) {
  if (depth > 8) return false;
  let offset = start;
  while (offset + 8 <= end) {
    const box = boxHeader(bytes, offset, end);
    if (!box) return false;
    callback(box, bytes);
    if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta'].includes(box.type)) {
      if (!walkBoxes(bytes, box.dataStart, box.end, callback, depth + 1)) return false;
    }
    offset = box.end;
  }
  return offset === end || offset + 1 === end;
}

function parseAudioSpecificConfig(bytes, start, end) {
  const value = asBytes(bytes);
  if (!value || start + 2 > end) return null;
  const objectType = (value[start] >>> 3) & 0x1f;
  let frequencyIndex = ((value[start] & 0x07) << 1) | (value[start + 1] >>> 7);
  let offset = start + 1;
  if (objectType === 31) {
    if (start + 3 > end) return null;
    const extended = ((value[start + 1] & 0x7f) << 3) | (value[start + 2] >>> 5);
    frequencyIndex = ((value[start + 2] & 0x1f) << 1) | (value[start + 3] >>> 7);
    offset += 2;
    if (extended < 32) return null;
  }
  const frequencies = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
    16000, 12000, 11025, 8000, 7350];
  const sampleRate = frequencyIndex === 15
    ? (start + 5 <= end ? readUint24BE(value, start + 2) : null)
    : frequencies[frequencyIndex] ?? null;
  const channelConfig = (value[offset] >>> 3) & 0x0f;
  const channels = channelConfig === 1 ? 1 : channelConfig === 2 ? 2 : null;
  return { objectType, sampleRate, channels };
}

function parseDescriptorLength(bytes, offset, end) {
  const value = asBytes(bytes);
  let length = 0;
  let count = 0;
  while (offset < end && count < 4) {
    const byte = value[offset++];
    length = (length << 7) | (byte & 0x7f);
    count += 1;
    if (!(byte & 0x80)) return { length, next: offset };
  }
  return null;
}

function parseEsds(bytes, start, end) {
  const value = asBytes(bytes);
  // esds contains nested MPEG-4 descriptors (ES -> DecoderConfig ->
  // DecoderSpecificInfo).  A bounded tag scan is sufficient here and avoids
  // allocating or retaining the descriptor tree.
  for (let offset = start + 4; offset + 2 <= end; offset += 1) {
    if (value[offset] !== 0x05) continue;
    const descriptor = parseDescriptorLength(value, offset + 1, end);
    if (!descriptor || descriptor.next + descriptor.length > end) continue;
    const asc = parseAudioSpecificConfig(value, descriptor.next, descriptor.next + descriptor.length);
    if (asc) return asc;
  }
  return null;
}

function parseM4aBuffer(bytes, state, requireFtyp = true, allowPartialTopLevel = false) {
  const value = asBytes(bytes);
  if (!value || value.length < 8) return false;
  let hasFtyp = false;
  const visit = (box) => {
    if (box.type === 'ftyp') {
      hasFtyp = ['M4A ', 'M4B ', 'isom', 'iso2', 'mp41', 'mp42', 'qt  '].includes(ascii(value, box.dataStart, 4));
    }
    if (box.type === 'mdhd') {
      const version = value[box.dataStart];
      const base = box.dataStart + 4;
      const timescaleOffset = version === 1 ? base + 16 : base + 8;
      const durationOffset = version === 1 ? base + 20 : base + 12;
      const timescale = readUint32BE(value, timescaleOffset);
      const duration = version === 1 ? readUint64BE(value, durationOffset) : readUint32BE(value, durationOffset);
      if (timescale && duration !== null && duration > 0) state.mdhd.push({ timescale, duration });
    }
    if (box.type === 'mdat') state.mdatBytes += Math.max(0, box.size - box.headerSize);
    if (box.type === 'stsd' && box.dataStart + 8 <= box.end) {
      const entryCount = readUint32BE(value, box.dataStart + 4);
      if (!entryCount || entryCount > 16) return;
      let entryOffset = box.dataStart + 8;
      for (let index = 0; index < entryCount && entryOffset + 8 <= box.end; index += 1) {
        const entry = boxHeader(value, entryOffset, box.end);
        if (!entry) return;
        if (entry.type === 'mp4a' || entry.type === 'enca') {
          const channels = readUint16BE(value, entry.dataStart + 16);
          const bitDepth = readUint16BE(value, entry.dataStart + 18);
          const sampleRateFixed = readUint32BE(value, entry.dataStart + 24);
          const sampleRate = sampleRateFixed ? sampleRateFixed / 65536 : null;
          let esds = null;
          walkBoxes(value, entry.dataStart + 28, entry.end, (child) => {
            if (child.type === 'esds') esds = parseEsds(value, child.dataStart, child.end);
          }, 1);
          state.sampleEntry = { type: entry.type, channels, bitDepth, sampleRate, esds };
        }
        entryOffset = entry.end;
      }
    }
  };
  let found = walkBoxes(value, 0, value.length, visit);
  if (!requireFtyp && !state.sampleEntry) {
    // A tail slice can begin in the middle of mdat.  Locate a complete moov
    // header inside the bounded slice and parse only that box.  Do this based
    // on the required sample entry rather than walkBoxes' boolean: arbitrary
    // payload bytes (notably zero-filled free boxes) can resemble a size-zero
    // unknown box and make a top-level walk appear complete.
    const marker = findAscii(value, 'moov');
    if (marker >= 4) {
      const candidate = boxHeader(value, marker - 4, value.length);
      if (candidate?.type === 'moov') found = walkBoxes(value, candidate.offset, candidate.end, visit);
    }
  }
  // A bounded head slice may contain a complete ftyp followed by only the
  // header of a very large free/mdat box.  The tail slice can still carry the
  // complete moov; do not discard the already-verified ftyp solely because
  // the next top-level box extends beyond this bounded window.
  return (found || (allowPartialTopLevel && hasFtyp)) && (!requireFtyp || hasFtyp);
}

export function parseM4aSignature(buffers, fileSize = asBytes(buffers)?.length ?? 0) {
  const value = asBytes(buffers);
  const head = value ?? asBytes(buffers?.head);
  const tail = value ? null : asBytes(buffers?.tail);
  const state = { mdhd: [], mdatBytes: 0, sampleEntry: null };
  // Only tolerate an incomplete top-level box when `head` is genuinely a
  // bounded prefix of a larger file.  A complete in-memory file whose final
  // box extends past EOF is corrupt and must not inherit the same tolerance.
  const headIsBoundedPrefix = !value && head && Number.isFinite(fileSize) && head.length < fileSize;
  const headHasFtyp = head ? parseM4aBuffer(head, state, true, headIsBoundedPrefix) : false;
  if (tail) parseM4aBuffer(tail, state, false);
  if (!headHasFtyp && !tail) {
    if (head && head.length >= 5 && sameAscii(head, 4, 'ftyp')) return { errorCode: 'AUDIO_DECODE_FAILED' };
    return { errorCode: 'AUDIO_CODEC_UNSUPPORTED' };
  }
  const entry = state.sampleEntry;
  const asc = entry?.esds;
  const sampleRate = asc?.sampleRate ?? entry?.sampleRate ?? null;
  const channels = asc?.channels ?? entry?.channels ?? null;
  if (!entry || !['mp4a', 'enca'].includes(entry.type) || !asc || asc.objectType !== 2
    || !Number.isFinite(sampleRate) || sampleRate <= 0 || ![1, 2].includes(channels)) {
    return { errorCode: 'AUDIO_CODEC_UNSUPPORTED' };
  }
  const durationSource = state.mdhd.find((item) => item.timescale > 0 && item.duration > 0);
  const durationMs = durationSource ? (durationSource.duration / durationSource.timescale) * 1000 : null;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return { errorCode: 'AUDIO_METADATA_INVALID' };
  return {
    signatureMime: 'audio/mp4',
    container: 'mp4',
    codec: 'aac-lc',
    sampleRate,
    channels,
    bitDepth: entry.bitDepth ?? null,
    averageBitrate: state.mdatBytes > 0 ? Math.round((state.mdatBytes * 8 * 1000) / durationMs) : null,
    variableBitrate: null,
    durationMs,
    seekable: true
  };
}

export function detectAudioSignature(bytes, fileSize = asBytes(bytes)?.length ?? 0) {
  const value = asBytes(bytes);
  if (!value || value.length < 4) return { signatureMime: null, errorCode: 'AUDIO_CODEC_UNSUPPORTED' };
  if (sameAscii(value, 0, 'RIFF')) return parseWavChunks(value, fileSize);
  if (sameAscii(value, 0, 'ID3') || findMp3Frame(value, 0)) return parseMp3Signature(value, fileSize);
  if (sameAscii(value, 4, 'ftyp')) return parseM4aSignature(value, fileSize);
  return { signatureMime: null, errorCode: 'AUDIO_CODEC_UNSUPPORTED' };
}

export { mp3Header as parseMp3Header, parseWavChunks };
