export const STATUS_TEXTS = Object.freeze({
  BOOTING: 'UploadFit启动中',
  SCANNING: '正在寻找上传区域',
  ARMED_ZERO: '暂未发现上传框，我会继续监听页面变化',
  ARMED_ONE: '已监听1个上传区域',
  ARMED_MANY: '已监听N个上传区域',
  PROCESSING: '正在适配图片',
  SUCCESS: '图片已适配',
  STOPPED: '本次未自动处理'
});

// 任务书 50-S4 §6 未列出的会话状态使用就近描述，七个固定状态文案保持逐字一致。
const EXTRA_STATE_TEXTS = Object.freeze({
  INSPECTING: '正在检查图片',
  WAITING_REJECTION: '等待网页反馈',
  NEEDS_CONFIRMATION: '等待你的确认',
  INJECTING: '正在适配图片',
  RETRYING: '正在重试',
  PASSTHROUGH: '图片已适配',
  DISPOSED: 'UploadFit已关闭'
});

export function statusText(sessionState, uploaderCount, mediaKind = 'image') {
  if (mediaKind === 'audio') {
    if (sessionState === 'PROCESSING' || sessionState === 'INJECTING') return '正在处理音频';
    if (sessionState === 'SUCCESS' || sessionState === 'PASSTHROUGH') return '音频已处理';
    if (sessionState === 'NEEDS_CONFIRMATION') return '等待确认音频处理';
  }
  if (sessionState === 'ARMED') {
    if (!uploaderCount) return STATUS_TEXTS.ARMED_ZERO;
    if (uploaderCount === 1) return STATUS_TEXTS.ARMED_ONE;
    return STATUS_TEXTS.ARMED_MANY.replace('N', String(uploaderCount));
  }
  return STATUS_TEXTS[sessionState] ?? EXTRA_STATE_TEXTS[sessionState] ?? 'UploadFit';
}

/**
 * The bottom-right status pill. Pure view: it renders from a snapshot-derived
 * value and only emits toggle/close intents through callbacks.
 */
export function createStatusPill({ documentRef, onToggle, onClose }) {
  const pill = documentRef.createElement('div');
  pill.className = 'uf-pill';
  pill.setAttribute('role', 'group');
  pill.setAttribute('aria-label', 'UploadFit 状态');

  const toggle = documentRef.createElement('button');
  toggle.type = 'button';
  toggle.className = 'uf-pill-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'UploadFit 状态，单击展开详情');

  const text = documentRef.createElement('span');
  text.className = 'uf-pill-text';
  toggle.append(text);

  const close = documentRef.createElement('button');
  close.type = 'button';
  close.className = 'uf-pill-close';
  close.setAttribute('aria-label', '关闭 UploadFit');
  close.textContent = '关闭';

  const live = documentRef.createElement('span');
  live.className = 'uf-status-live';
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  pill.append(toggle, close, live);

  let lastAnnounced = null;
  const announce = (value) => {
    if (value === lastAnnounced) return false;
    lastAnnounced = value;
    return true;
  };

  const handleToggle = (event) => {
    event.stopPropagation();
    onToggle?.();
  };
  const handleClose = (event) => {
    event.stopPropagation();
    onClose?.();
  };
  toggle.addEventListener('click', handleToggle);
  close.addEventListener('click', handleClose);

  return {
    element: pill,
    focus() {
      toggle.focus();
    },
    update({ sessionState, uploaderCount, mediaKind = 'image', expanded, suppressLive = false }) {
      const value = statusText(sessionState, uploaderCount, mediaKind);
      const changed = announce(value);
      text.textContent = value;
      toggle.setAttribute('aria-expanded', String(Boolean(expanded)));
      if (suppressLive) live.textContent = '';
      else if (changed) live.textContent = value;
    },
    destroy() {
      toggle.removeEventListener('click', handleToggle);
      close.removeEventListener('click', handleClose);
    }
  };
}
