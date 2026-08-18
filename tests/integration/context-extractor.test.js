import { expect, test } from '@playwright/test';

test('extracts bounded uploader context and excludes sensitive or unrelated DOM text', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });

  const result = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const section = document.createElement('section');
    section.innerHTML = [
      '<label for="context-input">证件照上传</label>',
      '<input id="context-input" type="file" accept="image/jpeg,image/png" required aria-describedby="context-help">',
      '<p id="context-help">支持 JPG 或 PNG，大小不超过 100ＫＢ，尺寸 390×567 像素。</p>',
      '<div role="alert">文件格式不合法，请重新选择。</div>',
      '<input type="password" value="password-secret">',
      '<textarea>textarea-secret</textarea>',
      '<nav>导航 123MB</nav>',
      '<script>JPG 最大 1KB</script>',
      '<footer>版权 2026</footer>'
    ].join('');
    document.body.append(section);

    const input = section.querySelector('#context-input');
    const context = api.extractRelevantContext(
      input,
      'JPG 至少 30KB；token: selected-secret；https://example.test/path?q=secret'
    );
    return {
      context,
      aiText: api.selectAiRelevantText(context)
    };
  });

  expect(result.context.attributes).toEqual({
    accept: 'image/jpeg,image/png',
    multiple: false,
    required: true
  });
  expect(result.context.label).toBe('证件照上传');
  expect(result.context.alertTexts).toEqual(['文件格式不合法,请重新选择。']);
  expect(result.context.normalizedText.length).toBeLessThanOrEqual(6000);
  expect(result.context.normalizedText).toContain('100KB');
  expect(result.context.normalizedText).toContain('[REDACTED]');
  expect(result.context.normalizedText).not.toContain('selected-secret');
  expect(result.context.normalizedText).not.toContain('https://');
  expect(result.context.normalizedText).not.toContain('password-secret');
  expect(result.context.normalizedText).not.toContain('textarea-secret');
  expect(result.context.normalizedText).not.toContain('导航 123MB');
  expect(result.context.normalizedText).not.toContain('JPG 最大 1KB');
  expect(result.context.normalizedText).not.toContain('版权 2026');
  expect(result.aiText.length).toBeLessThanOrEqual(2000);
  expect(result.aiText).toContain('100KB');
});

test('keeps contexts isolated and applies the 6000-character budget', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });

  const result = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const makeSection = (id, label, text) => {
      const section = document.createElement('section');
      section.innerHTML = `<label for="${id}">${label}</label><input id="${id}" type="file" accept="image/png"><p>${text}</p>`;
      document.body.append(section);
      return section.querySelector('input');
    };
    const inputA = makeSection('input-a', '头像', `PNG，最大 200KB。${'A'.repeat(7000)}`);
    const inputB = makeSection('input-b', '封面', 'JPG，最大 500KB。B-only text');
    const contextA = api.extractRelevantContext(inputA);
    const contextB = api.extractRelevantContext(inputB);
    return {
      contextA,
      contextB,
      aiA: api.selectAiRelevantText(contextA)
    };
  });

  expect(result.contextA.truncated).toBe(true);
  expect(result.contextA.normalizedText.length).toBe(6000);
  expect(result.contextB.normalizedText).toContain('500KB');
  expect(result.contextA.normalizedText).not.toContain('500KB');
  expect(result.aiA.length).toBeLessThanOrEqual(2000);
});
