(function () {
  'use strict';

  const root = document.getElementById('scenario-root');
  const params = new URLSearchParams(window.location.search);
  const scenario = String(params.get('scenario') ?? '').toUpperCase();
  const variant = String(params.get('variant') ?? 'confirm').toLowerCase();

  const SCENARIOS = Object.freeze({
    A: {
      title: '场景 A：预检适配',
      rule: '仅支持 JPG，30–120KB，390×567像素。',
      description: 'input 的 accept 故意只写 image/*；选择不合规图片后，页面不应先收到原始文件的业务上传结果。',
      label: '场景 A 图片',
      accept: 'image/*',
      result: '等待选择文件。'
    },
    B: {
      title: '场景 B：明确拒收后重试',
      rule: '上传证件照。',
      description: '首次页面错误会动态补充明确规则；重试成功后页面接受文件。',
      label: '场景 B 图片',
      accept: 'image/*',
      result: '等待首次选择。'
    },
    C: {
      title: `场景 C：需要裁剪（${variant === 'cancel' ? '取消路径' : '确认路径'}）`,
      rule: '要求 3:4，且输出尺寸为 390×520 像素。',
      description: '选择横向图片后出现固定比例裁剪器；确认会进入本地处理，取消或 Esc 必须保持原文件。',
      label: '场景 C 图片',
      accept: 'image/jpeg,image/png,image/webp',
      result: '等待横图选择。'
    },
    D: {
      title: '场景 D：模糊错误',
      rule: '上传证件照。',
      description: '页面只会显示模糊错误，UploadFit 不应处理、注入或自动重试。',
      label: '场景 D 图片',
      accept: 'image/*',
      result: '等待选择并触发模糊错误。'
    },
    E: {
      title: '场景 E：表单等待提交',
      rule: '仅支持 JPG，30–120KB，390×567像素。',
      description: '处理完成后页面仍等待用户点击“提交测试”；UploadFit 不得代点该业务按钮。',
      label: '场景 E 图片',
      accept: 'image/*',
      result: '等待选择文件。'
    },
    F: {
      title: '场景 F：官方工具要求',
      rule: '必须使用照片审核处理工具。',
      description: '官方工具要求属于安全停止语义，不执行本地处理、不写回、不宣称成功。',
      label: '场景 F 图片',
      accept: 'image/*',
      result: '等待选择并触发安全停止。'
    }
  });

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const describeFile = (file) => file instanceof File
    ? { type: file.type || null, size: file.size }
    : null;

  const pageState = {
    scenario: scenario || null,
    variant,
    events: [],
    businessChangeCount: 0,
    submitClickCount: 0,
    processHintCount: 0,
    rejectionCount: 0,
    lastResult: null,
    dynamicInputCount: 0
  };

  let sequence = 0;
  let input = null;
  let pageError = null;
  let pageResult = null;
  let metricsRoot = null;
  let eventLog = null;

  function currentFile() {
    return input?.files?.[0] ?? null;
  }

  function updateMetrics() {
    if (!metricsRoot) return;
    const values = {
      '事件总数': pageState.events.length,
      'change 次数': pageState.events.filter((event) => event.type === 'change').length,
      '页面业务 change': pageState.businessChangeCount,
      '提交按钮 click': pageState.submitClickCount,
      '当前 MIME': currentFile()?.type || '无',
      '当前字节': currentFile()?.size ?? '无'
    };
    for (const [key, value] of Object.entries(values)) {
      const target = metricsRoot.querySelector(`[data-metric="${key}"]`);
      if (target) target.textContent = String(value);
    }
    if (eventLog) {
      eventLog.textContent = pageState.events.length
        ? JSON.stringify(pageState.events, null, 2)
        : '等待事件……';
    }
  }

  function recordEvent(event, source) {
    pageState.events.push({
      sequence: ++sequence,
      type: event.type,
      source,
      isTrusted: Boolean(event.isTrusted),
      file: describeFile(currentFile())
    });
    updateMetrics();
  }

  function setPageResult(text, tone = null) {
    pageState.lastResult = text;
    if (!pageResult) return;
    pageResult.textContent = text;
    pageResult.dataset.tone = tone ?? '';
  }

  function showRejection(text, tone = 'error') {
    if (!pageError) return;
    pageState.rejectionCount += 1;
    pageError.hidden = false;
    pageError.textContent = text;
    pageError.dataset.tone = tone;
  }

  function onBusinessChange(event) {
    pageState.businessChangeCount += 1;
    if (scenario === 'B') {
      if (pageState.businessChangeCount === 1) {
        showRejection('仅支持JPG且不能超过100KB');
        setPageResult('页面首次拒收：已动态补充明确规则。', 'warn');
      } else {
        setPageResult('页面接受重试结果。', 'ok');
      }
    } else if (scenario === 'D') {
      showRejection('上传失败，请稍后重试');
      setPageResult('页面产生模糊错误，等待 UploadFit 安全停止。', 'warn');
    } else if (scenario === 'F') {
      setPageResult('页面保持原上传流程；官方工具要求由 UploadFit 处理。', 'warn');
    } else if (scenario === 'E') {
      setPageResult('文件事件已到达页面；请测试员自行决定是否点击提交。', 'ok');
    } else {
      setPageResult('页面收到文件事件。', 'ok');
    }
    updateMetrics();
  }

  function appendCommonPanels(definition) {
    const panelGrid = element('div', 'panel-grid');
    const rulePanel = element('section', 'panel');
    rulePanel.append(
      element('h2', null, definition.title),
      element('p', 'rule-copy', definition.rule),
      element('p', 'hint', definition.description)
    );

    const form = element('div', 'upload-form');
    const label = element('label', null, definition.label);
    input = element('input');
    input.type = 'file';
    input.id = 'scenario-file';
    input.accept = definition.accept;
    label.htmlFor = input.id;
    form.append(label, input);

    if (scenario === 'E') {
      const submit = element('button', null, '提交测试');
      submit.id = 'business-submit';
      submit.addEventListener('click', () => {
        pageState.submitClickCount += 1;
        setPageResult('测试员点击了提交按钮。', 'warn');
        updateMetrics();
      });
      form.append(submit);
    }

    pageError = element('div', 'status-box');
    pageError.id = 'page-error';
    pageError.setAttribute('role', 'alert');
    pageError.hidden = true;
    form.append(pageError);

    pageResult = element('div', 'status-box', definition.result);
    pageResult.id = 'page-result';
    form.append(pageResult);
    rulePanel.append(form);

    const metricsPanel = element('section', 'panel');
    metricsPanel.append(element('h2', null, '页面可观察状态'));
    metricsRoot = element('dl', 'metrics');
    for (const key of ['事件总数', 'change 次数', '页面业务 change', '提交按钮 click', '当前 MIME', '当前字节']) {
      const metric = element('div', 'metric');
      metric.append(element('dt', null, key));
      const value = element('dd', null, '0');
      value.dataset.metric = key;
      metric.append(value);
      metricsRoot.append(metric);
    }
    metricsPanel.append(metricsRoot);
    panelGrid.append(rulePanel);
    root.append(panelGrid);

    const logPanel = element('section', 'panel');
    logPanel.append(element('h2', null, '事件和元信息日志'));
    logPanel.append(element('p', 'hint', '仅记录 MIME、字节、isTrusted、事件顺序和计数，不记录图片内容。'));
    eventLog = element('pre', null, '等待事件……');
    eventLog.id = 'event-log';
    eventLog.setAttribute('aria-live', 'polite');
    logPanel.append(eventLog);
    // Keep observation panels outside the uploader's ancestor context. This
    // prevents their MIME/byte labels from becoming fake page rules.
    root.after(metricsPanel, logPanel);
  }

  function renderHome() {
    const panel = element('section', 'panel');
    panel.append(element('h2', null, '选择一个稳定场景'), element('p', 'hint', '每个入口都可从首页一键打开；Playwright 和人工复验均通过真实 input 交互。'));
    const list = element('div', 'scenario-list');
    for (const [key, definition] of Object.entries(SCENARIOS)) {
      const link = element('a');
      link.href = `./index.html?scenario=${key}`;
      link.append(element('strong', null, definition.title), element('br'), element('span', null, definition.rule));
      list.append(link);
    }
    panel.append(list);
    root.append(panel);
  }

  function setupScenario(definition) {
    appendCommonPanels(definition);
    input.addEventListener('input', (event) => recordEvent(event, 'target'));
    input.addEventListener('change', (event) => {
      recordEvent(event, 'target');
      onBusinessChange(event);
    });
    document.addEventListener('input', (event) => {
      if (event.target === input) recordEvent(event, 'document-capture');
    }, true);
    document.addEventListener('change', (event) => {
      if (event.target === input) recordEvent(event, 'document-capture');
    }, true);
    const currentLink = document.querySelector(`[data-scenario-link="${scenario}"]`);
    currentLink?.setAttribute('aria-current', 'page');
  }

  function exposePageApi() {
    window.uploadFitTestPage = Object.freeze({
      getState: () => ({
        ...pageState,
        events: pageState.events.map((event) => ({ ...event, file: event.file ? { ...event.file } : null })),
        currentFile: describeFile(currentFile())
      }),
      reset: () => window.location.reload(),
      getInput: () => input,
      addDynamicInput: () => {
        const extra = document.createElement('input');
        extra.type = 'file';
        extra.accept = 'image/*';
        extra.dataset.dynamic = 'true';
        document.body.append(extra);
        pageState.dynamicInputCount += 1;
        return extra;
      },
      addShadowInput: (mode = 'open') => {
        const host = document.createElement('div');
        const shadow = host.attachShadow({ mode });
        const extra = document.createElement('input');
        extra.type = 'file';
        extra.accept = 'image/*';
        extra.dataset.shadow = mode;
        shadow.append(extra);
        document.body.append(host);
        return { host, input: extra };
      }
    });
  }

  if (SCENARIOS[scenario]) setupScenario(SCENARIOS[scenario]);
  else renderHome();
  exposePageApi();
}());
