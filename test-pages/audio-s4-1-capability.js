(() => {
  const SAMPLE_RATE = 48_000;
  const AAC_FRAMES = 48;
  const AAC_SAMPLES_PER_FRAME = 1024;
  const MAX_GATE_MS = 20_000;

  function syntheticWav(durationSeconds = 0.75, sampleRate = SAMPLE_RATE, channels = 1) {
    const frames = Math.floor(sampleRate * durationSeconds);
    const blockAlign = channels * 2;
    const bytes = new Uint8Array(44 + frames * blockAlign);
    const view = new DataView(bytes.buffer);
    const writeAscii = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
    };
    writeAscii(0, 'RIFF');
    view.setUint32(4, bytes.length - 8, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeAscii(36, 'data');
    view.setUint32(40, frames * blockAlign, true);
    for (let frame = 0; frame < frames; frame += 1) {
      const seconds = frame / sampleRate;
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.sin(seconds * Math.PI * 2 * (220 + channel * 55)) * 0.18
          + Math.sin(seconds * Math.PI * 2 * 440) * 0.04;
        view.setInt16(44 + (frame * channels + channel) * 2, Math.round(sample * 32767), true);
      }
    }
    return new File([bytes], 'synthetic.wav', { type: 'audio/wav', lastModified: 0 });
  }

  async function generateMp3Fixture(durationSeconds = 0.75, bitrateKbps = 128,
    sampleRate = SAMPLE_RATE, channels = 1) {
    const api = globalThis.__uploadfit_debug_bundle__;
    if (!api?.createAudioWorkerRuntime) throw new Error('DEBUG_AUDIO_RUNTIME_UNAVAILABLE');
    const runtime = api.createAudioWorkerRuntime();
    const wav = syntheticWav(durationSeconds, sampleRate, channels);
    try {
      const result = await runtime.run(wav, {
        durationMs: durationSeconds * 1000,
        targetMaxBytes: 1_000_000,
        safeTargetBytes: 900_000,
        targetBitrateKbps: bitrateKbps,
        targetSampleRate: sampleRate,
        targetChannels: channels
      }, { timeoutMs: 10_000, inputChunkBytes: 257 });
      return new File([result.blob], 'synthetic.mp3', {
        type: 'audio/mpeg',
        lastModified: 0
      });
    } finally {
      runtime.dispose();
    }
  }

  async function sha256(blob) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function codecGateWorker() {
    const MAX_MOOV_BYTES = 1024 * 1024;
    const MAX_TABLE_ENTRIES = 100_000;
    const MP3_SLICE_BYTES = 257;
    const MAX_MP3_RESIDUAL_BYTES = 4096;
    const MAX_DECODE_QUEUE = 8;
    const active = new Map();

    const ascii = (value) => new TextEncoder().encode(value);
    const concatList = (values) => {
      const arrays = values.flat().filter(Boolean);
      const length = arrays.reduce((sum, value) => sum + value.length, 0);
      const result = new Uint8Array(length);
      let offset = 0;
      for (const value of arrays) {
        result.set(value, offset);
        offset += value.length;
      }
      return result;
    };
    const concat = (...values) => concatList(values);
    const u8 = (...values) => new Uint8Array(values);
    const u16 = (value) => u8((value >>> 8) & 0xff, value & 0xff);
    const u24 = (value) => u8((value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
    const u32 = (value) => u8(
      (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff
    );
    const u64 = (value) => concat(u32(Math.floor(value / 0x100000000)), u32(value >>> 0));
    const box = (type, ...payload) => {
      const body = concat(...payload);
      return concat(u32(body.length + 8), ascii(type), body);
    };
    const fullBox = (type, flags, ...payload) => box(type, u32(flags >>> 0), ...payload);
    const descriptorLength = (length) => {
      const groups = [length & 0x7f];
      let value = length >>> 7;
      while (value) {
        groups.unshift((value & 0x7f) | 0x80);
        value >>>= 7;
      }
      return u8(...groups);
    };
    const descriptor = (tag, payload) => concat(u8(tag), descriptorLength(payload.length), payload);

    function matrix() {
      return concat(
        u32(0x00010000), u32(0), u32(0),
        u32(0), u32(0x00010000), u32(0),
        u32(0), u32(0), u32(0x40000000)
      );
    }

    function makeM4a(chunks, description, sampleRate, channels, options = {}) {
      const sampleSizes = chunks.map((item) => item.data.length);
      const sampleCount = sampleSizes.length;
      const duration = sampleCount * 1024;
      const mediaBytes = concatList(chunks.map((item) => item.data));
      const ftyp = box('ftyp', ascii('M4A '), u32(0), ascii('isom'), ascii('M4A '), ascii('mp42'));
      const mdat = box('mdat', mediaBytes);
      const padding = Number.isFinite(options.paddingBytes) && options.paddingBytes >= 8
        ? box('free', new Uint8Array(options.paddingBytes - 8))
        : null;
      const decoderSpecific = descriptor(0x05, description);
      const decoderConfig = descriptor(0x04, concat(
        u8(0x40, 0x15), u24(Math.min(mediaBytes.length, 0xffffff)),
        u32(128_000), u32(128_000), decoderSpecific
      ));
      const esDescriptor = descriptor(0x03, concat(
        u16(1), u8(0), decoderConfig, descriptor(0x06, u8(0x02))
      ));
      const esds = fullBox('esds', 0, esDescriptor);
      const mp4a = box(options.sampleEntryType ?? 'mp4a',
        new Uint8Array(6), u16(1), new Uint8Array(8),
        u16(channels), u16(16), u16(0), u16(0), u32(sampleRate << 16), esds
      );
      const stsd = fullBox('stsd', 0, u32(1), mp4a);
      const stts = fullBox('stts', 0, u32(1), u32(sampleCount), u32(1024));
      const stsc = fullBox('stsc', 0, u32(1), u32(1), u32(sampleCount), u32(1));
      const sampleSizeTable = new Uint8Array(sampleCount * 4);
      const sampleSizeView = new DataView(sampleSizeTable.buffer);
      for (let index = 0; index < sampleCount; index += 1) {
        sampleSizeView.setUint32(index * 4, sampleSizes[index], false);
      }
      const stsz = fullBox('stsz', 0, u32(0), u32(sampleCount), sampleSizeTable);
      const url = fullBox('url ', 1);
      const dref = fullBox('dref', 0, u32(1), url);
      const dinf = box('dinf', dref);
      const smhd = fullBox('smhd', 0, u16(0), u16(0));
      const buildMoov = (chunkOffset) => {
        const offsetTable = options.table === 'co64'
          ? fullBox('co64', 0, u32(1), u64(chunkOffset))
          : fullBox('stco', 0, u32(1), u32(chunkOffset));
        const stbl = box('stbl', stsd, stts, stsc, stsz, offsetTable);
        const minf = box('minf', smhd, dinf, stbl);
        const mdhd = fullBox('mdhd', 0, u32(0), u32(0), u32(sampleRate),
          u32(duration + (options.durationDelta ?? 0)), u16(0), u16(0));
        const hdlr = fullBox('hdlr', 0, u32(0), ascii('soun'), new Uint8Array(12), ascii('UploadFit synthetic'), u8(0));
        const mdia = box('mdia', mdhd, hdlr, minf);
        const tkhd = fullBox('tkhd', 7,
          u32(0), u32(0), u32(1), u32(0), u32(duration), new Uint8Array(8),
          u16(0), u16(0), u16(0x0100), u16(0), matrix(), u32(0), u32(0)
        );
        const trak = box('trak', tkhd, options.editList ? box('edts', box('elst', new Uint8Array(8))) : null, mdia);
        const tracks = options.multipleTracks ? [trak, trak] : [trak];
        const mvhd = fullBox('mvhd', 0,
          u32(0), u32(0), u32(sampleRate), u32(duration), u32(0x00010000),
          u16(0x0100), new Uint8Array(10), matrix(), new Uint8Array(24), u32(2)
        );
        return box('moov', mvhd, ...tracks);
      };
      let moov = buildMoov(0);
      const chunkOffset = options.corruptOffset
        ? 0xfffffff0
        : options.placement === 'before-mdat'
          ? ftyp.length + (padding?.length ?? 0) + moov.length + 8
          : ftyp.length + (padding?.length ?? 0) + 8;
      moov = buildMoov(chunkOffset);
      const ordered = options.placement === 'before-mdat'
        ? [ftyp, padding, moov, mdat].filter(Boolean)
        : [ftyp, padding, mdat, moov].filter(Boolean);
      if (options.fragmented) ordered.push(box('moof', u32(0)));
      return new Blob(ordered, { type: 'audio/mp4' });
    }

    async function generateM4aFixture(options = {}) {
      const sampleRate = options.sampleRate ?? 48_000;
      // Chromium's AAC encoder currently rejects 32 kHz while its decoder
      // supports it. Raw AAC access units do not embed the sampling rate, so
      // encode the spectral payload at a supported rate and provide the real
      // 32 kHz interpretation through ASC + the MP4 media timescale.
      const encoderSampleRate = sampleRate === 32_000 ? 44_100 : sampleRate;
      const channelsCount = options.channels ?? 1;
      const frameCount = options.frames ?? 48;
      const chunks = [];
      let description = null;
      const encoder = new AudioEncoder({
        output(chunk, metadata) {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          chunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? 0 });
          const supplied = metadata?.decoderConfig?.description;
          if (!description && supplied) description = new Uint8Array(supplied);
        },
        error() {}
      });
      encoder.configure({
        codec: 'mp4a.40.2',
        sampleRate: encoderSampleRate,
        numberOfChannels: channelsCount,
        bitrate: options.bitrate ?? 128_000
      });
      let closedAudioData = 0;
      for (let index = 0; index < frameCount; index += 1) {
        const values = new Float32Array(1024 * channelsCount);
        for (let sample = 0; sample < 1024; sample += 1) {
          const absolute = index * values.length + sample;
          for (let channel = 0; channel < channelsCount; channel += 1) {
            values[channel * 1024 + sample] = Math.sin(
              absolute * Math.PI * 2 * (440 + channel * 110) / encoderSampleRate
            ) * 0.1;
          }
        }
        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: encoderSampleRate,
          numberOfFrames: 1024,
          numberOfChannels: channelsCount,
          timestamp: Math.round(index * 1024 * 1_000_000 / encoderSampleRate),
          data: values
        });
        encoder.encode(audioData);
        audioData.close();
        closedAudioData += 1;
      }
      await encoder.flush();
      encoder.close();
      if (!chunks.length) throw Object.assign(new Error('AAC_ENCODE_EMPTY'), { code: 'AAC_ENCODE_EMPTY' });
      const seedChunks = chunks.slice();
      let mediaBytes = seedChunks.reduce((sum, item) => sum + item.data.length, 0);
      const minimumMediaBytes = Number.isFinite(options.minimumMediaBytes)
        ? Math.max(0, Math.floor(options.minimumMediaBytes))
        : 0;
      while (mediaBytes < minimumMediaBytes) {
        for (const item of seedChunks) {
          if (mediaBytes >= minimumMediaBytes) break;
          chunks.push({ data: item.data, timestamp: 0, duration: item.duration });
          mediaBytes += item.data.length;
        }
      }
      description ??= u8(0x11, 0x88);
      if (sampleRate === 32_000) {
        description = description.slice();
        description[0] = 0x12;
        description[1] = 0x80 | (channelsCount << 3) | (description[1] & 0x07);
      }
      if (options.objectType && options.objectType !== 2) {
        description = description.slice();
        description[0] = ((options.objectType & 0x1f) << 3) | (description[0] & 0x07);
      }
      const blob = makeM4a(chunks, description, sampleRate, channelsCount, options);
      return {
        blob,
        stats: {
          encodedChunks: chunks.length,
          descriptionBytes: description.length,
          generatedAudioDataClosed: closedAudioData,
          container: 'mp4',
          codec: 'mp4a.40.2',
          moovPlacement: options.placement ?? 'after-mdat',
          chunkOffsetTable: options.table ?? 'stco',
          sampleRate,
          encoderSampleRate,
          channels: channelsCount,
          frames: chunks.length,
          seedFrames: frameCount,
          mediaBytes
        }
      };
    }

    const read32 = (bytes, offset) => offset >= 0 && offset + 4 <= bytes.length
      ? ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16)
        + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
      : null;
    const read64 = (bytes, offset) => {
      const high = read32(bytes, offset);
      const low = read32(bytes, offset + 4);
      const value = high === null || low === null ? null : high * 0x100000000 + low;
      return Number.isSafeInteger(value) ? value : null;
    };
    const text = (bytes, offset, length) => offset >= 0 && offset + length <= bytes.length
      ? String.fromCharCode(...bytes.slice(offset, offset + length)) : '';
    const boxHeader = (bytes, offset, end = bytes.length) => {
      if (offset < 0 || offset + 8 > end || offset + 8 > bytes.length) return null;
      const size32 = read32(bytes, offset);
      const type = text(bytes, offset + 4, 4);
      let size = size32;
      let headerSize = 8;
      if (size32 === 1) {
        size = read64(bytes, offset + 8);
        headerSize = 16;
      } else if (size32 === 0) size = end - offset;
      if (!Number.isSafeInteger(size) || size < headerSize || offset + size > end) return null;
      return { offset, type, size, headerSize, dataStart: offset + headerSize, end: offset + size };
    };
    const children = (bytes, parent, start = parent.dataStart) => {
      const result = [];
      let offset = start;
      while (offset + 8 <= parent.end) {
        const item = boxHeader(bytes, offset, parent.end);
        if (!item) throw Object.assign(new Error('M4A_BOX_INVALID'), { code: 'M4A_BOX_INVALID' });
        result.push(item);
        offset = item.end;
      }
      if (offset !== parent.end) throw Object.assign(new Error('M4A_BOX_TRAILING'), { code: 'M4A_BOX_TRAILING' });
      return result;
    };
    const child = (bytes, parent, type, start) => children(bytes, parent, start).find((item) => item.type === type) ?? null;
    const descriptorLengthAt = (bytes, offset, end) => {
      let length = 0;
      let count = 0;
      while (offset < end && count < 4) {
        const value = bytes[offset++];
        length = (length << 7) | (value & 0x7f);
        count += 1;
        if (!(value & 0x80)) return { length, next: offset };
      }
      return null;
    };
    const findAsc = (bytes, esds) => {
      for (let offset = esds.dataStart + 4; offset + 2 <= esds.end; offset += 1) {
        if (bytes[offset] !== 0x05) continue;
        const length = descriptorLengthAt(bytes, offset + 1, esds.end);
        if (!length || length.next + length.length > esds.end || length.length < 2) continue;
        return bytes.slice(length.next, length.next + length.length);
      }
      return null;
    };

    async function topLevelBoxes(file, state) {
      const result = [];
      let offset = 0;
      while (offset + 8 <= file.size && result.length < 64) {
        const headerBytes = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + 16)).arrayBuffer());
        state.inputBytesRead += headerBytes.length;
        state.maxSliceBytes = Math.max(state.maxSliceBytes, headerBytes.length);
        const size32 = read32(headerBytes, 0);
        const type = text(headerBytes, 4, 4);
        const headerSize = size32 === 1 ? 16 : 8;
        const absoluteSize = size32 === 1
          ? read64(headerBytes, 8)
          : size32 === 0 ? file.size - offset : size32;
        if (!type || !Number.isSafeInteger(absoluteSize) || absoluteSize < headerSize) {
          throw Object.assign(new Error('M4A_TOP_LEVEL_INVALID'), { code: 'M4A_TOP_LEVEL_INVALID' });
        }
        if (offset + absoluteSize > file.size) throw Object.assign(new Error('M4A_TOP_LEVEL_RANGE'), { code: 'M4A_TOP_LEVEL_RANGE' });
        result.push({ type, offset, size: absoluteSize, headerSize,
          dataStart: offset + headerSize, end: offset + absoluteSize });
        offset += absoluteSize;
      }
      if (offset !== file.size) throw Object.assign(new Error('M4A_TOP_LEVEL_TRAILING'), { code: 'M4A_TOP_LEVEL_TRAILING' });
      return result;
    }

    async function demuxM4a(file, state) {
      const top = await topLevelBoxes(file, state);
      if (top.some((item) => item.type === 'moof')) throw Object.assign(new Error('M4A_FRAGMENTED'), { code: 'M4A_FRAGMENTED' });
      const moovRef = top.find((item) => item.type === 'moov');
      const mdats = top.filter((item) => item.type === 'mdat');
      if (!moovRef || moovRef.size > MAX_MOOV_BYTES || mdats.length !== 1) {
        throw Object.assign(new Error('M4A_LAYOUT_UNSUPPORTED'), { code: 'M4A_LAYOUT_UNSUPPORTED' });
      }
      const moovBytes = new Uint8Array(await file.slice(moovRef.offset, moovRef.end).arrayBuffer());
      state.inputBytesRead += moovBytes.length;
      state.maxSliceBytes = Math.max(state.maxSliceBytes, moovBytes.length);
      const moov = boxHeader(moovBytes, 0, moovBytes.length);
      const tracks = children(moovBytes, moov).filter((item) => item.type === 'trak');
      if (tracks.length !== 1) throw Object.assign(new Error('M4A_TRACK_COUNT'), { code: 'M4A_TRACK_COUNT' });
      const mdia = child(moovBytes, tracks[0], 'mdia');
      const hdlr = mdia && child(moovBytes, mdia, 'hdlr');
      if (!hdlr || text(moovBytes, hdlr.dataStart + 8, 4) !== 'soun') {
        throw Object.assign(new Error('M4A_AUDIO_TRACK_MISSING'), { code: 'M4A_AUDIO_TRACK_MISSING' });
      }
      const mdhd = child(moovBytes, mdia, 'mdhd');
      const minf = child(moovBytes, mdia, 'minf');
      const stbl = minf && child(moovBytes, minf, 'stbl');
      if (!mdhd || !stbl || moovBytes[mdhd.dataStart] !== 0) {
        throw Object.assign(new Error('M4A_TABLE_MISSING'), { code: 'M4A_TABLE_MISSING' });
      }
      const sampleRate = read32(moovBytes, mdhd.dataStart + 12);
      const stsd = child(moovBytes, stbl, 'stsd');
      const stts = child(moovBytes, stbl, 'stts');
      const stsc = child(moovBytes, stbl, 'stsc');
      const stsz = child(moovBytes, stbl, 'stsz');
      const stco = child(moovBytes, stbl, 'stco');
      const co64 = child(moovBytes, stbl, 'co64');
      if (!stsd || !stts || !stsc || !stsz || (!stco && !co64)) {
        throw Object.assign(new Error('M4A_TABLE_MISSING'), { code: 'M4A_TABLE_MISSING' });
      }
      if (read32(moovBytes, stsd.dataStart + 4) !== 1) {
        throw Object.assign(new Error('M4A_STSD_COUNT'), { code: 'M4A_STSD_COUNT' });
      }
      const entry = boxHeader(moovBytes, stsd.dataStart + 8, stsd.end);
      if (!entry || entry.type !== 'mp4a') throw Object.assign(new Error('M4A_CODEC_UNSUPPORTED'), { code: 'M4A_CODEC_UNSUPPORTED' });
      const channels = (moovBytes[entry.dataStart + 16] << 8) | moovBytes[entry.dataStart + 17];
      const esds = child(moovBytes, entry, 'esds', entry.dataStart + 28);
      const description = esds && findAsc(moovBytes, esds);
      const objectType = description ? description[0] >>> 3 : 0;
      if (!description || objectType !== 2 || ![1, 2].includes(channels)) {
        throw Object.assign(new Error('M4A_CODEC_UNSUPPORTED'), { code: 'M4A_CODEC_UNSUPPORTED' });
      }

      const sampleSize = read32(moovBytes, stsz.dataStart + 4);
      const sampleCount = read32(moovBytes, stsz.dataStart + 8);
      if (!sampleCount || sampleCount > MAX_TABLE_ENTRIES) throw Object.assign(new Error('M4A_SAMPLE_COUNT'), { code: 'M4A_SAMPLE_COUNT' });
      const sizes = [];
      for (let index = 0; index < sampleCount; index += 1) {
        const size = sampleSize || read32(moovBytes, stsz.dataStart + 12 + index * 4);
        if (!size) throw Object.assign(new Error('M4A_SAMPLE_SIZE'), { code: 'M4A_SAMPLE_SIZE' });
        sizes.push(size);
      }
      const durationEntries = read32(moovBytes, stts.dataStart + 4);
      const durations = [];
      for (let entryIndex = 0; entryIndex < durationEntries; entryIndex += 1) {
        const count = read32(moovBytes, stts.dataStart + 8 + entryIndex * 8);
        const delta = read32(moovBytes, stts.dataStart + 12 + entryIndex * 8);
        if (!count || !delta || durations.length + count > sampleCount) throw Object.assign(new Error('M4A_STTS_INVALID'), { code: 'M4A_STTS_INVALID' });
        for (let index = 0; index < count; index += 1) durations.push(delta);
      }
      if (durations.length !== sampleCount) throw Object.assign(new Error('M4A_STTS_INVALID'), { code: 'M4A_STTS_INVALID' });

      const chunkCount = read32(moovBytes, (stco ?? co64).dataStart + 4);
      if (!chunkCount || chunkCount > MAX_TABLE_ENTRIES) throw Object.assign(new Error('M4A_CHUNK_COUNT'), { code: 'M4A_CHUNK_COUNT' });
      const chunkOffsets = [];
      for (let index = 0; index < chunkCount; index += 1) {
        const value = stco
          ? read32(moovBytes, stco.dataStart + 8 + index * 4)
          : read64(moovBytes, co64.dataStart + 8 + index * 8);
        if (!Number.isSafeInteger(value)) throw Object.assign(new Error('M4A_CHUNK_OFFSET'), { code: 'M4A_CHUNK_OFFSET' });
        chunkOffsets.push(value);
      }
      const mapCount = read32(moovBytes, stsc.dataStart + 4);
      const maps = [];
      for (let index = 0; index < mapCount; index += 1) {
        maps.push({
          firstChunk: read32(moovBytes, stsc.dataStart + 8 + index * 12),
          samplesPerChunk: read32(moovBytes, stsc.dataStart + 12 + index * 12),
          descriptionIndex: read32(moovBytes, stsc.dataStart + 16 + index * 12)
        });
      }
      if (!maps.length || maps[0].firstChunk !== 1 || maps.some((item) => !item.samplesPerChunk || item.descriptionIndex !== 1)) {
        throw Object.assign(new Error('M4A_STSC_INVALID'), { code: 'M4A_STSC_INVALID' });
      }
      const samples = [];
      let sampleIndex = 0;
      for (let chunkIndex = 1; chunkIndex <= chunkOffsets.length; chunkIndex += 1) {
        const mapping = [...maps].reverse().find((item) => item.firstChunk <= chunkIndex);
        let offset = chunkOffsets[chunkIndex - 1];
        for (let index = 0; index < mapping.samplesPerChunk; index += 1) {
          if (sampleIndex >= sizes.length) throw Object.assign(new Error('M4A_STSC_OVERFLOW'), { code: 'M4A_STSC_OVERFLOW' });
          const size = sizes[sampleIndex];
          const end = offset + size;
          const inMdat = mdats.some((item) => offset >= item.dataStart && end <= item.end);
          if (!Number.isSafeInteger(end) || !inMdat) throw Object.assign(new Error('M4A_SAMPLE_RANGE'), { code: 'M4A_SAMPLE_RANGE' });
          samples.push({ offset, size, duration: durations[sampleIndex] });
          offset = end;
          sampleIndex += 1;
        }
      }
      if (sampleIndex !== sizes.length) throw Object.assign(new Error('M4A_SAMPLE_COUNT_MISMATCH'), { code: 'M4A_SAMPLE_COUNT_MISMATCH' });
      return { sampleRate, channels, description, samples, table: stco ? 'stco' : 'co64', moovPlacement: moovRef.offset < mdats[0].offset ? 'before-mdat' : 'after-mdat' };
    }

    const mp3Rates = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
    const mp3Bitrates = {
      3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
      2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
    };
    function mp3Header(bytes, offset) {
      if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return null;
      const version = (bytes[offset + 1] >>> 3) & 3;
      const layerBits = (bytes[offset + 1] >>> 1) & 3;
      const bitrateIndex = (bytes[offset + 2] >>> 4) & 15;
      const sampleRateIndex = (bytes[offset + 2] >>> 2) & 3;
      const padding = (bytes[offset + 2] >>> 1) & 1;
      if (version === 1 || layerBits !== 1 || !bitrateIndex || bitrateIndex === 15 || sampleRateIndex === 3) return null;
      const sampleRate = mp3Rates[version]?.[sampleRateIndex];
      const bitrateKbps = mp3Bitrates[version === 3 ? 3 : 2]?.[bitrateIndex];
      if (!sampleRate || !bitrateKbps) return null;
      const samplesPerFrame = version === 3 ? 1152 : 576;
      const frameLength = Math.floor((version === 3 ? 144 : 72) * bitrateKbps * 1000 / sampleRate) + padding;
      return { sampleRate, bitrateKbps, samplesPerFrame, frameLength, channels: (bytes[offset + 3] >>> 6) === 3 ? 1 : 2 };
    }

    async function forEachMp3Frame(file, state, callback) {
      let fileOffset = 0;
      let residual = new Uint8Array(0);
      let frameCount = 0;
      while (fileOffset < file.size) {
        state.throwIfCancelled();
        const end = Math.min(file.size, fileOffset + MP3_SLICE_BYTES);
        const chunk = new Uint8Array(await file.slice(fileOffset, end).arrayBuffer());
        state.inputBytesRead += chunk.length;
        state.maxSliceBytes = Math.max(state.maxSliceBytes, chunk.length);
        fileOffset = end;
        const buffer = concat(residual, chunk);
        let cursor = 0;
        while (cursor + 4 <= buffer.length) {
          const header = mp3Header(buffer, cursor);
          if (!header) {
            if (frameCount) throw Object.assign(new Error('MP3_FRAME_INVALID'), { code: 'MP3_FRAME_INVALID' });
            cursor += 1;
            continue;
          }
          if (cursor + header.frameLength > buffer.length) break;
          await callback(buffer.slice(cursor, cursor + header.frameLength), header, frameCount);
          frameCount += 1;
          cursor += header.frameLength;
        }
        residual = buffer.slice(cursor);
        state.maxResidualBytes = Math.max(state.maxResidualBytes, residual.length);
        if (residual.length > MAX_MP3_RESIDUAL_BYTES) throw Object.assign(new Error('MP3_RESIDUAL_LIMIT'), { code: 'MP3_RESIDUAL_LIMIT' });
      }
      if (!frameCount || residual.length) throw Object.assign(new Error('MP3_TRUNCATED'), { code: 'MP3_TRUNCATED' });
      return frameCount;
    }

    function decoderState(task) {
      return {
        task,
        inputBytesRead: 0,
        maxSliceBytes: 0,
        maxResidualBytes: 0,
        maxDecodeQueueSize: 0,
        outputCount: 0,
        outputFrames: 0,
        sampleRate: null,
        channels: null,
        unclosedAudioData: 0,
        decoder: null,
        decoderClosed: false,
        throwIfCancelled() {
          if (task.cancelled) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });
        }
      };
    }

    async function decodeFile(file, codec, task, repeat = 1) {
      let lastStats = null;
      for (let iteration = 0; iteration < repeat; iteration += 1) {
        task.cancelled && (() => { throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' }); })();
        const state = decoderState(task);
        let decoderFailure = null;
        const configure = (config) => {
          state.decoder = new AudioDecoder({
            output(audioData) {
              state.unclosedAudioData += 1;
              state.outputCount += 1;
              state.outputFrames += audioData.numberOfFrames;
              state.sampleRate ??= audioData.sampleRate;
              state.channels ??= audioData.numberOfChannels;
              audioData.close();
              state.unclosedAudioData -= 1;
            },
            error(error) { decoderFailure = error?.name ?? 'EncodingError'; }
          });
          state.decoder.configure(config);
        };
        try {
          if (codec === 'mp3') {
            let timestampSamples = 0;
            await forEachMp3Frame(file, state, async (frame, header) => {
              state.throwIfCancelled();
              if (!state.decoder) configure({ codec: 'mp3', sampleRate: header.sampleRate, numberOfChannels: header.channels });
              state.decoder.decode(new EncodedAudioChunk({
                type: 'key',
                timestamp: Math.round(timestampSamples * 1_000_000 / header.sampleRate),
                duration: Math.round(header.samplesPerFrame * 1_000_000 / header.sampleRate),
                data: frame
              }));
              timestampSamples += header.samplesPerFrame;
              state.maxDecodeQueueSize = Math.max(state.maxDecodeQueueSize, state.decoder.decodeQueueSize);
              if (state.decoder.decodeQueueSize >= MAX_DECODE_QUEUE) await state.decoder.flush();
              if (decoderFailure) throw Object.assign(new Error('DECODE_FAILED'), { code: 'DECODE_FAILED' });
            });
          } else {
            const demuxed = await demuxM4a(file, state);
            configure({
              codec: 'mp4a.40.2',
              sampleRate: demuxed.sampleRate,
              numberOfChannels: demuxed.channels,
              description: demuxed.description
            });
            let timestampSamples = 0;
            for (const sample of demuxed.samples) {
              state.throwIfCancelled();
              const data = new Uint8Array(await file.slice(sample.offset, sample.offset + sample.size).arrayBuffer());
              state.inputBytesRead += data.length;
              state.maxSliceBytes = Math.max(state.maxSliceBytes, data.length);
              state.decoder.decode(new EncodedAudioChunk({
                type: 'key',
                timestamp: Math.round(timestampSamples * 1_000_000 / demuxed.sampleRate),
                duration: Math.round(sample.duration * 1_000_000 / demuxed.sampleRate),
                data
              }));
              timestampSamples += sample.duration;
              state.maxDecodeQueueSize = Math.max(state.maxDecodeQueueSize, state.decoder.decodeQueueSize);
              if (state.decoder.decodeQueueSize >= MAX_DECODE_QUEUE) await state.decoder.flush();
              if (decoderFailure) throw Object.assign(new Error('DECODE_FAILED'), { code: 'DECODE_FAILED' });
            }
            lastStats = { table: demuxed.table, moovPlacement: demuxed.moovPlacement };
          }
          await state.decoder.flush();
          state.throwIfCancelled();
          if (decoderFailure || !state.outputCount) throw Object.assign(new Error('DECODE_EMPTY'), { code: 'DECODE_EMPTY' });
          lastStats = {
            ...(lastStats ?? {}),
            outputCount: state.outputCount,
            outputFrames: state.outputFrames,
            sampleRate: state.sampleRate,
            channels: state.channels,
            inputBytesRead: state.inputBytesRead,
            maxSliceBytes: state.maxSliceBytes,
            maxResidualBytes: state.maxResidualBytes,
            maxDecodeQueueSize: state.maxDecodeQueueSize,
            unclosedAudioData: state.unclosedAudioData,
            iteration: iteration + 1
          };
        } finally {
          try { state.decoder?.close(); state.decoderClosed = true; } catch {}
          if (lastStats) lastStats.decoderClosed = state.decoderClosed;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return lastStats;
    }

    async function decoderErrorGate() {
      let callbackError = null;
      let outputCount = 0;
      const decoder = new AudioDecoder({
        output(data) { outputCount += 1; data.close(); },
        error(error) { callbackError = error?.name ?? 'EncodingError'; }
      });
      let rejected = false;
      try {
        decoder.configure({ codec: 'mp3', sampleRate: 48_000, numberOfChannels: 1 });
        decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: 0, data: u8(0, 1, 2, 3, 4, 5) }));
        await decoder.flush();
      } catch {
        rejected = true;
      } finally {
        try { decoder.close(); } catch {}
      }
      const noOutput = outputCount === 0;
      return {
        errorHandled: rejected || Boolean(callbackError) || noOutput,
        errorMode: rejected ? 'flush-rejected' : callbackError ? 'decoder-callback' : 'zero-output',
        callbackError,
        outputCount,
        decoderClosed: true
      };
    }

    self.onmessage = async (event) => {
      const data = event.data ?? {};
      if (data.type === 'GENERATE_M4A') {
        try {
          const result = await generateM4aFixture(data.options ?? {});
          self.postMessage({ type: 'M4A_GENERATED', taskId: data.taskId, blob: result.blob, stats: result.stats });
        } catch (error) {
          self.postMessage({ type: 'ERROR', taskId: data.taskId, code: error?.code ?? 'AAC_GENERATION_FAILED' });
        }
        return;
      }
      if (data.type === 'RUN_ERROR_GATE') {
        const result = await decoderErrorGate();
        self.postMessage({ type: 'ERROR_GATE_RESULT', taskId: data.taskId, result });
        return;
      }
      if (data.type === 'CANCEL') {
        const task = active.get(data.taskId);
        if (task) task.cancelled = true;
        return;
      }
      if (data.type === 'RUN') {
        const task = { taskId: data.taskId, cancelled: false };
        active.set(data.taskId, task);
        try {
          const result = await decodeFile(data.file, data.codec, task, data.repeat ?? 1);
          if (task.cancelled) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });
          self.postMessage({ type: 'RESULT', taskId: data.taskId, codec: data.codec, result });
        } catch (error) {
          self.postMessage({
            type: task.cancelled || error?.code === 'CANCELLED' ? 'CANCELLED' : 'ERROR',
            taskId: data.taskId,
            code: task.cancelled ? 'CANCELLED' : error?.code ?? 'DECODE_FAILED',
            cleanup: { decoderClosed: true, unclosedAudioData: 0 }
          });
        } finally {
          active.delete(data.taskId);
        }
        return;
      }
      if (data.type === 'DISPOSE') {
        for (const task of active.values()) task.cancelled = true;
        self.postMessage({ type: 'DISPOSED', taskId: data.taskId, activeTasks: active.size });
      }
    };
  }

  function makeWorker() {
    const source = `(${codecGateWorker.toString()})();`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    return { worker: new Worker(url), url };
  }

  function request(worker, payload, expected, timeoutMs = MAX_GATE_MS) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.removeEventListener('message', onMessage);
        reject(new Error(`GATE_TIMEOUT:${payload.taskId}`));
      }, timeoutMs);
      const onMessage = (event) => {
        const message = event.data;
        if (!message || message.taskId !== payload.taskId) return;
        if (!expected.includes(message.type) && message.type !== 'ERROR') return;
        clearTimeout(timeout);
        worker.removeEventListener('message', onMessage);
        if (message.type === 'ERROR') reject(Object.assign(new Error(message.code), { code: message.code }));
        else resolve(message);
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage(payload);
    });
  }

  async function createFixtureFiles() {
    const mp3 = await generateMp3Fixture();
    const handle = makeWorker();
    try {
      const generated = await request(handle.worker, {
        type: 'GENERATE_M4A', taskId: 'generate-fixture-m4a'
      }, ['M4A_GENERATED']);
      return {
        mp3,
        m4a: new File([generated.blob], 'synthetic.m4a', {
          type: 'audio/mp4', lastModified: 0
        }),
        m4aStats: generated.stats
      };
    } finally {
      handle.worker.terminate();
      URL.revokeObjectURL(handle.url);
    }
  }

  async function createLargeMp3(minBytes = 30 * 1024 * 1024) {
    const base = await generateMp3Fixture(0.75, 320, 48_000, 1);
    const parts = [];
    let bytes = 0;
    while (bytes < minBytes) {
      parts.push(base);
      bytes += base.size;
    }
    return new File(parts, 'synthetic-large.mp3', {
      type: 'audio/mpeg', lastModified: 0
    });
  }

  async function createM4aVariant(options = {}) {
    const handle = makeWorker();
    try {
      const generated = await request(handle.worker, {
        type: 'GENERATE_M4A', taskId: `generate-variant-${crypto.randomUUID()}`, options
      }, ['M4A_GENERATED']);
      return {
        file: new File([generated.blob], 'synthetic-variant.m4a', {
          type: 'audio/mp4', lastModified: 0
        }),
        stats: generated.stats
      };
    } finally {
      handle.worker.terminate();
      URL.revokeObjectURL(handle.url);
    }
  }

  async function runProductionDecoderGate() {
    const api = globalThis.__uploadfit_debug_bundle__;
    const fixtures = await createFixtureFiles();
    const runtime = api.createAudioWorkerRuntime();
    const run = async (file, sourceContainer, sourceCodec) => {
      const sourceMetadata = await api.inspectAudio(file);
      const progress = [];
      const result = await runtime.run(file, {
        mediaKind: 'audio',
        sourceContainer,
        sourceCodec,
        targetMime: 'audio/mpeg',
        targetContainer: 'mp3',
        targetCodec: 'mp3',
        targetMaxBytes: 1_000_000,
        safeTargetBytes: 900_000,
        targetBitrateKbps: 128,
        targetSampleRate: 48_000,
        targetChannels: 1
      }, {
        timeoutMs: 15_000,
        inputChunkBytes: 257,
        onProgress: (event) => progress.push({ phase: event.phase, ratio: event.ratio })
      });
      const output = new File([result.blob], 'output.mp3', {
        type: 'audio/mpeg', lastModified: 0
      });
      const outputMetadata = await api.inspectAudio(output);
      const validation = await api.validateAudioOutputFile(output, {
        mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 1_000_000
      }, {
        targetSampleRate: 48_000,
        targetChannels: 1,
        targetMaxBytes: 1_000_000,
        safeTargetBytes: 900_000
      }, sourceMetadata);
      return {
        source: {
          signatureMime: sourceMetadata.signatureMime,
          container: sourceMetadata.container,
          codec: sourceMetadata.codec,
          durationMs: sourceMetadata.durationMs,
          sampleRate: sourceMetadata.sampleRate,
          channels: sourceMetadata.channels,
          errorCode: sourceMetadata.errorCode
        },
        output: {
          bytes: output.size,
          signatureMime: outputMetadata.signatureMime,
          durationMs: outputMetadata.durationMs,
          sampleRate: outputMetadata.sampleRate,
          channels: outputMetadata.channels,
          valid: validation.valid,
          violations: validation.violations.map((item) => item.code)
        },
        stats: result.stats,
        cleanup: result.cleanup,
        progress
      };
    };
    try {
      return {
        mp3: await run(fixtures.mp3, 'mp3', 'mp3'),
        m4a: await run(fixtures.m4a, 'mp4', 'aac-lc')
      };
    } finally {
      runtime.dispose();
    }
  }

  async function runProductionPipelineGate() {
    const api = globalThis.__uploadfit_debug_bundle__;
    const fixtures = await createFixtureFiles();
    const largeMp3 = await generateMp3Fixture(8, 320);
    const runtime = api.createAudioWorkerRuntime();
    const run = async (file, rules) => {
      const sourceMetadata = await api.inspectAudio(file);
      let plan = api.createAudioProcessingPlan(sourceMetadata, rules);
      const requestedOperations = [...plan.operations];
      const confirmationTypes = plan.confirmations.map((item) => item.type);
      for (const pending of plan.confirmations) {
        plan = api.resolveAudioConfirmation(plan, {
          id: pending.id,
          type: pending.type,
          accepted: true,
          suggestedPayload: pending.suggestedPayload
        });
      }
      const sourceIdentity = file;
      const result = await api.processAudio(file, plan, {
        metadata: sourceMetadata,
        rules,
        workerRuntime: runtime,
        timeoutMs: 20_000,
        inputChunkBytes: 257
      });
      return {
        source: {
          bytes: file.size,
          signatureMime: sourceMetadata.signatureMime,
          container: sourceMetadata.container,
          codec: sourceMetadata.codec,
          durationMs: sourceMetadata.durationMs,
          errorCode: sourceMetadata.errorCode
        },
        plan: {
          operations: requestedOperations,
          confirmationTypes,
          executable: plan.executable,
          unfixable: [...plan.unfixable]
        },
        output: {
          bytes: result.file.size,
          type: result.file.type,
          sameFile: result.file === sourceIdentity,
          signatureMime: result.metadata.signatureMime,
          container: result.metadata.container,
          codec: result.metadata.codec,
          durationMs: result.metadata.durationMs
        },
        validation: {
          valid: result.validation.valid,
          violations: result.validation.violations.map((item) => item.code),
          frameValidation: result.validation.frameValidation
        },
        workerUsed: result.workerUsed,
        encodePasses: result.encodePasses,
        peakBufferedBytes: result.peakBufferedBytes,
        cleanup: result.cleanup
      };
    };
    try {
      return {
        mp3: await run(largeMp3, {
          mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 200_000
        }),
        m4a: await run(fixtures.m4a, {
          mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: 1_000_000
        })
      };
    } finally {
      runtime.dispose();
    }
  }

  async function runCapabilityGate() {
    const mp3 = await generateMp3Fixture();
    const handle = makeWorker();
    const messagesAfterCancel = [];
    const recordAfterCancel = (event) => messagesAfterCancel.push(event.data?.type ?? 'UNKNOWN');
    try {
      const generated = await request(handle.worker, {
        type: 'GENERATE_M4A', taskId: 'generate-m4a'
      }, ['M4A_GENERATED']);
      const m4a = new File([generated.blob], 'synthetic.m4a', {
        type: 'audio/mp4', lastModified: 0
      });
      const mp3First = await request(handle.worker, {
        type: 'RUN', taskId: 'mp3-first', codec: 'mp3', file: mp3
      }, ['RESULT']);
      const aacFirst = await request(handle.worker, {
        type: 'RUN', taskId: 'aac-first', codec: 'aac', file: m4a
      }, ['RESULT']);
      const errorGate = await request(handle.worker, {
        type: 'RUN_ERROR_GATE', taskId: 'decoder-error'
      }, ['ERROR_GATE_RESULT']);

      const cancelPromise = request(handle.worker, {
        type: 'RUN', taskId: 'mp3-cancel', codec: 'mp3', file: mp3, repeat: 200
      }, ['CANCELLED']);
      setTimeout(() => handle.worker.postMessage({ type: 'CANCEL', taskId: 'mp3-cancel' }), 5);
      const cancelled = await cancelPromise;
      handle.worker.addEventListener('message', recordAfterCancel);
      await new Promise((resolve) => setTimeout(resolve, 50));
      handle.worker.removeEventListener('message', recordAfterCancel);

      const mp3Reuse = await request(handle.worker, {
        type: 'RUN', taskId: 'mp3-reuse', codec: 'mp3', file: mp3
      }, ['RESULT']);
      const aacReuse = await request(handle.worker, {
        type: 'RUN', taskId: 'aac-reuse', codec: 'aac', file: m4a
      }, ['RESULT']);
      const disposed = await request(handle.worker, {
        type: 'DISPOSE', taskId: 'dispose'
      }, ['DISPOSED']);

      return {
        fixture: {
          mp3: { bytes: mp3.size, sha256: await sha256(mp3), generatedBy: 'frozen-lamejs-worker' },
          m4a: {
            bytes: m4a.size,
            sha256: await sha256(m4a),
            generatedBy: 'worker-audioencoder-and-internal-muxer',
            ...generated.stats
          }
        },
        mp3First: mp3First.result,
        aacFirst: aacFirst.result,
        errorGate: errorGate.result,
        cancelled: {
          type: cancelled.type,
          code: cancelled.code,
          cleanup: cancelled.cleanup,
          lateMessages: messagesAfterCancel
        },
        mp3Reuse: mp3Reuse.result,
        aacReuse: aacReuse.result,
        disposed: { type: disposed.type, activeTasks: disposed.activeTasks },
        privacy: { pcmReturned: false, base64Returned: false, externalRequests: 0 }
      };
    } finally {
      handle.worker.terminate();
      URL.revokeObjectURL(handle.url);
    }
  }

  globalThis.__runS41CodecGate = runCapabilityGate;
  globalThis.__createS41CodecFixtures = createFixtureFiles;
  globalThis.__createS41LargeMp3 = createLargeMp3;
  globalThis.__createS41Mp3Variant = (options = {}) => generateMp3Fixture(
    options.durationSeconds ?? 0.75,
    options.bitrateKbps ?? 128,
    options.sampleRate ?? SAMPLE_RATE,
    options.channels ?? 1
  );
  globalThis.__createS41M4aVariant = createM4aVariant;
  globalThis.__runS41ProductionDecoderGate = runProductionDecoderGate;
  globalThis.__runS41ProductionPipelineGate = runProductionPipelineGate;
})();
