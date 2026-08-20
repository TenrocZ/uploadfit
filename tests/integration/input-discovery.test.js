import { expect, test } from '@playwright/test';

test('discovers image uploaders once across ordinary DOM and open shadow roots', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });

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
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });

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
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });

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
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });

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

test('upgrades a bare file input only through a verified image MIME', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });

  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    document.querySelector('#probe-file')?.remove();
    const callbacks = [];
    const discovery = api.createUploaderDiscovery({
      onDiscover: (context) => callbacks.push(context)
    });
    discovery.start();
    const bare = document.createElement('input');
    bare.type = 'file';
    document.body.append(bare);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const initialCount = discovery.getUploaders().length;
    const pdf = discovery.upgradeFromMime(bare, 'application/pdf');
    const upgraded = discovery.upgradeFromMime(bare, 'image/png');
    const repeated = discovery.upgradeFromMime(bare, 'image/jpeg');
    const detached = document.createElement('input');
    detached.type = 'file';
    const detachedUpgrade = discovery.upgradeFromMime(detached, 'image/png');
    const beforeCleanup = {
      initialCount,
      pdf: pdf === null,
      upgraded: upgraded?.input === bare,
      repeated: repeated?.input === bare,
      callbackCount: callbacks.filter((context) => context.input === bare).length
    };
    discovery.cleanup();
    return {
      beforeCleanup,
      detached: detachedUpgrade === null,
      afterCleanup: discovery.upgradeFromMime(bare, 'image/webp') === null
    };
  });

  expect(result).toEqual({
    beforeCleanup: {
      initialCount: 0,
      pdf: true,
      upgraded: true,
      repeated: true,
      callbackCount: 1
    },
    detached: true,
    afterCleanup: true
  });
});

test('discovers a late-created open shadow input on its first composed event', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });

  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    document.querySelector('#probe-file')?.remove();
    const callbacks = [];
    const discovery = api.createUploaderDiscovery({
      onDiscover: (context) => callbacks.push(context)
    });
    discovery.start();
    const host = document.createElement('section');
    document.body.append(host);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg';
    shadow.append(input);
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    discovery.cleanup();
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return {
      discovered: discovery.getUploaders().length,
      callbackCount: callbacks.filter((context) => context.input === input).length
    };
  });

  expect(result).toEqual({ discovered: 0, callbackCount: 1 });
});

test('discovers an already-loaded same-origin srcdoc iframe', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });

  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    document.querySelector('#probe-file')?.remove();
    const frame = document.createElement('iframe');
    frame.srcdoc = '<label>iframe image</label><input type="file" accept="image/png">';
    document.body.append(frame);
    await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    const discovery = api.createUploaderDiscovery();
    const initial = discovery.start();
    discovery.cleanup();
    return initial.some((context) => context.input.ownerDocument === frame.contentDocument);
  });

  expect(result).toBe(true);
});

test('tracks dynamic same-origin iframe loads without stale observers or duplicate callbacks', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });

  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    document.querySelector('#probe-file')?.remove();
    const callbacks = [];
    const discovery = api.createUploaderDiscovery({
      onDiscover: (context) => callbacks.push(context)
    });
    discovery.start();
    const frame = document.createElement('iframe');
    const load = (html) => new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      frame.srcdoc = html;
    });
    document.body.append(frame);
    await load('<input id="first" type="file" accept="image/png">');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await load('<input id="second" type="file" accept="image/jpeg">');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const beforeCleanup = {
      callbacks: callbacks.length,
      currentDocuments: new Set(discovery.getUploaders().map((context) => context.input.ownerDocument)).size,
      currentId: discovery.getUploaders()[0]?.input.id ?? null
    };
    discovery.cleanup();
    frame.srcdoc = '<input id="third" type="file" accept="image/webp">';
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { beforeCleanup, afterCleanupCallbacks: callbacks.length };
  });

  expect(result).toEqual({
    beforeCleanup: { callbacks: 2, currentDocuments: 1, currentId: 'second' },
    afterCleanupCallbacks: 2
  });
});

test('unregisters a detached uploader after a complete mutation batch', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });

  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    document.querySelector('#probe-file')?.remove();
    const removed = [];
    const wrapper = document.createElement('section');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png';
    wrapper.append(input);
    document.body.append(wrapper);
    const discovery = api.createUploaderDiscovery({
      onRemove: (context, detail) => removed.push({
        sameInput: context.input === input,
        reason: detail.reason
      })
    });
    discovery.start();
    const before = discovery.getUploaders().length;
    wrapper.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = discovery.getUploaders().length;
    discovery.cleanup();
    return { before, after, removed };
  });

  expect(result).toEqual({
    before: 1,
    after: 0,
    removed: [{ sameInput: true, reason: 'INPUT_REMOVED' }]
  });
});
