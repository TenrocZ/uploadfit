import { createCropper } from './cropper.js';

const ERROR_TEXTS = {
  USER_CANCELLED: '已取消，原文件保持不变。',
  OFFICIAL_TOOL_REQUIRED: '网页要求使用官方照片审核工具，UploadFit 不能替代，因此没有修改文件。',
  RULE_CONFLICT: '网页规则互相冲突，无法自动适配，因此没有修改文件。',
  AMBIGUOUS_RULES: '网页规则不完整或存在矛盾，无法自动适配，因此没有修改文件。',
  AMBIGUOUS_REJECTION_ASSOCIATION: '无法确定网页报错与本次上传的关系，因此没有修改文件。',
  INPUT_DETACHED: '上传框已从页面移除，无法写回，可下载处理后的文件手动上传。',
  INJECTION_FAILED: '处理完成但写回上传框失败，可下载处理后的文件手动上传。',
  DATATRANSFER_UNAVAILABLE: '浏览器不允许把文件写回上传框，可下载处理后的文件手动上传。',
  UNTRUSTED_EVENT_BLOCKED: '浏览器拦截了模拟事件，可下载处理后的文件手动上传。',
  OUTPUT_VALIDATION_FAILED: '处理结果未通过最终复检，已放弃，没有修改原文件。',
  DECODE_FAILED: '图片无法解码，因此没有修改文件。',
  UNSUPPORTED_FORMAT: '图片格式不受支持，因此没有修改文件。',
  FILE_TOO_LARGE_TO_PROCESS: '图片太大，超出本工具的处理能力，因此没有修改文件。',
  PIXEL_LIMIT_EXCEEDED: '图片像素总数超出处理上限，因此没有修改文件。',
  CANVAS_LIMIT_EXCEEDED: '浏览器画布无法承载该尺寸，因此没有修改文件。',
  USER_CONFIRMATION_REQUIRED: '确认信息无效或已过期，因此没有修改文件。',
  SESSION_DISPOSED: 'UploadFit 已关闭。'
};

const OPERATION_TEXTS = {
  ORIENT: '修正照片方向',
  CONVERT: '转换图片格式',
  RESIZE: '调整宽高尺寸',
  CROP: '裁剪照片',
  FLATTEN_BACKGROUND: '透明背景转白底',
  UPSCALE: '放大像素尺寸',
  ENCODE: '重新编码',
  COMPRESS: '压缩文件大小'
};

export function errorText(code) {
  return ERROR_TEXTS[code] ?? `处理失败（${code}），因此没有修改文件。`;
}

export function formatBytes(value) {
  return Number.isFinite(value) && value >= 0 ? `${Math.round(value)} 字节` : '未知';
}

export function formatDimension(rule) {
  if (!rule) return null;
  const { exact, min, max } = rule;
  if (Number.isFinite(exact)) return `${exact} 像素`;
  if (Number.isFinite(min) && Number.isFinite(max)) return `${min}–${max} 像素`;
  if (Number.isFinite(min)) return `≥${min} 像素`;
  if (Number.isFinite(max)) return `≤${max} 像素`;
  return null;
}

function pendingConfirmationOf(task) {
  if (task?.policyConfirmation?.required && !task.policyConfirmation.resolved) {
    return task.policyConfirmation;
  }
  return task?.plan?.confirmations?.find((item) => item.required && !item.resolved) ?? null;
}

/**
 * The task detail card. It renders immutable view models and emits user intent
 * through callbacks only — it never touches rules, images or the controller.
 */
export function createTaskCardView({ documentRef, callbacks }) {
  const el = (tag, className, text) => {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const row = (key, value) => {
    const li = el('li');
    li.append(el('span', 'uf-label', key), el('span', 'uf-value', value));
    return li;
  };
  const list = (rows) => {
    const ul = el('ul', 'uf-rule-list');
    for (const entry of rows ?? []) {
      if (!Array.isArray(entry) || entry[1] == null) continue;
      ul.append(row(entry[0], entry[1]));
    }
    return ul;
  };
  const btn = (label, action, primary) => {
    const node = el('button', primary ? 'uf-button uf-button-primary' : 'uf-button', label);
    node.type = 'button';
    if (action) node.setAttribute('data-uf-action', action);
    return node;
  };
  const actions = (...buttons) => {
    const box = el('div', 'uf-actions');
    box.append(...buttons.filter(Boolean));
    return box;
  };
  const hint = (text) => el('div', 'uf-hint', text);

  const root = el('div', 'uf-card');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'UploadFit 任务详情');
  const live = el('div', 'uf-live');
  live.setAttribute('aria-live', 'polite');
  root.append(live);

  let cropper = null;
  let lastAnnouncedError = null;
  let detailsOpen = false;

  const confirm = (taskId, confirmation) => callbacks.onConfirm({ taskId, confirmation });
  const decline = (task, pending) => confirm(task.taskId, {
    id: pending.id, type: pending.type, accepted: false, payload: null
  });

  function rulesSection(card, rules) {
    if (!rules) return;
    const width = rules.width?.display ?? formatDimension(rules.width);
    const height = rules.height?.display ?? formatDimension(rules.height);
    const minText = Number.isFinite(rules.minBytes) ? formatBytes(rules.minBytes) : '不限';
    const maxText = Number.isFinite(rules.maxBytes) ? formatBytes(rules.maxBytes) : '不限';
    const ul = list([
      rules.formats?.length
        ? ['格式', rules.formats.map((f) => f.replace('image/', '').toUpperCase()).join(' / ')]
        : null,
      Number.isFinite(rules.minBytes) || Number.isFinite(rules.maxBytes)
        ? ['文件大小', `${minText} – ${maxText}`]
        : null,
      width ? ['宽度', width] : null,
      height ? ['高度', height] : null,
      Number.isFinite(rules.aspectRatio?.value)
        ? ['宽高比', String(Math.round(rules.aspectRatio.value * 1000) / 1000)]
        : null
    ]);
    if (ul.children.length) {
      const section = el('div', 'uf-section');
      section.append(el('div', 'uf-label', '网页识别到的机器规则：'), ul);
      card.append(section);
    }
    const semantic = [...(rules.semanticRequirements ?? [])];
    if (Number.isFinite(rules.dpi)) semantic.push(`分辨率 ${rules.dpi} dpi（仅展示）`);
    if (rules.background) semantic.push(`${rules.background === 'blue' ? '蓝色' : rules.background}背景（仅展示）`);
    if (semantic.length) {
      const box = el('div', 'uf-semantic');
      box.append(el('span', null, '网页另有以下要求，需人工确认，UploadFit 不会自动处理：'));
      const items = el('ul', 'uf-rule-list');
      for (const item of semantic) items.append(el('li', null, `· ${item}`));
      box.append(items);
      card.append(box);
    }
    if (rules.sources?.length) {
      const box = el('div', 'uf-evidence');
      box.append('规则原文证据：');
      for (const source of rules.sources.slice(0, 4)) {
        for (const item of (source.evidence ?? []).slice(0, 3)) {
          box.append(el('span', null, `“${item}”`), documentRef.createElement('br'));
        }
      }
      card.append(box);
    }
    if (rules.conflicts?.length) {
      const box = el('div', 'uf-conflict');
      box.setAttribute('role', 'alert');
      box.append(el('div', 'uf-conflict-title', '规则冲突：以下要求互相矛盾，不会自动处理。'));
      const items = el('ul', 'uf-rule-list');
      for (const conflict of rules.conflicts) {
        items.append(el('li', null, `· ${conflict.field ?? '未知字段'}：${conflict.reason ?? '存在矛盾'}`));
      }
      box.append(items);
      card.append(box);
    }
  }

  function fileSection(card, current) {
    if (!current) return;
    const width = Number.isFinite(current.displayWidth) ? current.displayWidth : current.width;
    const height = Number.isFinite(current.displayHeight) ? current.displayHeight : current.height;
    const section = el('div', 'uf-section');
    section.append(el('div', 'uf-label', '当前文件：'));
    section.append(list([
      ['格式', current.mime ?? '未知'],
      ['大小', formatBytes(current.size)],
      Number.isFinite(width) && Number.isFinite(height) ? ['宽高', `${width} × ${height} 像素`] : null
    ]));
    card.append(section);
  }

  function operationsSection(card, plan) {
    const operations = plan?.operations ?? [];
    if (!operations.length) return;
    const section = el('div', 'uf-section');
    section.append(el('div', 'uf-label', '将执行的动作：'));
    const items = el('ul', 'uf-rule-list');
    for (const operation of operations) {
      items.append(el('li', null, `· ${OPERATION_TEXTS[operation] ?? operation}`));
    }
    section.append(items);
    card.append(section);
  }

  const renderRuleConfirm = (card, task, pending) => {
    card.append(el('div', 'uf-card-title', '确认按本页规则适配'));
    fileSection(card, task.current);
    rulesSection(card, task.rules);
    operationsSection(card, task.plan);
    card.append(hint('规则置信度中等，需要你确认后才会开始处理。'));
    const accept = btn('适配并继续', 'confirm-rule', true);
    accept.addEventListener('click', () => confirm(task.taskId, {
      id: pending.id, type: pending.type, accepted: true, payload: { allow: true }
    }));
    const useOriginal = btn('使用原文件', 'decline-rule');
    useOriginal.addEventListener('click', () => decline(task, pending));
    card.append(actions(accept, useOriginal));
    return accept;
  };

  const renderFlattenConfirm = (card, task, pending) => {
    card.append(el('div', 'uf-card-title', '透明背景将转为白底'));
    card.append(hint('网页要求 JPG 格式；转换后透明像素会全部变成白色。'));
    const imageUrl = callbacks.createPreviewUrl(task.taskId);
    if (imageUrl) {
      const row = el('div', 'uf-preview-row');
      for (const [checker, caption] of [['uf-preview-checker', '当前（透明）'], ['', '转换后（白底）']]) {
        const box = el('div', 'uf-preview-box' + (checker ? ' ' + checker : ''));
        if (!checker) box.style.background = '#ffffff';
        const image = el('img');
        image.src = imageUrl;
        image.alt = caption;
        box.append(image);
        row.append(box, el('div', 'uf-preview-caption', caption));
      }
      card.append(row);
    }
    const accept = btn('确认转白底并继续', 'confirm-flatten', true);
    accept.addEventListener('click', () => confirm(task.taskId, {
      id: pending.id, type: 'FLATTEN_BACKGROUND', accepted: true, payload: { color: 'white' }
    }));
    const cancel = btn('取消', 'decline-flatten');
    cancel.addEventListener('click', () => decline(task, pending));
    card.append(actions(accept, cancel));
    return accept;
  };

  const renderUpscaleConfirm = (card, task, pending) => {
    card.append(el('div', 'uf-card-title', '需要放大图片'));
    const current = task.current ?? {};
    const section = el('div', 'uf-section');
    section.append(list([
      ['当前尺寸', `${current.displayWidth ?? current.width ?? '?'} × ${current.displayHeight ?? current.height ?? '?'} 像素`],
      ['目标尺寸', `${task.plan?.targetWidth ?? '?'} × ${task.plan?.targetHeight ?? '?'} 像素`]
    ]));
    card.append(section);
    card.append(el('div', 'uf-conflict', '放大只能让像素尺寸达标，不保证清晰度或人工审核通过。'));
    const accept = btn('仍然放大并继续', 'confirm-upscale', true);
    accept.addEventListener('click', () => confirm(task.taskId, {
      id: pending.id, type: 'UPSCALE', accepted: true, payload: { allow: true }
    }));
    const cancel = btn('取消', 'decline-upscale');
    cancel.addEventListener('click', () => decline(task, pending));
    card.append(actions(accept, cancel));
    return accept;
  };

  const renderCropConfirm = (card, task, pending) => {
    card.append(el('div', 'uf-card-title', '需要裁剪照片'));
    const plan = task.plan ?? {};
    const proposed = plan.proposedCrop;
    const sourceWidth = Number.isFinite(task.current?.displayWidth)
      ? task.current.displayWidth
      : task.current?.width;
    const sourceHeight = Number.isFinite(task.current?.displayHeight)
      ? task.current.displayHeight
      : task.current?.height;
    const imageUrl = callbacks.createPreviewUrl(task.taskId);
    const incomplete = !proposed
      || !Number.isFinite(sourceWidth)
      || !Number.isFinite(sourceHeight)
      || !imageUrl;
    if (incomplete) {
      const alertBox = el('div', 'uf-alert', '无法生成裁剪预览，已停止处理，没有修改文件。');
      alertBox.setAttribute('role', 'alert');
      card.append(alertBox);
      const close = btn('关闭', 'cancel-crop');
      close.addEventListener('click', () => callbacks.onCancelTask(task.taskId));
      card.append(actions(close));
      return close;
    }
    card.append(hint('拖动裁剪框选择保留范围（尺寸已按网页比例锁定），按 Esc 取消。'));
    const stage = el('div', 'uf-section');
    card.append(stage);
    cropper = createCropper({
      documentRef,
      imageUrl,
      sourceWidth,
      sourceHeight,
      cropWidth: proposed.width,
      cropHeight: proposed.height,
      targetWidth: plan.targetWidth,
      targetHeight: plan.targetHeight,
      onConfirm: ({ pixel }) => confirm(task.taskId, {
        id: pending.id, type: 'CROP', accepted: true, payload: pixel
      }),
      onCancel: () => callbacks.onCancelTask(task.taskId)
    });
    stage.append(cropper.element);
    return cropper.primaryButton;
  };

  const renderProcessing = (card, task) => {
    card.append(el('div', 'uf-card-title', '正在适配图片'));
    fileSection(card, task.current);
    operationsSection(card, task.plan);
    const progress = el('div', 'uf-progress');
    progress.append(el('div', 'uf-progress-bar'));
    card.append(progress, hint('处理在本地完成，图片不会离开浏览器。'));
    return null;
  };

  const renderSuccess = (card, task, viewModel) => {
    const manual = task.source === 'manual-card';
    card.append(el('div', 'uf-card-title', manual ? '已按本页要求生成文件' : '已适配并放回上传框'));
    const metadata = task.result?.metadata ?? {};
    const operations = (task.result?.operations ?? [])
      .map((operation) => OPERATION_TEXTS[operation] ?? operation).join('、');
    const section = el('div', 'uf-section');
    section.append(list([
      ['输出格式', metadata.mime ?? '未知'],
      ['输出大小', formatBytes(metadata.size)],
      Number.isFinite(metadata.width) && Number.isFinite(metadata.height)
        ? ['输出宽高', `${metadata.width} × ${metadata.height} 像素`]
        : null,
      ['执行动作', operations || '无']
    ]));
    card.append(section);
    const buttons = [];
    if (manual && viewModel.hasOutput && viewModel.downloadUrl) {
      const link = el('a', 'uf-download-link', '下载适配后的文件');
      link.setAttribute('data-uf-action', 'download-output');
      link.setAttribute('download', viewModel.downloadName ?? 'uploadfit-adapted.jpg');
      link.href = viewModel.downloadUrl;
      buttons.push(link);
      card.append(hint('本页没有原上传框，请下载后手动上传到网页，UploadFit 不会伪装回填。'));
    } else if (viewModel.hasOutput) {
      const download = btn('下载适配后的文件', 'download-output');
      download.addEventListener('click', () => callbacks.onDownload(task.taskId));
      buttons.push(download);
    }
    if (!manual) {
      const restore = btn('恢复原文件', 'restore-original');
      restore.addEventListener('click', () => callbacks.onRestore(task.taskId));
      buttons.push(restore);
    }
    const details = btn(detailsOpen ? '收起详情' : '查看详情', 'toggle-details');
    details.addEventListener('click', () => {
      detailsOpen = !detailsOpen;
      callbacks.onRefresh();
    });
    buttons.push(details);
    card.append(actions(...buttons));
    if (detailsOpen) {
      const box = el('div', 'uf-evidence');
      box.append(
        el('span', null, `任务ID：${task.taskId}`),
        documentRef.createElement('br'),
        el('span', null, `重试次数：${task.retryCount ?? 0}`),
        documentRef.createElement('br'),
        el('span', null, `提示：${(task.warnings ?? []).map((item) => item.code).join('、') || '无'}`)
      );
      card.append(box);
    }
    if (!manual) {
      card.append(hint('如需提交，请使用网页原“保存 / 下一步 / 提交”按钮，UploadFit 不会代为点击。'));
    }
    return null;
  };

  const renderStopped = (card, task, viewModel) => {
    const cancelled = task.errorCode === 'USER_CANCELLED';
    card.append(el('div', 'uf-card-title', cancelled ? '已停止处理' : '未能完成适配'));
    const message = errorText(task.errorCode);
    card.append(el('div', cancelled ? 'uf-status-warn' : 'uf-status-error', message));
    if (!cancelled) {
      if (message !== lastAnnouncedError) {
        lastAnnouncedError = message;
        live.textContent = `处理失败：${message}`;
      }
      const alertBox = el('div', 'uf-alert', message);
      alertBox.setAttribute('role', 'alert');
      card.append(alertBox);
    }
    rulesSection(card, task.rules);
    const buttons = [];
    if (viewModel.hasOutput) {
      const download = btn('下载适配文件', 'download-output');
      download.addEventListener('click', () => callbacks.onDownload(task.taskId));
      buttons.push(download);
    }
    if (!cancelled) {
      const viewRules = btn('查看规则', 'view-rules');
      viewRules.addEventListener('click', () => {
        detailsOpen = true;
        callbacks.onRefresh();
      });
      buttons.push(viewRules);
    }
    const close = btn('关闭', 'close-card');
    close.addEventListener('click', () => callbacks.onDismissCard());
    buttons.push(close);
    card.append(actions(...buttons));
    return null;
  };

  const renderWaiting = (card, task) => {
    const waiting = task.status === 'WAITING_REJECTION';
    card.append(el('div', 'uf-card-title', waiting ? '已放行原文件，等待网页反馈' : '正在检查图片'));
    fileSection(card, task.current);
    rulesSection(card, task.rules);
    card.append(hint(waiting
      ? '尚未发现明确规则。若网页报错，UploadFit 会读取错误信息后再决定是否适配。'
      : '正在读取图片信息。'));
    return null;
  };

  const renderPageCard = (card, pageCard) => {
    if (pageCard.state === 'ready') {
      card.append(el('div', 'uf-card-title', '按本页要求准备照片'));
      rulesSection(card, pageCard.rules);
      card.append(hint('本页没有原上传框。选择本地照片后，UploadFit 会按上述要求在本地生成适配文件供下载。'));
      const fileInput = el('input', 'uf-file-input');
      fileInput.type = 'file';
      fileInput.accept = 'image/jpeg,image/png,image/webp';
      fileInput.setAttribute('data-uf-input', 'manual-file');
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (file) callbacks.onSelectManualFile(file);
      });
      const select = btn('选择照片', 'select-manual-file', true);
      select.addEventListener('click', () => fileInput.click());
      const collapse = btn('收起', 'dismiss-page-card');
      collapse.addEventListener('click', () => callbacks.onDismissCard());
      card.append(fileInput, actions(select, collapse));
      return select;
    }
    card.append(el('div', 'uf-card-title', '本页照片要求'));
    card.append(hint(pageCard.state === 'no-rules'
      ? '未在本页识别到明确的照片要求。可以选中页面中的要求文字，再点击下方按钮。'
      : '本页要求不足以自动适配。可以选中页面中的要求文字，再点击下方按钮。'));
    const fromSelection = btn('理解选中文字', 'prepare-from-selection', true);
    fromSelection.addEventListener('click', () => callbacks.onPrepareFromSelection());
    card.append(actions(fromSelection));
    return fromSelection;
  };

  function update(viewModel) {
    if (cropper) {
      cropper.destroy();
      cropper = null;
    }
    while (root.children.length > 1) root.lastChild.remove();
    live.textContent = '';
    const task = viewModel.task;
    const hasCard = Boolean(task) || Boolean(viewModel.pageCard);
    root.hidden = !viewModel.expanded || !hasCard;
    const card = el('div');
    root.append(card);
    let focusTarget = null;
    if (task) {
      const pending = pendingConfirmationOf(task);
      if (task.status === 'NEEDS_CONFIRMATION' && pending) {
        if (pending.type === 'RULE_CONFIDENCE') focusTarget = renderRuleConfirm(card, task, pending);
        else if (pending.type === 'CROP') focusTarget = renderCropConfirm(card, task, pending);
        else if (pending.type === 'FLATTEN_BACKGROUND') focusTarget = renderFlattenConfirm(card, task, pending);
        else if (pending.type === 'UPSCALE') focusTarget = renderUpscaleConfirm(card, task, pending);
      } else if (['PROCESSING', 'INJECTING', 'RETRYING'].includes(task.status)) {
        focusTarget = renderProcessing(card, task);
      } else if (task.status === 'SUCCESS' || task.status === 'PASSTHROUGH') {
        focusTarget = renderSuccess(card, task, viewModel);
      } else if (task.status === 'STOPPED') {
        focusTarget = renderStopped(card, task, viewModel);
      } else {
        focusTarget = renderWaiting(card, task);
      }
    } else if (viewModel.pageCard) {
      focusTarget = renderPageCard(card, viewModel.pageCard);
    }
    if (!card.children.length) {
      root.hidden = true;
      return;
    }
    if (focusTarget && viewModel.focusCard) focusTarget.focus();
  }

  return {
    element: root,
    update,
    destroy() {
      if (cropper) {
        cropper.destroy();
        cropper = null;
      }
    }
  };
}

export { pendingConfirmationOf };
