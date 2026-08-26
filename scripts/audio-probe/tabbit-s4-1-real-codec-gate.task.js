await page.goto('http://127.0.0.1:8765/test-pages/audio-s4-1-capability.html', {
  waitUntil: 'domcontentloaded'
});
await page.waitForFunction(() => typeof globalThis.__runS41CodecGate === 'function');
const result = await page.evaluate(() => globalThis.__runS41CodecGate());
if (!result.mp3First?.outputCount || !result.aacFirst?.outputCount) {
  throw new Error('REAL_AUDIO_DATA_GATE_FAILED');
}
if (result.mp3First.unclosedAudioData !== 0 || result.aacFirst.unclosedAudioData !== 0) {
  throw new Error('AUDIO_DATA_LEAK');
}
if (!result.errorGate?.errorHandled || result.cancelled?.lateMessages?.length) {
  throw new Error('ERROR_OR_CANCEL_GATE_FAILED');
}
return result;
