import { expect, test } from '@playwright/test';

async function install(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => document.querySelector('#probe-file')?.remove());
}

test('S1 audio discovery classifies explicit audio controls and rejects mixed/video/PDF', async ({ page }) => {
  await install(page);
  const result = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const make = (accept, text = '') => {
      const label = document.createElement('label');
      label.textContent = text;
      const input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      label.append(input);
      document.body.append(label);
      return input;
    };
    const audio = make('audio/*', '上传音频文件');
    const list = make('.mp3,.m4a,.wav', '选择录音');
    list.multiple = true;
    const mixed = make('image/*,audio/*', '上传文件');
    const video = make('video/mp4', '上传视频');
    const pdf = make('application/pdf', '上传材料');
    const contexts = api.discoverUploaders(document);
    return {
      contexts: contexts.map((item) => ({ mediaKind: item.mediaKind, multiple: item.multiple, autoProcessable: item.autoProcessable })),
      mixed: api.classifyMediaKind(mixed),
      video: api.classifyMediaKind(video),
      pdf: api.classifyMediaKind(pdf),
      audio: api.classifyMediaKind(audio)
    };
  });
  expect(result.audio).toBe('audio');
  expect(result.mixed).toBe(null);
  expect(result.video).toBe(null);
  expect(result.pdf).toBe(null);
  expect(result.contexts).toEqual([
    { mediaKind: 'audio', multiple: false, autoProcessable: true },
    { mediaKind: 'audio', multiple: true, autoProcessable: false }
  ]);
});

test('S1 audio discovery reuses dynamic/open-shadow lifecycle and excludes UploadFit UI inputs', async ({ page }) => {
  await install(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const callbacks = [];
    const discovery = api.createUploaderDiscovery({ onDiscover: (context) => callbacks.push(context) });
    discovery.start();
    const host = document.createElement('section');
    const shadow = host.attachShadow({ mode: 'open' });
    const label = document.createElement('label');
    label.textContent = '上传录音 MP3';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mpeg';
    label.append(input);
    shadow.append(label);
    document.body.append(host);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const uiHost = document.createElement('div');
    uiHost.setAttribute('data-uploadfit-ui-host', '');
    const uiInput = document.createElement('input');
    uiInput.type = 'file';
    uiInput.accept = 'audio/*';
    uiHost.append(uiInput);
    document.body.append(uiHost);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const before = discovery.getUploaders();
    host.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = discovery.getUploaders();
    discovery.cleanup();
    return {
      callbackCount: callbacks.filter((item) => item.input === input).length,
      before: before.map((item) => ({ mediaKind: item.mediaKind, rootKind: item.rootKind })),
      after: after.length,
      uiInputDiscovered: before.some((item) => item.input === uiInput)
    };
  });
  expect(result).toEqual({
    callbackCount: 1,
    before: [{ mediaKind: 'audio', rootKind: 'open-shadow' }],
    after: 0,
    uiInputDiscovered: false
  });
});
