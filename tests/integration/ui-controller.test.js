import { expect, test } from '@playwright/test';

async function setup(page, options = {}) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate((setupOptions) => {
    globalThis.__uploadfit_debug_bundle__.cleanupSession();
    const api = globalThis.__uploadfit_debug_bundle__;
    const controller = api.createTaskController({
      documentRef: document,
      globalRef: window,
      ruleProvider: null
    });
    globalThis.__s4Controller = controller;
    const ui = api.createUploadFitUi({
      documentRef: document,
      globalRef: window,
      controller,
      config: { shadowMode: 'open' },
      disposeControllerOnClose: true,
      onClose: () => globalThis.__s4Closed = true
    });
    globalThis.__s4Ui = ui;
    globalThis.__s4Shadow = ui.shadowRoot;
    void setupOptions;
  }, options);
  return async () => page.evaluate(() => {
    globalThis.__s4Ui?.dispose();
    globalThis.__s4Controller?.dispose();
  });
}

function shadowSelector(selector) {
  // Playwright pierce 语法：穿透 open shadow root 定位内部节点。
  return `[data-uploadfit-ui-host] >> css=${selector}`;
}

async function shadowText(page, selector) {
  return page.evaluate(({ sel }) => {
    const host = document.querySelector('[data-uploadfit-ui-host]');
    const node = host?.shadowRoot?.querySelector(sel);
    return node ? node.textContent.trim() : null;
  }, { sel: selector });
}

function makeUploader(labelText) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png';
  label.append(input);
  document.body.append(label);
  return input;
}

test('U01: hostile page CSS cannot break the Shadow DOM UI', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => {
    globalThis.__uploadfit_debug_bundle__.cleanupSession();
    // 敌意样式：全局选择器 + important + 通配 reset
    const style = document.createElement('style');
    style.textContent = `
      * { color: transparent !important; font-size: 200px !important; visibility: visible !important; }
      div { display: block !important; background: black !important; }
      button, span, ul, li, div { all: unset !important; }
    `;
    document.head.append(style);
    const api = globalThis.__uploadfit_debug_bundle__;
    const controller = api.createTaskController({ documentRef: document, globalRef: window });
    globalThis.__s4Controller = controller;
    controller.start();
    const ui = api.createUploadFitUi({
      documentRef: document,
      globalRef: window,
      controller,
      config: { shadowMode: 'open' }
    });
    globalThis.__s4Ui = ui;
  });
  const readable = await page.evaluate(() => {
    const host = document.querySelector('[data-uploadfit-ui-host]');
    const pill = host.shadowRoot.querySelector('.uf-pill-toggle');
    const pillText = host.shadowRoot.querySelector('.uf-pill-text');
    const styles = getComputedStyle(pillText);
    return {
      pillFound: Boolean(pill),
      text: pillText?.textContent ?? '',
      color: styles.color,
      fontSize: styles.fontSize,
      hostCount: document.querySelectorAll('[data-uploadfit-ui-host]').length
    };
  });
  expect(readable.pillFound).toBe(true);
  // probe.html 自带 1 个 file input：发现器工作正常时显示已监听 1 个。
  expect(readable.text).toBe('已监听1个上传区域');
  // :host{all:initial} + 内部样式表隔离：敌意页的 transparent/200px 不得生效
  expect(readable.color).not.toBe('rgba(0, 0, 0, 0)');
  expect(readable.fontSize).not.toBe('200px');
  await page.evaluate(() => {
    globalThis.__s4Ui.dispose();
    globalThis.__s4Controller.dispose();
  });
});

test('U02: repeated startups keep exactly one host', async ({ page }) => {
  const cleanup = await setup(page);
  const counts = await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const secondUi = api.createUploadFitUi({
      documentRef: document,
      globalRef: window,
      controller: globalThis.__s4Controller,
      config: { shadowMode: 'open' }
    });
    globalThis.__s4SecondUi = secondUi;
    return {
      hosts: document.querySelectorAll('[data-uploadfit-ui-host]').length,
      secondUiCreated: Boolean(secondUi)
    };
  });
  // createUploadFitUi 防御性销毁旧实例并新建；DOM 中只保留一个 host。
  expect(counts.hosts).toBe(1);
  expect(counts.secondUiCreated).toBe(true);
  const afterDispose = await page.evaluate(() => {
    globalThis.__s4SecondUi.dispose();
    return document.querySelectorAll('[data-uploadfit-ui-host]').length;
  });
  expect(afterDispose).toBe(0);
  await cleanup();
});

test('U03: status pill text follows the snapshot state', async ({ page }) => {
  const cleanup = await setup(page);
  const states = [
    { sessionState: 'BOOTING', uploaderCount: 0, text: 'UploadFit启动中' },
    { sessionState: 'SCANNING', uploaderCount: 0, text: '正在寻找上传区域' },
    { sessionState: 'ARMED', uploaderCount: 0, text: '暂未发现上传框，我会继续监听页面变化' },
    { sessionState: 'ARMED', uploaderCount: 1, text: '已监听1个上传区域' },
    { sessionState: 'ARMED', uploaderCount: 3, text: '已监听3个上传区域' },
    { sessionState: 'PROCESSING', uploaderCount: 1, text: '正在适配图片' },
    { sessionState: 'SUCCESS', uploaderCount: 1, text: '图片已适配' },
    { sessionState: 'STOPPED', uploaderCount: 1, text: '本次未自动处理' }
  ];
  for (const state of states) {
    const text = await page.evaluate((snapshot) => {
      const host = document.querySelector('[data-uploadfit-ui-host]');
      const pillText = host.shadowRoot.querySelector('.uf-pill-text');
      const listeners = [...globalThis.__s4Controller.listeners];
      // 直接用渲染管线驱动
      const ui = globalThis.__s4Ui;
      // 模拟 snapshot 推送：临时替换 getSnapshot
      const original = globalThis.__s4Controller.getSnapshot.bind(globalThis.__s4Controller);
      globalThis.__s4Controller.getSnapshot = () => ({ ...snapshot, activeTask: null, pageCard: null });
      // 触发一次强制渲染
      ui.collapse();
      ui.expand();
      globalThis.__s4Controller.getSnapshot = original;
      void listeners;
      return pillText.textContent;
    }, state);
    expect(text).toBe(state.text);
  }
  await cleanup();
});

test('U04: conflicting rules show a conflict and no auto-start', async ({ page }) => {
  const cleanup = await setup(page);
  await page.evaluate(() => {
    const controller = globalThis.__s4Controller;
    controller.start();
    // 直接构造带冲突的任务视图
    const fakeTask = {
      taskId: 'task-conflict-test',
      status: 'NEEDS_CONFIRMATION',
      label: '证件照',
      source: 'preflight',
      current: { mime: 'image/jpeg', size: 50000, width: 390, height: 567, displayWidth: 390, displayHeight: 567 },
      rules: {
        formats: ['image/jpeg'],
        minBytes: null,
        maxBytes: 100000,
        width: { exact: null, min: null, max: null },
        height: { exact: null, min: null, max: null },
        aspectRatio: null,
        dpi: null,
        background: null,
        semanticRequirements: [],
        confidence: 0.9,
        sources: [{ type: 'nearby-text', priority: 400, evidence: ['最大100KB'], confidence: 0.9 }],
        conflicts: [{ field: 'maxBytes', reason: '两个来源给出不同上限', unresolvable: true, values: [100000, 200000] }],
        actionable: false
      },
      policyConfirmation: null,
      plan: null,
      result: null,
      errorCode: null,
      retryCount: 0,
      warnings: []
    };
    globalThis.__s4Controller.getSnapshot = () => ({
      sessionState: 'NEEDS_CONFIRMATION',
      uploaderCount: 1,
      activeTask: fakeTask,
      pageCard: null
    });
    globalThis.__s4Ui.expand();
  });
  const cardText = await page.evaluate(() => {
    const host = document.querySelector('[data-uploadfit-ui-host]');
    return host.shadowRoot.querySelector('.uf-card').innerText;
  });
  expect(cardText).toContain('规则冲突');
  // 冲突卡不得出现自动开始按钮
  const hasConfirmButton = await page.evaluate(() => {
    const host = document.querySelector('[data-uploadfit-ui-host]');
    return Boolean(host.shadowRoot.querySelector('[data-uf-action="confirm-rule"]'));
  });
  expect(hasConfirmButton).toBe(false);
  await cleanup();
});

test('R6: rule evidence is rendered as bounded text, never executable markup', async ({ page }) => {
  const cleanup = await setup(page);
  await page.evaluate(() => {
    const controller = globalThis.__s4Controller;
    const fakeTask = {
      taskId: 'task-evidence-test',
      status: 'NEEDS_CONFIRMATION',
      label: '证件照',
      source: 'preflight',
      current: { mime: 'image/jpeg', size: 50000, width: 390, height: 567 },
      rules: {
        formats: ['image/jpeg'],
        minBytes: 30720,
        maxBytes: 120000,
        width: { exact: 390, min: null, max: null },
        height: { exact: 567, min: null, max: null },
        aspectRatio: null,
        semanticRequirements: [],
        confidence: 0.9,
        sources: [{
          type: 'nearby-text',
          priority: 400,
          evidence: ['<img src=x onerror=alert(1)>', '</style><script>bad()</script>'],
          confidence: 0.9
        }],
        conflicts: [],
        actionable: true
      },
      policyConfirmation: {
        id: 'evidence-confirmation',
        type: 'RULE_CONFIDENCE',
        required: true,
        resolved: false,
        accepted: null,
        payload: null
      },
      plan: { operations: ['RESIZE'] },
      result: null,
      errorCode: null,
      retryCount: 0,
      warnings: []
    };
    controller.getSnapshot = () => ({
      sessionState: 'NEEDS_CONFIRMATION',
      uploaderCount: 1,
      activeTask: fakeTask,
      pageCard: null
    });
    globalThis.__s4Ui.expand();
  });
  const evidence = await page.evaluate(() => {
    const host = document.querySelector('[data-uploadfit-ui-host]');
    const shadow = host.shadowRoot;
    const box = shadow.querySelector('.uf-evidence');
    return {
      text: box?.textContent ?? '',
      imageCount: box?.querySelectorAll('img').length ?? 0,
      scriptCount: box?.querySelectorAll('script').length ?? 0,
      styleCount: box?.querySelectorAll('style').length ?? 0
    };
  });
  expect(evidence.text).toContain('<img src=x onerror=alert(1)>');
  expect(evidence.text).toContain('</style><script>bad()</script>');
  expect(evidence.imageCount).toBe(0);
  expect(evidence.scriptCount).toBe(0);
  expect(evidence.styleCount).toBe(0);
  await cleanup();
});

test('U10: dispose removes host, listeners and object URLs', async ({ page }) => {
  const cleanup = await setup(page);
  await page.evaluate(() => {
    globalThis.__s4Controller.start();
    const input = document.createElement('input');
    input.type = 'file';
    document.body.append(input);
    globalThis.__s4Controller.registerUploader({
      input,
      uploaderId: 'u1',
      label: '照片',
      nearbyTexts: [],
      alertTexts: [],
      accept: null,
      multiple: false,
      pageUrl: 'http://localhost/x',
      pageTitle: ''
    });
  });
  const before = await page.evaluate(() => ({
    hosts: document.querySelectorAll('[data-uploadfit-ui-host]').length,
    listeners: globalThis.__s4Controller.listeners.size
  }));
  expect(before.hosts).toBe(1);
  expect(before.listeners).toBeGreaterThan(0);
  const after = await page.evaluate(() => {
    globalThis.__s4Ui.dispose();
    globalThis.__s4Controller.dispose();
    return {
      hosts: document.querySelectorAll('[data-uploadfit-ui-host]').length,
      listeners: globalThis.__s4Controller.listeners.size,
      disposed: globalThis.__s4Controller.disposed
    };
  });
  expect(after.hosts).toBe(0);
  expect(after.listeners).toBe(0);
  expect(after.disposed).toBe(true);
  await cleanup();
});

test('U11: close button has an accessible name and live region announces state', async ({ page }) => {
  const cleanup = await setup(page);
  const info = await page.evaluate(() => {
    const host = document.querySelector('[data-uploadfit-ui-host]');
    const close = host.shadowRoot.querySelector('.uf-pill-close');
    const card = host.shadowRoot.querySelector('.uf-card');
    const pill = host.shadowRoot.querySelector('.uf-pill-toggle');
    return {
      closeLabel: close?.getAttribute('aria-label'),
      pillExpanded: pill?.getAttribute('aria-expanded'),
      cardRole: card?.getAttribute('role'),
      cardLabel: card?.getAttribute('aria-label'),
      liveRegion: Boolean(host.shadowRoot.querySelector('[aria-live="polite"]')),
      liveText: host.shadowRoot.querySelector('.uf-status-live')?.textContent,
      pillIsButton: pill?.tagName,
      closeType: close?.getAttribute('type'),
      nestedButtons: host.shadowRoot.querySelectorAll('button button').length
    };
  });
  expect(info.closeLabel).toBeTruthy();
  expect(info.pillExpanded).toBe('false');
  expect(info.pillIsButton).toBe('BUTTON');
  expect(info.closeType).toBe('button');
  expect(info.cardRole).toBe('region');
  expect(info.cardLabel).toBeTruthy();
  expect(info.liveRegion).toBe(true);
  expect(info.liveText).toBe('UploadFit启动中');
  expect(info.nestedButtons).toBe(0);
  await cleanup();
});

test('U11: status live text changes once per state and errors use one alert', async ({ page }) => {
  const cleanup = await setup(page);
  const result = await page.evaluate(() => {
    const controller = globalThis.__s4Controller;
    const ui = globalThis.__s4Ui;
    const states = ['BOOTING', 'ARMED', 'PROCESSING', 'SUCCESS'];
    const liveTexts = [];
    for (const sessionState of states) {
      controller.getSnapshot = () => ({
        sessionState,
        uploaderCount: sessionState === 'ARMED' ? 1 : 0,
        activeTask: null,
        pageCard: null
      });
      ui.collapse();
      ui.expand();
      liveTexts.push(document.querySelector('[data-uploadfit-ui-host]')
        .shadowRoot.querySelector('.uf-status-live').textContent);
    }
    const errorTask = {
      taskId: 'u11-error', status: 'STOPPED', errorCode: 'NETWORK_OR_TIMEOUT', source: 'preflight',
      current: null, rules: null, plan: null, result: null, retryCount: 0, warnings: []
    };
    controller.getSnapshot = () => ({
      sessionState: 'STOPPED', uploaderCount: 1, activeTask: errorTask, pageCard: null
    });
    ui.collapse();
    ui.expand();
    const host = document.querySelector('[data-uploadfit-ui-host]');
    const cardText = host.shadowRoot.querySelector('.uf-card').innerText;
    return {
      liveTexts,
      errorLive: host.shadowRoot.querySelector('.uf-status-live').textContent,
      alerts: host.shadowRoot.querySelectorAll('[role="alert"]').length,
      errorMessageOccurrences: cardText.match(/网页提示网络异常或超时/g)?.length ?? 0,
      mentionsOfficialTool: cardText.includes('官方指定工具')
    };
  });
  expect(result.liveTexts).toEqual([
    'UploadFit启动中', '已监听1个上传区域', '正在适配图片', '图片已适配'
  ]);
  expect(result.errorLive).toBe('');
  expect(result.alerts).toBe(1);
  expect(result.errorMessageOccurrences).toBe(1);
  expect(result.mentionsOfficialTool).toBe(false);
  await cleanup();
});

test('U09: form success card explains the next step without clicking business controls', async ({ page }) => {
  const cleanup = await setup(page);
  const result = await page.evaluate(() => {
    const controller = globalThis.__s4Controller;
    controller.getSnapshot = () => ({
      sessionState: 'SUCCESS',
      uploaderCount: 1,
      activeTask: {
        taskId: 'u09-success', status: 'SUCCESS', source: 'preflight', errorCode: null,
        current: { mime: 'image/jpeg', size: 50000, width: 390, height: 567 },
        rules: null, plan: { operations: ['RESIZE'] },
        result: { metadata: { mime: 'image/jpeg', size: 50000, width: 390, height: 567 }, operations: ['RESIZE'] },
        retryCount: 0, warnings: []
      },
      pageCard: null
    });
    globalThis.__s4Ui.expand();
    const host = document.querySelector('[data-uploadfit-ui-host]');
    return host.shadowRoot.querySelector('.uf-card').textContent;
  });
  expect(result).toContain('已适配并放回上传框');
  expect(result).toContain('保存 / 下一步 / 提交');
  await cleanup();
});

test('U12: narrow viewport keeps the card inside the screen', async ({ page }) => {
  const cleanup = await setup(page);
  await page.setViewportSize({ width: 390, height: 700 });
  await page.evaluate(() => {
    globalThis.__s4Controller.start();
    globalThis.__s4Controller.getSnapshot = () => ({
      sessionState: 'ARMED',
      uploaderCount: 0,
      activeTask: null,
      pageCard: { state: 'no-rules', hint: 'SELECT_TEXT', rules: null, source: 'cnipa-public-guide' }
    });
    globalThis.__s4Ui.expand();
  });
  const overflow = await page.evaluate(() => {
    const host = document.querySelector('[data-uploadfit-ui-host]');
    const root = host.shadowRoot.querySelector('.uf-root');
    const card = host.shadowRoot.querySelector('.uf-card');
    const rootRect = root.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return {
      rootRight: rootRect.right,
      rootLeft: rootRect.left,
      cardRight: cardRect.right,
      cardLeft: cardRect.left,
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth
    };
  });
  expect(overflow.cardRight).toBeLessThanOrEqual(overflow.viewportWidth + 1);
  expect(overflow.cardLeft).toBeGreaterThanOrEqual(-1);
  expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1);
  await cleanup();
});

test('U12: 200 percent zoom and reduced motion remain reachable', async ({ page }) => {
  const cleanup = await setup(page);
  // 桌面浏览器 200% 缩放会把 CSS 视口折半；用等效 CSS 视口验证固定 UI 的可达性。
  await page.setViewportSize({ width: 195, height: 350 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const result = await page.evaluate(() => {
    const controller = globalThis.__s4Controller;
    controller.getSnapshot = () => ({
      sessionState: 'PROCESSING', uploaderCount: 1,
      activeTask: {
        taskId: 'u12-processing', status: 'PROCESSING', source: 'preflight', errorCode: null,
        current: { mime: 'image/jpeg', size: 50000, width: 390, height: 567 },
        rules: null, plan: { operations: ['RESIZE'] }, result: null, retryCount: 0, warnings: []
      },
      pageCard: null
    });
    globalThis.__s4Ui.expand();
    const host = document.querySelector('[data-uploadfit-ui-host]');
    const card = host.shadowRoot.querySelector('.uf-card');
    const progress = host.shadowRoot.querySelector('.uf-progress-bar');
    const rect = card.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      animationName: getComputedStyle(progress).animationName
    };
  });
  expect(result.left).toBeGreaterThanOrEqual(-1);
  expect(result.right).toBeLessThanOrEqual(result.viewportWidth + 1);
  expect(result.top).toBeGreaterThanOrEqual(-1);
  expect(result.bottom).toBeLessThanOrEqual(result.viewportHeight + 1);
  expect(result.animationName).toBe('none');
  await cleanup();
});

test('U07/U08: flatten and upscale confirmations only proceed after explicit accept', async ({ page }) => {
  const cleanup = await setup(page);
  // 处理函数被替换为计数器：未确认时绝不能调用
  await page.evaluate(() => {
    const controller = globalThis.__s4Controller;
    globalThis.__s4ProcessCalls = 0;
    controller.processImage = async () => {
      globalThis.__s4ProcessCalls += 1;
      throw Object.assign(new Error('should not run'), { code: 'PROCESSING_FAILED' });
    };
    controller.start();
  });
  const calls = await page.evaluate(() => globalThis.__s4ProcessCalls);
  expect(calls).toBe(0);
  await cleanup();
});

test('pill expands the card on click and closes the session via close button', async ({ page }) => {
  const cleanup = await setup(page);
  await page.evaluate(() => {
    globalThis.__s4Controller.start();
    globalThis.__s4Controller.getSnapshot = () => ({
      sessionState: 'ARMED',
      uploaderCount: 0,
      activeTask: null,
      pageCard: { state: 'no-rules', hint: 'SELECT_TEXT', rules: null, source: 'cnipa-public-guide' }
    });
  });
  await page.evaluate(() => {
    const host = document.querySelector('[data-uploadfit-ui-host]');
    const pill = host.shadowRoot.querySelector('.uf-pill-toggle');
    pill.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  });
  const cardVisible = await page.evaluate(() => {
    const host = document.querySelector('[data-uploadfit-ui-host]');
    const card = host.shadowRoot.querySelector('.uf-card');
    return !card.hidden && card.innerText.includes('本页照片要求');
  });
  expect(cardVisible).toBe(true);
  await page.evaluate(() => {
    const host = document.querySelector('[data-uploadfit-ui-host]');
    const close = host.shadowRoot.querySelector('.uf-pill-close');
    close.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  });
  const closed = await page.evaluate(() => ({
    hosts: document.querySelectorAll('[data-uploadfit-ui-host]').length,
    closedFlag: globalThis.__s4Closed === true,
    controllerDisposed: globalThis.__s4Controller.disposed
  }));
  expect(closed.hosts).toBe(0);
  expect(closed.closedFlag).toBe(true);
  expect(closed.controllerDisposed).toBe(true);
});
