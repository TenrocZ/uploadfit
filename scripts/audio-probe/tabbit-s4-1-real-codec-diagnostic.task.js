await page.goto('http://127.0.0.1:8765/test-pages/audio-s4-1-capability.html', {
  waitUntil: 'domcontentloaded'
});
await page.waitForFunction(() => typeof globalThis.__runS41CodecGate === 'function');
return await page.evaluate(() => globalThis.__runS41CodecGate());
