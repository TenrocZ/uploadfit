(() => {
  const params = new URLSearchParams(location.search);
  const scenario = String(params.get('scenario') ?? 'A').toUpperCase();
  const root = document.getElementById('audio-s3-root');
  const configs = {
    A: {
      title: '合规 MP3 原文件直通',
      rule: '音频上传仅支持 MP3，文件最大 250KB。合规 MP3 原文件直接上传。',
      accept: 'audio/mpeg',
      hint: '在本页点击“生成本页合规 MP3”或选择本地 MP3；预期 PASSTHROUGH，原文件不被替换。'
    },
    B: {
      title: 'PCM WAV 转 MP3',
      rule: '音频上传仅支持 MP3，文件最大 250KB。WAV 需要转换为 MP3。',
      accept: 'audio/mpeg',
      wavSeconds: 4,
      hint: '推荐生成 4 秒 PCM 16-bit mono WAV（源文件超过 250KB），确认后应只处理一次并回填 audio/mpeg。'
    },
    C: {
      title: 'M4A/AAC 与超限 MP3 安全停止',
      rule: '音频上传仅支持 MP3，文件最大 250KB。超限 MP3 不可转码。',
      accept: 'audio/mpeg',
      hint: '在本页生成超限 MP3，或选择/生成有效 M4A/AAC-LC fixture；两者都应 AUDIO_CODEC_UNSUPPORTED，Worker/process=0。'
    },
    D: {
      title: '无 maxBytes 规则安全停止',
      rule: '音频上传仅支持 MP3，文件无大小上限。没有 maxBytes 时不能安全处理。',
      accept: 'audio/mpeg',
      hint: '生成 WAV 或选择 MP3；预期规则不足并停止，Worker/process=0。M4A/AAC 拒收请用 C 场景实机文件。'
    },
    E: {
      title: '目标格式不允许安全停止',
      rule: '音频上传仅支持 WAV，文件最大 250KB；页面不允许输出 MP3。',
      accept: 'audio/wav',
      hint: '生成 WAV；预期 AUDIO_OUTPUT_FORMAT_NOT_ALLOWED、Worker/process=0。确认拒绝请在 B 场景确认卡中选择取消。'
    },
    F: {
      title: '时长边界安全停止',
      rule: '音频上传仅支持 MP3，音频时长不超过 1 秒；系统不裁剪、不拆分音频。',
      accept: 'audio/mpeg',
      hint: '生成 1.5 秒 PCM WAV；预期 AUDIO_DURATION_LIMIT_UNFIXABLE、process=0。'
    },
    G: {
      title: '取消、脱离与迟到消息隔离',
      rule: '音频上传仅支持 MP3，文件最大 250KB。WAV 需要转换为 MP3。',
      accept: 'audio/mpeg',
      wavSeconds: 18,
      longWavSeconds: 18,
      hint: '生成 18 秒 PCM WAV，看到 PROCESSING 后立即取消或移除输入；预期 1 秒内 STOPPED、原 File 保留且无迟到注入。'
    },
    H: {
      title: '关联拒收最多一次重试',
      rule: '音频上传仅支持 MP3，文件最大 500KB。WAV 需要转换为 MP3。',
      accept: 'audio/mpeg',
      wavSeconds: 12,
      longWavSeconds: 12,
      hint: '本页生成 12 秒 PCM WAV；初始 500KB 计划成功后自动关联拒收 250KB，预期严格收紧后只重试一次且 submit click=0。',
      autoReject: true
    }
  };
  const config = configs[scenario] ?? configs.A;

  function node(tag, attributes = {}, text = '') {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (value === null || value === undefined) continue;
      if (key === 'textContent') element.textContent = value;
      else element.setAttribute(key, value);
    }
    if (text) element.textContent = text;
    return element;
  }

  const article = node('article', { class: 'scenario' });
  const heading = node('div', { class: 'scenario-header' });
  heading.append(node('span', { class: 'badge' }, `S3-${scenario}`));
  heading.append(node('h2', {}, config.title));
  article.append(heading);
  article.append(node('p', { class: 'constraint', id: 'audio-s3-constraint' }, config.rule));
  article.append(node('p', { class: 'hint' }, config.hint));

  const form = node('form', { class: 'upload-shell', novalidate: 'novalidate' });
  const label = node('label', { for: 'audio-s3-file' }, '选择音频文件');
  const input = node('input', {
    id: 'audio-s3-file',
    type: 'file',
    accept: config.accept,
    'aria-describedby': 'audio-s3-constraint',
    'aria-label': '音频上传测试输入'
  });
  const error = node('p', { id: 'audio-s3-error', class: 'error', role: 'alert', 'aria-live': 'polite' });
  form.append(label, input, error);
  article.append(form);

  const controls = node('div', { class: 'controls' });
  const addControl = (id, text) => {
    // input[type=button] keeps the scenario controls out of the controller's
    // business-click accounting.  The page has no submit control at all.
    const button = node('input', { id, type: 'button', value: text, 'aria-label': text });
    controls.append(button);
    return button;
  };
  const wavButton = addControl('audio-s3-generate-wav', `生成 ${config.wavSeconds ?? 0.5} 秒 PCM WAV`);
  const longWavButton = addControl('audio-s3-generate-long-wav', `生成 ${config.longWavSeconds ?? 1.5} 秒 PCM WAV`);
  const reuseButton = addControl(
    'audio-s3-reuse-mp3',
    scenario === 'A' ? '生成本页合规 MP3' : '复用当前页最近 MP3'
  );
  const largeButton = addControl('audio-s3-large-mp3', '生成超限 MP3');
  const m4aButton = addControl('audio-s3-generate-m4a', '生成本页 M4A/AAC-LC fixture');
  const declineButton = addControl('audio-s3-decline', '拒绝当前确认');
  const cancelButton = addControl('audio-s3-cancel', '取消当前任务');
  const detachButton = addControl('audio-s3-detach', '移除输入（脱离）');
  const resetButton = addControl('audio-s3-reset', '重新挂载输入');
  article.append(controls);

  const autoRejectLabel = node('label', { class: 'checkbox-label' });
  const autoReject = node('input', { id: 'audio-s3-auto-reject', type: 'checkbox' });
  autoReject.checked = Boolean(config.autoReject);
  autoRejectLabel.append(autoReject, ' 成功后自动产生一次关联拒收');
  article.append(autoRejectLabel);

  const status = node('p', { id: 'audio-s3-status', class: 'status', role: 'status', 'aria-live': 'polite' }, '等待 UploadFit 会话…');
  article.append(status);
  const grid = node('div', { class: 'grid' });
  const snapshotPanel = node('section', { class: 'panel' });
  snapshotPanel.append(node('h3', {}, '安全快照（不含文件名）'));
  const snapshotOutput = node('pre', { id: 'audio-s3-snapshot', 'aria-live': 'polite' }, '等待快照…');
  snapshotPanel.append(snapshotOutput);
  const eventPanel = node('section', { class: 'panel' });
  eventPanel.append(node('h3', {}, '页面事件摘要'));
  const eventOutput = node('pre', { id: 'audio-s3-events', 'aria-live': 'polite' }, '等待事件…');
  eventPanel.append(eventOutput);
  grid.append(snapshotPanel, eventPanel);
  article.append(grid);
  root.replaceChildren(article);

  for (const link of document.querySelectorAll('[data-scenario-link]')) {
    if (link.getAttribute('data-scenario-link') === scenario) link.setAttribute('aria-current', 'page');
  }

  const state = {
    input,
    form,
    detached: false,
    lastMp3: null,
    events: [],
    lastStatus: null,
    observedTaskId: null,
    observedTaskStatus: null,
    processingStarts: 0,
    injectionStarts: 0,
    retryDispatches: 0,
    submitClicks: 0,
    autoRejected: false,
    controller: null,
    unsubscribe: null
  };
  window.__uploadfitAudioS3 = state;

  function safeFileSummary(file) {
    if (!file) return null;
    return { type: file.type || null, bytes: file.size };
  }

  function recordEvent(event) {
    state.events.push({
      type: event.type,
      target: event.target?.id ?? 'unknown',
      isTrusted: event.isTrusted === true
    });
    state.events = state.events.slice(-12);
    renderEventSummary();
  }
  document.addEventListener('change', recordEvent, true);
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('button[type="submit"], input[type="submit"]')) {
      state.submitClicks += 1;
    }
    renderEventSummary();
  }, true);
  document.addEventListener('submit', (event) => {
    recordEvent(event);
    event.preventDefault();
  }, true);

  function transferFile(file) {
    if (!file || !state.input?.isConnected) return false;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    state.input.files = transfer.files;
    state.input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return true;
  }

  function createWav(seconds) {
    const sampleRate = 44100;
    const channels = 1;
    const bits = 16;
    const frames = Math.max(1, Math.round(sampleRate * seconds));
    const dataBytes = frames * channels * bits / 8;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const ascii = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    ascii(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bits / 8, true);
    view.setUint16(32, channels * bits / 8, true); view.setUint16(34, bits, true);
    ascii(36, 'data'); view.setUint32(40, dataBytes, true);
    return new File([buffer], `s3-${seconds}-second.wav`, { type: 'audio/wav' });
  }

  function concatBytes(...parts) {
    const bytes = new Uint8Array(parts.reduce((sum, item) => sum + item.length, 0));
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return bytes;
  }

  // Minimal MPEG-1 Layer III frames are enough for the production metadata
  // reader.  C uses a fresh fixture on this page, so it never depends on a
  // File produced on another query page.
  function createMp3File(frames = 200, bitrateIndex = 9) {
    const bitrate = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bitrateIndex] ?? 128;
    const frameLength = Math.floor(144 * bitrate * 1000 / 44100);
    const frame = new Uint8Array(frameLength);
    frame.set([0xff, 0xfb, bitrateIndex << 4, 0x00]);
    return new File([concatBytes(...Array.from({ length: frames }, () => frame))], 's3-local.mp3', {
      type: 'audio/mpeg'
    });
  }

  // This is the same small ISO-BMFF/AAC-LC metadata fixture used by the
  // signature unit tests, kept inline so the production page has no test
  // module or network dependency.
  function createM4aFixture() {
    const text = (value) => new Uint8Array([...value].map((char) => char.charCodeAt(0)));
    const box = (type, payload) => {
      const bytes = new Uint8Array(8 + payload.length);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, bytes.length, false);
      bytes.set(text(type), 4);
      bytes.set(payload, 8);
      return bytes;
    };
    const mdhdPayload = new Uint8Array(24);
    const mdhdView = new DataView(mdhdPayload.buffer);
    mdhdView.setUint32(12, 1000, false);
    mdhdView.setUint32(16, 2000, false);
    const frequencyIndex = 4; // 44.1 kHz in the AAC sample-rate table
    const audioSpecificConfig = new Uint8Array([
      (2 << 3) | (frequencyIndex >> 1),
      ((frequencyIndex & 1) << 7) | (2 << 3)
    ]);
    const esdsPayload = new Uint8Array([
      0, 0, 0, 0,
      0x03, 0x10, 0, 0, 0, 0,
      0x04, 0x08, 0, 0, 0, 0,
      0x05, 0x02, audioSpecificConfig[0], audioSpecificConfig[1]
    ]);
    const samplePayload = new Uint8Array(28);
    const sampleView = new DataView(samplePayload.buffer);
    sampleView.setUint16(16, 2, false);
    sampleView.setUint16(18, 16, false);
    sampleView.setUint32(24, 44100 << 16, false);
    const sampleEntry = box('mp4a', concatBytes(samplePayload, box('esds', esdsPayload)));
    const stsdPayload = new Uint8Array(8 + sampleEntry.length);
    new DataView(stsdPayload.buffer).setUint32(4, 1, false);
    stsdPayload.set(sampleEntry, 8);
    const stbl = box('stbl', box('stsd', stsdPayload));
    const moov = box('moov', box('trak', box('mdia', concatBytes(
      box('mdhd', mdhdPayload),
      box('minf', stbl)
    ))));
    const ftyp = box('ftyp', concatBytes(text('M4A '), new Uint8Array([0, 0, 0, 0]), text('M4A ')));
    return new File([concatBytes(ftyp, moov)], 's3-aac-lc-fixture.m4a', { type: 'audio/mp4' });
  }

  function renderEventSummary() {
    const tasks = state.controller?.tasks instanceof Map
      ? [...state.controller.tasks.values()]
      : [];
    const controllerBusinessClicks = tasks.reduce(
      (sum, task) => sum + (Number.isFinite(task.businessClickCount) ? task.businessClickCount : 0),
      0
    );
    eventOutput.textContent = JSON.stringify({
      summary: {
        processingStarts: state.processingStarts,
        injectionStarts: state.injectionStarts,
        retryDispatches: state.retryDispatches,
        businessSubmitClicks: state.submitClicks,
        controllerBusinessClickCount: controllerBusinessClicks
      },
      events: state.events
    }, null, 2);
  }

  function setStatus(text) { status.textContent = text; }

  function refresh(snapshot) {
    if (!snapshot) return;
    const task = snapshot.activeTask;
    const safe = {
      sessionState: snapshot.sessionState,
      uploaderCount: snapshot.uploaderCount,
      task: task ? {
        status: task.status,
        mediaKind: task.mediaKind,
        current: task.current,
        plan: task.plan,
        result: task.result,
        errorCode: task.errorCode,
        retryCount: task.retryCount,
        progress: task.progress
    } : null
    };
    snapshotOutput.textContent = JSON.stringify(safe, null, 2);
    if (!task) {
      renderEventSummary();
      return;
    }
    if (state.observedTaskId !== task.taskId) {
      state.observedTaskId = task.taskId;
      state.observedTaskStatus = null;
    }
    if (task.status !== state.observedTaskStatus) {
      if (task.status === 'PROCESSING') state.processingStarts += 1;
      if (task.status === 'INJECTING') state.injectionStarts += 1;
      if (task.status === 'RETRYING') state.retryDispatches += 1;
      state.observedTaskStatus = task.status;
    }
    renderEventSummary();
    const summary = task.errorCode
      ? `${task.status} / ${task.errorCode}`
      : `${task.status}${task.progress?.ratio !== null && task.progress?.ratio !== undefined ? ` / ${Math.round(task.progress.ratio * 100)}%` : ''}`;
    if (summary !== state.lastStatus) {
      state.lastStatus = summary;
      setStatus(summary);
    }
    if (task.status === 'SUCCESS' && task.result?.metadata?.mime === 'audio/mpeg') {
      state.lastMp3 = state.input?.files?.[0] ?? state.lastMp3;
      if (config.autoReject && !state.autoRejected) {
        state.autoRejected = true;
        window.setTimeout(() => {
          error.textContent = '格式不符合：仅支持 MP3，最大 250KB';
        }, 30);
      }
    }
  }

  function controllerReady() {
    const session = window.__uploadfit_session__;
    if (!session?.controller) return false;
    if (state.controller === session.controller) return true;
    state.controller = session.controller;
    state.unsubscribe = state.controller.subscribe(refresh);
    refresh(state.controller.getSnapshot());
    setStatus('UploadFit 已就绪，等待选择文件');
    return true;
  }

  const readyTimer = window.setInterval(() => {
    if (controllerReady()) window.clearInterval(readyTimer);
  }, 10);

  wavButton.addEventListener('click', () => transferFile(createWav(config.wavSeconds ?? 0.5)));
  longWavButton.addEventListener('click', () => transferFile(createWav(config.longWavSeconds ?? 1.5)));
  reuseButton.addEventListener('click', () => {
    if (state.lastMp3) {
      transferFile(state.lastMp3);
      return;
    }
    if (scenario === 'A') {
      transferFile(createMp3File(200));
      return;
    }
    setStatus('当前页尚无最近 MP3：先在本页生成或选择 MP3');
  });
  largeButton.addEventListener('click', () => {
    transferFile(createMp3File(300, 14));
  });
  m4aButton.addEventListener('click', () => transferFile(createM4aFixture()));
  declineButton.addEventListener('click', () => {
    const task = state.controller?.getSnapshot?.().activeTask;
    const pending = task?.plan?.confirmations?.find((item) => item.required && !item.resolved);
    if (!task || !pending) {
      setStatus('当前没有待确认的音频任务');
      return;
    }
    void state.controller.confirmTask(task.taskId, {
      id: pending.id,
      type: pending.type,
      accepted: false,
      payload: pending.suggestedPayload
    });
  });
  cancelButton.addEventListener('click', () => {
    const task = state.controller?.getSnapshot?.().activeTask;
    if (task) state.controller.cancelTask(task.taskId);
  });
  detachButton.addEventListener('click', () => {
    if (!state.input?.isConnected) return;
    state.input.remove();
    state.detached = true;
    setStatus('输入已移除，迟到消息不得注入');
  });
  resetButton.addEventListener('click', () => {
    if (state.input?.isConnected) return;
    form.append(state.input);
    state.detached = false;
    state.controller?.registerUploader?.({
      input: state.input,
      mediaKind: 'audio',
      acceptTokens: config.accept.split(','),
      multiple: false,
      nearbyTexts: [config.rule],
      alertTexts: [],
      uploaderId: 'audio-s3-uploader'
    });
    setStatus('输入已重新挂载');
  });
})();
