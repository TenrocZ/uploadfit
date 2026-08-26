import { AUDIO_INPUT_CHUNK_BYTES, AUDIO_PCM_BUFFER_BUDGET } from '../config.js';
import { parseMp3Header, parseMp3Signature } from './signatures.js';

const SUPPORTED_SAMPLE_RATES = new Set([32_000, 44_100, 48_000]);
const MP3_RESIDUAL_LIMIT = 4096;
const MP3_HEAD_LIMIT = 1024 * 1024;
const M4A_MOOV_LIMIT = 8 * 1024 * 1024;
const M4A_TABLE_BUDGET = 16 * 1024 * 1024;
const M4A_ENTRY_LIMIT = 1_000_000;
const M4A_SAMPLE_BYTES_LIMIT = 1024 * 1024;
const MAX_DECODE_QUEUE_SIZE = 8;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  fail('AUDIO_PROCESSING_CANCELLED');
}

function safeAdd(left, right, code = 'AUDIO_DECODE_FAILED') {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < left) fail(code);
  return value;
}

function safeMultiply(left, right, code = 'AUDIO_MEMORY_BUDGET_EXCEEDED') {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function concat(first, second) {
  const result = new Uint8Array(first.length + second.length);
  result.set(first, 0);
  result.set(second, first.length);
  return result;
}

function readUint16BE(bytes, offset) {
  const value = asBytes(bytes);
  if (!value || offset < 0 || offset + 2 > value.length) return null;
  return (value[offset] << 8) | value[offset + 1];
}

function readUint24BE(bytes, offset) {
  const value = asBytes(bytes);
  if (!value || offset < 0 || offset + 3 > value.length) return null;
  return (value[offset] << 16) | (value[offset + 1] << 8) | value[offset + 2];
}

function readUint32BE(bytes, offset) {
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
  const value = high * 0x100000000 + low;
  return Number.isSafeInteger(value) ? value : null;
}

function ascii(bytes, offset, length) {
  const value = asBytes(bytes);
  if (!value || offset < 0 || offset + length > value.length) return '';
  let result = '';
  for (let index = offset; index < offset + length; index += 1) {
    result += String.fromCharCode(value[index]);
  }
  return result;
}

function boundedChunkBytes(limits) {
  const requested = Number.isFinite(limits?.inputChunkBytes)
    ? Math.floor(limits.inputChunkBytes)
    : AUDIO_INPUT_CHUNK_BYTES;
  return Math.max(256, Math.min(AUDIO_INPUT_CHUNK_BYTES, requested));
}

async function readRange(file, start, end, state, signal) {
  throwIfAborted(signal);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end < start || end > file.size) fail('AUDIO_DECODE_FAILED');
  const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
  throwIfAborted(signal);
  if (bytes.length !== end - start) fail('AUDIO_DECODE_FAILED');
  state.inputBytesRead += bytes.length;
  state.maxInputSliceBytes = Math.max(state.maxInputSliceBytes, bytes.length);
  return bytes;
}

async function readRangeChunked(file, start, end, state, signal, chunkBytes) {
  const total = end - start;
  if (total < 0 || total > M4A_MOOV_LIMIT) fail('AUDIO_MEMORY_BUDGET_EXCEEDED');
  const result = new Uint8Array(total);
  let cursor = start;
  while (cursor < end) {
    const next = Math.min(end, cursor + chunkBytes);
    result.set(await readRange(file, cursor, next, state, signal), cursor - start);
    cursor = next;
  }
  return result;
}

function boxHeader(bytes, offset, end = bytes.length) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 8 > end || offset + 8 > bytes.length) return null;
  const size32 = readUint32BE(bytes, offset);
  const type = ascii(bytes, offset + 4, 4);
  if (size32 === null || !type) return null;
  let size = size32;
  let headerSize = 8;
  if (size32 === 1) {
    size = readUint64BE(bytes, offset + 8);
    headerSize = 16;
  } else if (size32 === 0) size = end - offset;
  if (!Number.isSafeInteger(size) || size < headerSize) return null;
  const boxEnd = safeAdd(offset, size);
  if (boxEnd > end || boxEnd > bytes.length) return null;
  return { offset, type, size, headerSize, dataStart: offset + headerSize, end: boxEnd };
}

function boxChildren(bytes, parent, start = parent.dataStart) {
  const result = [];
  let offset = start;
  while (offset + 8 <= parent.end) {
    const box = boxHeader(bytes, offset, parent.end);
    if (!box) fail('AUDIO_DECODE_FAILED');
    result.push(box);
    offset = box.end;
  }
  if (offset !== parent.end) fail('AUDIO_DECODE_FAILED');
  return result;
}

function childBox(bytes, parent, type, start) {
  return boxChildren(bytes, parent, start).find((item) => item.type === type) ?? null;
}

function parseDescriptorLength(bytes, offset, end) {
  let length = 0;
  let count = 0;
  while (offset < end && count < 4) {
    const byte = bytes[offset++];
    length = (length << 7) | (byte & 0x7f);
    count += 1;
    if (!(byte & 0x80)) return { length, next: offset };
  }
  return null;
}

function parseAudioSpecificConfig(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 2) return null;
  const objectType = bytes[0] >>> 3;
  const frequencyIndex = ((bytes[0] & 0x07) << 1) | (bytes[1] >>> 7);
  const frequencies = [96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000,
    22_050, 16_000, 12_000, 11_025, 8_000, 7_350];
  const sampleRate = frequencyIndex === 15 && bytes.length >= 5
    ? readUint24BE(bytes, 2)
    : frequencies[frequencyIndex] ?? null;
  const channelConfig = (bytes[1] >>> 3) & 0x0f;
  const channels = channelConfig === 1 ? 1 : channelConfig === 2 ? 2 : null;
  return { objectType, sampleRate, channels };
}

function findDecoderSpecificInfo(bytes, esds) {
  for (let offset = esds.dataStart + 4; offset + 2 <= esds.end; offset += 1) {
    if (bytes[offset] !== 0x05) continue;
    const descriptor = parseDescriptorLength(bytes, offset + 1, esds.end);
    if (!descriptor || descriptor.length < 2
      || descriptor.next + descriptor.length > esds.end) continue;
    return bytes.slice(descriptor.next, descriptor.next + descriptor.length);
  }
  return null;
}

async function readTopLevelBoxes(file, state, signal) {
  const boxes = [];
  let offset = 0;
  while (offset + 8 <= file.size && boxes.length < 128) {
    const headerBytes = await readRange(file, offset, Math.min(file.size, offset + 16), state, signal);
    const size32 = readUint32BE(headerBytes, 0);
    const type = ascii(headerBytes, 4, 4);
    const headerSize = size32 === 1 ? 16 : 8;
    const size = size32 === 1
      ? readUint64BE(headerBytes, 8)
      : size32 === 0 ? file.size - offset : size32;
    if (!type || !Number.isSafeInteger(size) || size < headerSize) fail('AUDIO_DECODE_FAILED');
    const end = safeAdd(offset, size);
    if (end > file.size) fail('AUDIO_DECODE_FAILED');
    boxes.push({ type, offset, size, headerSize, dataStart: offset + headerSize, end });
    offset = end;
  }
  if (offset !== file.size || !boxes.length) fail('AUDIO_DECODE_FAILED');
  return boxes;
}

function tableBudget(state, bytes) {
  state.tableBytes = safeAdd(state.tableBytes, bytes, 'AUDIO_MEMORY_BUDGET_EXCEEDED');
  if (state.tableBytes > M4A_TABLE_BUDGET) fail('AUDIO_MEMORY_BUDGET_EXCEEDED');
}

function readEntryCount(bytes, box, stride, state) {
  const count = readUint32BE(bytes, box.dataStart + 4);
  if (!Number.isSafeInteger(count) || count <= 0 || count > M4A_ENTRY_LIMIT) {
    fail('AUDIO_MEMORY_BUDGET_EXCEEDED');
  }
  const required = safeMultiply(count, stride);
  if (box.dataStart + 8 + required > box.end) fail('AUDIO_DECODE_FAILED');
  tableBudget(state, required);
  return count;
}

async function demuxM4a(file, state, signal, emitProgress) {
  emitProgress?.({ phase: 'demux', ratio: 0.02 });
  const top = await readTopLevelBoxes(file, state, signal);
  if (top[0]?.type !== 'ftyp' || top.some((item) => item.type === 'moof')) {
    fail(top.some((item) => item.type === 'moof') ? 'AUDIO_CODEC_UNSUPPORTED' : 'AUDIO_DECODE_FAILED');
  }
  const moovRef = top.find((item) => item.type === 'moov');
  const mdats = top.filter((item) => item.type === 'mdat');
  if (!moovRef || !mdats.length || moovRef.size > M4A_MOOV_LIMIT) {
    fail(moovRef?.size > M4A_MOOV_LIMIT ? 'AUDIO_MEMORY_BUDGET_EXCEEDED' : 'AUDIO_DECODE_FAILED');
  }
  const chunkBytes = boundedChunkBytes(state.limits);
  const moovBytes = await readRangeChunked(
    file, moovRef.offset, moovRef.end, state, signal, chunkBytes
  );
  state.peakBufferedBytes = Math.max(state.peakBufferedBytes, moovBytes.length);
  const moov = boxHeader(moovBytes, 0, moovBytes.length);
  if (!moov || moov.type !== 'moov') fail('AUDIO_DECODE_FAILED');
  const moovChildren = boxChildren(moovBytes, moov);
  const tracks = moovChildren.filter((item) => item.type === 'trak');
  if (tracks.length !== 1) fail('AUDIO_CODEC_UNSUPPORTED');
  const track = tracks[0];
  if (childBox(moovBytes, track, 'edts')) fail('AUDIO_CODEC_UNSUPPORTED');
  const mdia = childBox(moovBytes, track, 'mdia');
  const hdlr = mdia && childBox(moovBytes, mdia, 'hdlr');
  if (!mdia || !hdlr || ascii(moovBytes, hdlr.dataStart + 8, 4) !== 'soun') {
    fail('AUDIO_CODEC_UNSUPPORTED');
  }
  const mdhd = childBox(moovBytes, mdia, 'mdhd');
  const minf = childBox(moovBytes, mdia, 'minf');
  const stbl = minf && childBox(moovBytes, minf, 'stbl');
  if (!mdhd || !stbl || moovBytes[mdhd.dataStart] !== 0) fail('AUDIO_CODEC_UNSUPPORTED');
  const timescale = readUint32BE(moovBytes, mdhd.dataStart + 12);
  const duration = readUint32BE(moovBytes, mdhd.dataStart + 16);
  if (!timescale || !duration) fail('AUDIO_DECODE_FAILED');

  const stsd = childBox(moovBytes, stbl, 'stsd');
  const stts = childBox(moovBytes, stbl, 'stts');
  const stsc = childBox(moovBytes, stbl, 'stsc');
  const stsz = childBox(moovBytes, stbl, 'stsz');
  const stco = childBox(moovBytes, stbl, 'stco');
  const co64 = childBox(moovBytes, stbl, 'co64');
  if (!stsd || !stts || !stsc || !stsz || Boolean(stco) === Boolean(co64)) {
    fail('AUDIO_DECODE_FAILED');
  }
  if (readUint32BE(moovBytes, stsd.dataStart + 4) !== 1) fail('AUDIO_CODEC_UNSUPPORTED');
  const sampleEntry = boxHeader(moovBytes, stsd.dataStart + 8, stsd.end);
  if (!sampleEntry || sampleEntry.type !== 'mp4a') fail('AUDIO_CODEC_UNSUPPORTED');
  const entryChannels = readUint16BE(moovBytes, sampleEntry.dataStart + 16);
  const entryRateFixed = readUint32BE(moovBytes, sampleEntry.dataStart + 24);
  const entryRate = entryRateFixed === null ? null : entryRateFixed / 65536;
  const esds = childBox(moovBytes, sampleEntry, 'esds', sampleEntry.dataStart + 28);
  const description = esds && findDecoderSpecificInfo(moovBytes, esds);
  const asc = description && parseAudioSpecificConfig(description);
  if (!asc || asc.objectType !== 2 || !SUPPORTED_SAMPLE_RATES.has(asc.sampleRate)
    || ![1, 2].includes(asc.channels) || entryChannels !== asc.channels
    || entryRate !== asc.sampleRate || timescale !== asc.sampleRate) {
    fail('AUDIO_CODEC_UNSUPPORTED');
  }

  const constantSize = readUint32BE(moovBytes, stsz.dataStart + 4);
  const sampleCount = readUint32BE(moovBytes, stsz.dataStart + 8);
  if (!sampleCount || sampleCount > M4A_ENTRY_LIMIT) fail('AUDIO_MEMORY_BUDGET_EXCEEDED');
  // Three typed tables are retained while samples are streamed: Uint32 size,
  // Uint32 duration, and Float64 file offset (16 bytes/sample).  No per-sample
  // JS objects are created, keeping the declared table budget meaningful.
  tableBudget(state, safeMultiply(sampleCount, 16));
  const sizes = new Uint32Array(sampleCount);
  if (!constantSize && stsz.dataStart + 12 + sampleCount * 4 > stsz.end) fail('AUDIO_DECODE_FAILED');
  for (let index = 0; index < sampleCount; index += 1) {
    const size = constantSize || readUint32BE(moovBytes, stsz.dataStart + 12 + index * 4);
    if (!size || size > M4A_SAMPLE_BYTES_LIMIT) fail('AUDIO_DECODE_FAILED');
    sizes[index] = size;
  }

  const durations = new Uint32Array(sampleCount);
  const sttsCount = readEntryCount(moovBytes, stts, 8, state);
  let durationIndex = 0;
  let totalSamples = 0;
  for (let index = 0; index < sttsCount; index += 1) {
    const count = readUint32BE(moovBytes, stts.dataStart + 8 + index * 8);
    const delta = readUint32BE(moovBytes, stts.dataStart + 12 + index * 8);
    if (!count || !delta || durationIndex + count > sampleCount) fail('AUDIO_DECODE_FAILED');
    for (let sample = 0; sample < count; sample += 1) durations[durationIndex++] = delta;
    totalSamples = safeAdd(totalSamples, safeMultiply(count, delta, 'AUDIO_DECODE_FAILED'));
  }
  if (durationIndex !== sampleCount || Math.abs(totalSamples - duration) > 1) fail('AUDIO_DECODE_FAILED');

  const offsetBox = stco ?? co64;
  const offsetStride = stco ? 4 : 8;
  const chunkCount = readEntryCount(moovBytes, offsetBox, offsetStride, state);
  tableBudget(state, safeMultiply(chunkCount, 8));
  const chunkOffsets = new Float64Array(chunkCount);
  for (let index = 0; index < chunkCount; index += 1) {
    const value = stco
      ? readUint32BE(moovBytes, stco.dataStart + 8 + index * 4)
      : readUint64BE(moovBytes, co64.dataStart + 8 + index * 8);
    if (!Number.isSafeInteger(value) || value < 0 || value >= file.size) fail('AUDIO_DECODE_FAILED');
    chunkOffsets[index] = value;
  }

  const stscCount = readEntryCount(moovBytes, stsc, 12, state);
  tableBudget(state, safeMultiply(stscCount, 8));
  const mappingFirstChunks = new Uint32Array(stscCount);
  const mappingSamplesPerChunk = new Uint32Array(stscCount);
  for (let index = 0; index < stscCount; index += 1) {
    const firstChunk = readUint32BE(moovBytes, stsc.dataStart + 8 + index * 12);
    const samplesPerChunk = readUint32BE(moovBytes, stsc.dataStart + 12 + index * 12);
    const descriptionIndex = readUint32BE(moovBytes, stsc.dataStart + 16 + index * 12);
    if (!firstChunk || !samplesPerChunk || descriptionIndex !== 1
      || (index === 0 && firstChunk !== 1)
      || (index > 0 && firstChunk <= mappingFirstChunks[index - 1])) fail('AUDIO_DECODE_FAILED');
    mappingFirstChunks[index] = firstChunk;
    mappingSamplesPerChunk[index] = samplesPerChunk;
  }

  const sampleOffsets = new Float64Array(sampleCount);
  let sampleIndex = 0;
  let previousEnd = -1;
  let mappingIndex = 0;
  for (let chunkIndex = 1; chunkIndex <= chunkCount; chunkIndex += 1) {
    while (mappingIndex + 1 < stscCount
      && mappingFirstChunks[mappingIndex + 1] <= chunkIndex) {
      mappingIndex += 1;
    }
    let offset = chunkOffsets[chunkIndex - 1];
    for (let index = 0; index < mappingSamplesPerChunk[mappingIndex]; index += 1) {
      if (sampleIndex >= sampleCount) fail('AUDIO_DECODE_FAILED');
      const size = sizes[sampleIndex];
      const end = safeAdd(offset, size);
      if (offset < previousEnd || !mdats.some((mdat) => offset >= mdat.dataStart && end <= mdat.end)) {
        fail('AUDIO_DECODE_FAILED');
      }
      sampleOffsets[sampleIndex] = offset;
      previousEnd = end;
      offset = end;
      sampleIndex += 1;
    }
  }
  if (sampleIndex !== sampleCount) fail('AUDIO_DECODE_FAILED');
  state.peakBufferedBytes = Math.max(
    state.peakBufferedBytes,
    moovBytes.length + state.tableBytes
  );
  emitProgress?.({ phase: 'demux', ratio: 0.15 });
  return {
    codec: 'mp4a.40.2',
    sampleRate: asc.sampleRate,
    channels: asc.channels,
    description,
    sampleOffsets,
    sampleSizes: sizes,
    sampleDurations: durations,
    sampleCount,
    totalSamples,
    table: stco ? 'stco' : 'co64',
    moovPlacement: moovRef.offset < mdats[0].offset ? 'before-mdat' : 'after-mdat'
  };
}

async function readMp3Layout(file, state, signal) {
  const head = await readRange(file, 0, Math.min(file.size, MP3_HEAD_LIMIT), state, signal);
  state.peakBufferedBytes = Math.max(state.peakBufferedBytes, head.length);
  const signature = parseMp3Signature(head, file.size);
  const frame = signature?.firstFrame;
  if (signature?.signatureMime !== 'audio/mpeg' || !frame || frame.layer !== 3
    || !SUPPORTED_SAMPLE_RATES.has(frame.sampleRate) || ![1, 2].includes(frame.channels)) {
    fail(signature?.errorCode === 'AUDIO_DECODE_FAILED'
      ? 'AUDIO_DECODE_FAILED'
      : 'AUDIO_CODEC_UNSUPPORTED');
  }
  return {
    codec: 'mp3',
    sampleRate: frame.sampleRate,
    channels: frame.channels,
    audioOffset: signature.audioOffset
  };
}

function trailingId3v1(bytes) {
  return bytes.length === 128 && ascii(bytes, 0, 3) === 'TAG';
}

async function decodeMp3(file, layout, state, signal, decode, emitProgress) {
  const chunkBytes = boundedChunkBytes(state.limits);
  let residual = new Uint8Array(0);
  let fileOffset = layout.audioOffset;
  let frameCount = 0;
  let sampleCount = 0;
  let expected = null;
  while (fileOffset < file.size) {
    throwIfAborted(signal);
    const end = Math.min(file.size, fileOffset + chunkBytes);
    const chunk = await readRange(file, fileOffset, end, state, signal);
    fileOffset = end;
    const buffer = concat(residual, chunk);
    state.peakBufferedBytes = Math.max(state.peakBufferedBytes, buffer.length);
    let cursor = 0;
    while (cursor + 4 <= buffer.length) {
      const frame = parseMp3Header(buffer, cursor);
      if (!frame || frame.layer !== 3 || !SUPPORTED_SAMPLE_RATES.has(frame.sampleRate)) {
        if (fileOffset === file.size && trailingId3v1(buffer.slice(cursor))) {
          cursor = buffer.length;
          break;
        }
        fail('AUDIO_DECODE_FAILED');
      }
      if (cursor + frame.frameLength > buffer.length) break;
      const shape = `${frame.versionBits}:${frame.layer}:${frame.sampleRate}:${frame.channels}`;
      expected ??= shape;
      if (shape !== expected) fail('AUDIO_DECODE_FAILED');
      await decode(buffer.slice(cursor, cursor + frame.frameLength), {
        timestampSamples: sampleCount,
        durationSamples: frame.samplesPerFrame,
        progress: file.size > layout.audioOffset
          ? (fileOffset - buffer.length + cursor - layout.audioOffset) / (file.size - layout.audioOffset)
          : 1
      });
      sampleCount += frame.samplesPerFrame;
      frameCount += 1;
      cursor += frame.frameLength;
    }
    residual = buffer.slice(cursor);
    state.maxResidualBytes = Math.max(state.maxResidualBytes, residual.length);
    if (residual.length > MP3_RESIDUAL_LIMIT) fail('AUDIO_DECODE_FAILED');
    emitProgress?.({ phase: 'decode', ratio: 0.15 + Math.min(0.65, 0.65 * fileOffset / file.size) });
  }
  if (!frameCount || residual.length) fail('AUDIO_DECODE_FAILED');
  return { frameCount, totalSamples: sampleCount };
}

function floatToInt16(value) {
  const sample = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  return Math.max(-32768, Math.min(32767, Math.round(sample * (sample < 0 ? 32768 : 32767))));
}

function audioDataToPcm(audioData, targetChannels, state) {
  const frames = audioData.numberOfFrames;
  const channels = audioData.numberOfChannels;
  if (!Number.isInteger(frames) || frames <= 0 || ![1, 2].includes(channels)
    || !SUPPORTED_SAMPLE_RATES.has(audioData.sampleRate)) fail('AUDIO_DECODE_FAILED');
  const floatBytes = safeMultiply(frames, channels * 4);
  const intBytes = safeMultiply(frames, targetChannels * 2);
  const pcmBytes = safeAdd(floatBytes, intBytes, 'AUDIO_MEMORY_BUDGET_EXCEEDED');
  if (pcmBytes > AUDIO_PCM_BUFFER_BUDGET) fail('AUDIO_MEMORY_BUDGET_EXCEEDED');
  const leftFloat = new Float32Array(frames);
  const rightFloat = channels === 2 ? new Float32Array(frames) : leftFloat;
  audioData.copyTo(leftFloat, { planeIndex: 0, format: 'f32-planar' });
  if (channels === 2) audioData.copyTo(rightFloat, { planeIndex: 1, format: 'f32-planar' });
  const left = new Int16Array(frames);
  const right = targetChannels === 2 ? new Int16Array(frames) : left;
  for (let index = 0; index < frames; index += 1) {
    if (targetChannels === 1) {
      left[index] = floatToInt16(channels === 2
        ? (leftFloat[index] + rightFloat[index]) / 2
        : leftFloat[index]);
    } else {
      left[index] = floatToInt16(leftFloat[index]);
      right[index] = floatToInt16(rightFloat[index]);
    }
  }
  state.peakPcmBytes = Math.max(state.peakPcmBytes, pcmBytes);
  state.peakBufferedBytes = Math.max(state.peakBufferedBytes, pcmBytes);
  return { left, right, frames, sampleRate: audioData.sampleRate, channels };
}

async function supportedDecoderConfig(config) {
  if (typeof AudioDecoder !== 'function' || typeof EncodedAudioChunk !== 'function') {
    fail('AUDIO_WORKER_UNAVAILABLE');
  }
  try {
    const result = await AudioDecoder.isConfigSupported(config);
    if (!result?.supported) fail('AUDIO_CODEC_UNSUPPORTED');
  } catch (error) {
    if (error?.code) throw error;
    fail('AUDIO_CODEC_UNSUPPORTED');
  }
}

/**
 * Decode the S4.1 compressed subset inside the current Worker. `onPcm` is
 * synchronous by contract so every AudioData can be closed in its callback.
 */
export async function decodeCompressedAudio(file, plan, limits, signal, emitProgress, hooks = {}) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) fail('AUDIO_DECODE_FAILED');
  const state = {
    limits,
    inputBytesRead: 0,
    tableBytes: 0,
    maxInputSliceBytes: 0,
    maxResidualBytes: 0,
    maxDecodeQueueSize: 0,
    peakPcmBytes: 0,
    peakBufferedBytes: 0,
    outputAudioData: 0,
    outputFrames: 0,
    unclosedAudioData: 0
  };
  const sourceContainer = plan?.sourceContainer;
  const layout = sourceContainer === 'mp3'
    ? await readMp3Layout(file, state, signal)
    : sourceContainer === 'mp4'
      ? await demuxM4a(file, state, signal, emitProgress)
      : fail('AUDIO_CODEC_UNSUPPORTED');
  const config = {
    codec: layout.codec,
    sampleRate: layout.sampleRate,
    numberOfChannels: layout.channels,
    ...(layout.description ? { description: layout.description } : {})
  };
  await supportedDecoderConfig(config);
  hooks.onConfig?.({ sampleRate: layout.sampleRate, channels: layout.channels });
  let decoderError = null;
  let pcmError = null;
  const targetChannels = plan?.targetChannels === 2 ? 2 : 1;
  const decoder = new AudioDecoder({
    output(audioData) {
      state.unclosedAudioData += 1;
      try {
        throwIfAborted(signal);
        const pcm = audioDataToPcm(audioData, targetChannels, state);
        if (pcm.sampleRate !== layout.sampleRate || pcm.channels !== layout.channels) {
          fail('AUDIO_DECODE_FAILED');
        }
        hooks.onPcm?.(pcm.left, pcm.right);
        state.outputAudioData += 1;
        state.outputFrames += pcm.frames;
      } catch (error) {
        pcmError ??= error;
      } finally {
        try { audioData.close(); } catch {}
        state.unclosedAudioData = Math.max(0, state.unclosedAudioData - 1);
      }
    },
    error(error) { decoderError ??= error; }
  });
  try {
    decoder.configure(config);
    const decode = async (data, timing) => {
      throwIfAborted(signal);
      if (decoderError || pcmError) throw pcmError ?? decoderError;
      decoder.decode(new EncodedAudioChunk({
        type: 'key',
        timestamp: Math.round(timing.timestampSamples * 1_000_000 / layout.sampleRate),
        duration: Math.round(timing.durationSamples * 1_000_000 / layout.sampleRate),
        data
      }));
      state.maxDecodeQueueSize = Math.max(state.maxDecodeQueueSize, decoder.decodeQueueSize);
      if (decoder.decodeQueueSize >= MAX_DECODE_QUEUE_SIZE) await decoder.flush();
      if (decoderError || pcmError) throw pcmError ?? decoderError;
    };
    if (sourceContainer === 'mp3') {
      await decodeMp3(file, layout, state, signal, decode, emitProgress);
    } else {
      let timestampSamples = 0;
      let index = 0;
      const chunkBytes = boundedChunkBytes(state.limits);
      while (index < layout.sampleCount) {
        throwIfAborted(signal);
        const batchStart = layout.sampleOffsets[index];
        let batchEnd = safeAdd(batchStart, layout.sampleSizes[index]);
        let batchLimit = index + 1;
        while (batchLimit < layout.sampleCount) {
          const nextStart = layout.sampleOffsets[batchLimit];
          const nextEnd = safeAdd(nextStart, layout.sampleSizes[batchLimit]);
          if (nextStart !== batchEnd || nextEnd - batchStart > chunkBytes) break;
          batchEnd = nextEnd;
          batchLimit += 1;
        }
        const batch = await readRange(file, batchStart, batchEnd, state, signal);
        state.peakBufferedBytes = Math.max(state.peakBufferedBytes, batch.byteLength);
        while (index < batchLimit) {
          const offset = layout.sampleOffsets[index] - batchStart;
          const size = layout.sampleSizes[index];
          const duration = layout.sampleDurations[index];
          await decode(batch.subarray(offset, offset + size), {
            timestampSamples,
            durationSamples: duration
          });
          timestampSamples += duration;
          index += 1;
          emitProgress?.({
            phase: 'decode',
            ratio: 0.15 + 0.65 * (index / layout.sampleCount)
          });
        }
      }
    }
    await decoder.flush();
    throwIfAborted(signal);
    if (decoderError || pcmError) throw pcmError ?? decoderError;
    if (!state.outputAudioData || !state.outputFrames) fail('AUDIO_DECODE_FAILED');
    emitProgress?.({ phase: 'encode', ratio: 0.9 });
    return {
      inputBytesRead: state.inputBytesRead,
      peakBufferedBytes: Math.max(state.peakBufferedBytes, state.peakPcmBytes),
      peakPcmBytes: state.peakPcmBytes,
      maxInputSliceBytes: state.maxInputSliceBytes,
      maxResidualBytes: state.maxResidualBytes,
      maxDecodeQueueSize: state.maxDecodeQueueSize,
      outputAudioData: state.outputAudioData,
      outputFrames: state.outputFrames,
      unclosedAudioData: state.unclosedAudioData,
      decoderClosed: true,
      table: layout.table ?? null,
      moovPlacement: layout.moovPlacement ?? null
    };
  } catch (error) {
    if (error?.code) throw error;
    fail('AUDIO_DECODE_FAILED');
  } finally {
    try { decoder.close(); } catch {}
  }
}

export const S41_DECODE_LIMITS = Object.freeze({
  mp3ResidualBytes: MP3_RESIDUAL_LIMIT,
  mp3HeadBytes: MP3_HEAD_LIMIT,
  m4aMoovBytes: M4A_MOOV_LIMIT,
  m4aTableBytes: M4A_TABLE_BUDGET,
  m4aEntries: M4A_ENTRY_LIMIT,
  m4aSampleBytes: M4A_SAMPLE_BYTES_LIMIT,
  maxDecodeQueueSize: MAX_DECODE_QUEUE_SIZE
});
