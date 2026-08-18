import { expect, test } from '@playwright/test';

test('discovers image uploaders once across ordinary DOM and open shadow roots', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });

  const result = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    document.querySelector('#probe-file')?.remove();
    const ordinary = document.createElement('input');
    ordinary.type = 'file';
    ordinary.accept = 'image/png';
    ordinary.id = 'ordinary-image-input';
    document.body.append(ordinary);

    const label = document.createElement('label');
    label.htmlFor = ordinary.id;
    label.textContent = '证件照';
    document.body.append(label);

    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowLabel = document.createElement('label');
    shadowLabel.textContent = '头像照片';
    const shadowInput = document.createElement('input');
    shadowInput.type = 'file';
    shadowLabel.append(shadowInput);
    shadow.append(shadowLabel);
    document.body.append(host);

    const discovered = api.discoverUploaders(document);
    const repeat = api.discoverUploaders(document);

    return {
      count: discovered.length,
      repeatCount: repeat.length,
      labels: discovered.map((item) => item.label).sort(),
      multiple: discovered.map((item) => item.multiple),
      ids: discovered.map((item) => item.uploaderId),
      ordinaryIsImage: api.isImageUploader(ordinary),
      shadowIsImage: api.isImageUploader(shadowInput)
    };
  });

  expect(result.count).toBe(2);
  expect(result.repeatCount).toBe(2);
  expect(result.labels).toEqual(['头像照片', '证件照']);
  expect(result.multiple).toEqual([false, false]);
  expect(result.ids).toHaveLength(2);
  expect(new Set(result.ids).size).toBe(2);
  expect(result.ordinaryIsImage).toBe(true);
  expect(result.shadowIsImage).toBe(true);
});

test('observes added subtrees, debounces SPA route events, and cleans up', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });

  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    document.querySelector('#probe-file')?.remove();
    const callbacks = [];
    const discovery = api.createUploaderDiscovery({
      onDiscover: (context) => callbacks.push(context)
    });
    const initial = discovery.start();

    const wrapper = document.createElement('section');
    const dynamic = document.createElement('input');
    dynamic.type = 'file';
    dynamic.accept = 'image/*';
    wrapper.append(dynamic);
    document.body.append(wrapper);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterDynamic = discovery.getUploaders();

    const duplicateWrapper = document.createElement('section');
    duplicateWrapper.append(dynamic);
    document.body.append(duplicateWrapper);
    await new Promise((resolve) => setTimeout(resolve, 0));

    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new PopStateEvent('popstate'));
    await new Promise((resolve) => setTimeout(resolve, 140));

    const beforeCleanup = {
      active: discovery.active,
      initialCount: initial.length,
      callbackCount: callbacks.length,
      dynamicCount: afterDynamic.length,
      sameDynamicContext: callbacks.filter((item) => item.input === dynamic).length === 1
    };
    discovery.cleanup();

    const afterCleanupInput = document.createElement('input');
    afterCleanupInput.type = 'file';
    afterCleanupInput.accept = 'image/png';
    document.body.append(afterCleanupInput);
    await new Promise((resolve) => setTimeout(resolve, 0));

    return {
      beforeCleanup,
      afterCleanup: {
        active: discovery.active,
        callbackCount: callbacks.length,
        uploaderCount: discovery.getUploaders().length
      }
    };
  });

  expect(result.beforeCleanup).toMatchObject({
    active: true,
    initialCount: 0,
    callbackCount: 1,
    dynamicCount: 1,
    sameDynamicContext: true
  });
  expect(result.afterCleanup).toEqual({
    active: false,
    callbackCount: 1,
    uploaderCount: 0
  });
});

test('discovers an input inside an open shadow root added as a dynamic subtree', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });

  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    document.querySelector('#probe-file')?.remove();
    const callbacks = [];
    const discovery = api.createUploaderDiscovery({
      onDiscover: (context) => callbacks.push(context)
    });
    discovery.start();

    const host = document.createElement('section');
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/webp';
    shadow.append(input);
    document.body.append(host);
    await new Promise((resolve) => setTimeout(resolve, 0));

    return {
      discovered: discovery.getUploaders().some((context) => context.input === input),
      callbackCount: callbacks.filter((context) => context.input === input).length
    };
  });

  expect(result).toEqual({ discovered: true, callbackCount: 1 });
});

test('uses composedPath for an open-shadow event and reports cross-origin frame protection', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });

  const result = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    document.querySelector('#probe-file')?.remove();
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    shadow.append(input);
    document.body.append(host);

    const discovery = api.createUploaderDiscovery();
    discovery.start();
    const event = new Event('change', { bubbles: true, composed: true });
    input.dispatchEvent(event);

    const protectedFrames = [];
    const protectedFrame = {
      nodeType: 1,
      localName: 'iframe',
      matches: () => false,
      querySelectorAll: () => [],
      get contentDocument() {
        throw new DOMException('Blocked by cross-origin policy', 'SecurityError');
      }
    };
    api.discoverUploaders({
      querySelectorAll: () => [protectedFrame]
    }, {
      onProtectedFrame: (detail) => protectedFrames.push(detail)
    });

    return {
      eventInputMatches: api.findFileInputFromEvent({
        target: input,
        composedPath: () => [input, shadow, host, document]
      }) === input,
      discoveredFromEvent: discovery.discoverFromEvent({
        target: input,
        composedPath: () => [input, shadow, host, document]
      })?.input === input,
      protectedFrameCount: protectedFrames.length
    };
  });

  expect(result.eventInputMatches).toBe(true);
  expect(result.discoveredFromEvent).toBe(true);
  expect(result.protectedFrameCount).toBeGreaterThanOrEqual(1);
});
