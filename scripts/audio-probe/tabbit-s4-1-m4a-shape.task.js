return await page.evaluate(async () => {
  const context = new AudioContext({ sampleRate: 48000 });
  const destination = context.createMediaStreamDestination();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 440;
  gain.gain.value = 0.1;
  oscillator.connect(gain).connect(destination);
  const chunks = [];
  const recorder = new MediaRecorder(destination.stream, {
    mimeType: 'audio/mp4;codecs=mp4a.40.2',
    audioBitsPerSecond: 128000
  });
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  await context.resume();
  oscillator.start();
  recorder.start(100);
  await new Promise((resolve) => setTimeout(resolve, 600));
  recorder.stop();
  oscillator.stop();
  await stopped;
  await context.close();
  const blob = new Blob(chunks, { type: recorder.mimeType });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const read32 = (offset) => ((bytes[offset] * 0x1000000)
    + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
  const ascii = (offset, length) => String.fromCharCode(...bytes.slice(offset, offset + length));
  const boxes = [];
  let offset = 0;
  while (offset + 8 <= bytes.length && boxes.length < 64) {
    const size = read32(offset);
    const type = ascii(offset + 4, 4);
    if (size < 8 || offset + size > bytes.length) break;
    boxes.push({ type, size });
    offset += size;
  }
  return {
    bytes: blob.size,
    type: blob.type,
    boxes,
    completeTopLevelParse: offset === bytes.length,
    contextState: context.state
  };
});
