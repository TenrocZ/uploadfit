(() => {
  const params = new URLSearchParams(location.search);
  const scenario = String(params.get('scenario') ?? 'A').toUpperCase();
  const root = document.getElementById('audio-s3-root');
  const configs = {
    A: {
      title: '合规 MP3 原文件直通',
      rule: '音频上传仅支持 MP3，文件最大 250KB。合规 MP3 原文件直接上传。',
      accept: 'audio/mpeg',
      hint: '先在 B 生成并处理一个 PCM WAV，再点击“复用最近 MP3”；也可以直接选择合规 MP3。'
    },
    B: {
      title: 'PCM WAV 转 MP3',
      rule: '音频上传仅支持 MP3，文件最大 250KB。WAV 需要转换为 MP3。',
      accept: 'audio/mpeg',
      wavSeconds: 4,
      hint: '推荐生成 4 秒 PCM 16-bit mono WAV（源文件超过 250KB），确认后应只处理一次并回填 audio/mpeg。'
    },
    C: {
      title: '超限 MP3 稳定停止',
      rule: '音频上传仅支持 MP3，文件最大 250KB。超限 MP3 不可转码。',
      accept: 'audio/mpeg',
      hint: '先在 B 生成 MP3，再点击“生成超限 MP3”；预期 AUDIO_CODEC_UNSUPPORTED、Worker/process=0。'
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
      hint: '生成 WAV 后可在处理中取消，或移除输入；预期 abort、无迟到注入。'
    },
    H: {
      title: '关联拒收最多一次重试',
      rule: '音频上传仅支持 MP3，文件最大 250KB。WAV 需要转换为 MP3。',
      accept: 'audio/mpeg',
      hint: '勾选“成功后自动产生一次关联拒收”再生成 WAV；预期最多一次重试且 submit click=0。',
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
    const button = node('button', { id, type: 'button' }, text);
    controls.append(button);
    return button;
  };
  const wavButton = addControl('audio-s3-generate-wav', `生成 ${config.wavSeconds ?? 0.5} 秒 PCM WAV`);
  const longWavButton = addControl('audio-s3-generate-long-wav', '生成 1.5 秒 PCM WAV');
  const reuseButton = addControl('audio-s3-reuse-mp3', '复用最近 MP3');
  const largeButton = addControl('audio-s3-large-mp3', '生成超限 MP3');
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
    eventOutput.textContent = JSON.stringify(state.events, null, 2);
  }
  document.addEventListener('change', recordEvent, true);
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
    if (!task) return;
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
  longWavButton.addEventListener('click', () => transferFile(createWav(1.5)));
  reuseButton.addEventListener('click', () => {
    if (!state.lastMp3) {
      setStatus('尚无最近 MP3：先完成 B 场景转码或选择本地 MP3');
      return;
    }
    transferFile(state.lastMp3);
  });
  largeButton.addEventListener('click', () => {
    if (!state.lastMp3) {
      setStatus('尚无最近 MP3：先完成 B 场景转码');
      return;
    }
    const padding = new Uint8Array(300_000);
    transferFile(new File([state.lastMp3, padding], 's3-over-limit.mp3', { type: 'audio/mpeg' }));
  });
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
