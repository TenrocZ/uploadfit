#!/usr/bin/env node

/* Generate a deterministic, valid PCM WAV fixture without retaining it in Git. */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const DEFAULT_BYTES = 200_000_000;
const HEADER_BYTES = 44;
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const requestedBitDepth = Number(process.argv.find((item) => item.startsWith('--bit-depth='))?.split('=')[1] ?? 16);
const BIT_DEPTH = [16, 24, 32].includes(requestedBitDepth) ? requestedBitDepth : 16;
const FRAME_BYTES = CHANNELS * (BIT_DEPTH / 8);
const CHUNK_BYTES = 1024 * 1024;

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function numericArgument(name, fallback) {
  const value = Number(argument(name));
  return Number.isFinite(value) ? value : fallback;
}

function outputPath() {
  const requested = argument('output');
  if (requested) return path.resolve(requested);
  return path.join(os.tmpdir(), 'uploadfit-v2-s0-audio', 'synthetic-200mb-pcm.wav');
}

function wavHeader(dataBytes) {
  const header = Buffer.alloc(HEADER_BYTES);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(dataBytes + 36, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * FRAME_BYTES, 28);
  header.writeUInt16LE(FRAME_BYTES, 32);
  header.writeUInt16LE(BIT_DEPTH, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

function fillTone(buffer, firstFrame) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const frames = buffer.byteLength / FRAME_BYTES;
  for (let frame = 0; frame < frames; frame += 1) {
    const sampleIndex = firstFrame + frame;
    const seconds = sampleIndex / SAMPLE_RATE;
    // A deterministic speech-like test signal: two low harmonics with a
    // periodic quiet interval.  It is synthetic and carries no user content.
    const quiet = (seconds % 8) > 6.75;
    const envelope = quiet ? 0.02 : 0.18 + 0.08 * Math.sin(seconds * 2 * Math.PI * 1.3);
    const tone = Math.sin(seconds * 2 * Math.PI * 220)
      + 0.35 * Math.sin(seconds * 2 * Math.PI * 440)
      + 0.15 * Math.sin(seconds * 2 * Math.PI * 660);
    const sample = Math.max(-1, Math.min(1, tone * envelope));
    const value = Math.round(sample * (BIT_DEPTH === 32 ? 2147483647 : 32767));
    const offset = frame * FRAME_BYTES;
    if (BIT_DEPTH === 16) {
      view.setInt16(offset, value, true);
      view.setInt16(offset + 2, value, true);
    } else if (BIT_DEPTH === 24) {
      for (const channelOffset of [0, 3]) {
        const channelValue = value & 0xffffff;
        view.setUint8(offset + channelOffset, channelValue & 0xff);
        view.setUint8(offset + channelOffset + 1, (channelValue >>> 8) & 0xff);
        view.setUint8(offset + channelOffset + 2, (channelValue >>> 16) & 0xff);
      }
    } else {
      view.setInt32(offset, value, true);
      view.setInt32(offset + 4, value, true);
    }
  }
}

async function writeChunk(stream, buffer) {
  if (stream.write(buffer)) return;
  await once(stream, 'drain');
}

async function main() {
  const smallFixture = process.argv.includes('--small');
  const minimumBytes = smallFixture ? HEADER_BYTES + FRAME_BYTES : DEFAULT_BYTES;
  const requestedBytes = Math.max(minimumBytes, Math.floor(numericArgument('bytes', DEFAULT_BYTES)));
  // `--bytes` is the requested total file size, including the 44-byte WAV
  // header.  Align only the data region so a PCM32 stereo request of
  // 200,000,044 bytes is actually emitted at exactly that size.
  const requestedDataBytes = requestedBytes - HEADER_BYTES;
  const dataBytes = requestedDataBytes - (requestedDataBytes % FRAME_BYTES);
  const target = outputPath();
  await mkdir(path.dirname(target), { recursive: true });
  await rm(target, { force: true });
  const stream = createWriteStream(target, { flags: 'wx' });
  const hash = createHash('sha256');
  const header = wavHeader(dataBytes);
  stream.write(header);
  hash.update(header);
  const chunkSize = Math.floor(CHUNK_BYTES / FRAME_BYTES) * FRAME_BYTES;
  let written = 0;
  let frameIndex = 0;
  while (written < dataBytes) {
    const size = Math.min(chunkSize, dataBytes - written);
    const chunk = Buffer.alloc(size);
    fillTone(chunk, frameIndex);
    await writeChunk(stream, chunk);
    hash.update(chunk);
    written += size;
    frameIndex += size / FRAME_BYTES;
  }
  stream.end();
  await once(stream, 'close');
  const totalBytes = HEADER_BYTES + dataBytes;
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    fixture: 'synthetic-speech-like-pcm-wav',
    container: 'wav',
    codec: 'pcm',
    bytes: totalBytes,
    sha256: hash.digest('hex').toUpperCase(),
    durationMs: (dataBytes / (SAMPLE_RATE * FRAME_BYTES)) * 1000,
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bitDepth: BIT_DEPTH,
    semanticContent: 'synthetic-only',
    outputPathOmitted: true
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
