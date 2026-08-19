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

export function statusText(sessionState, uploaderCount) {
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
  const pill = documentRef.createElement('button');
  pill.type = 'button';
  pill.className = 'uf-pill';
  pill.setAttribute('aria-expanded', 'false');
  pill.setAttribute('aria-label', 'UploadFit 状态，单击展开详情');

  const text = documentRef.createElement('span');
  text.className = 'uf-pill-text';
  pill.append(text);

  const close = documentRef.createElement('button');
  close.type = 'button';
  close.className = 'uf-pill-close';
  close.setAttribute('aria-label', '关闭 UploadFit');
  close.textContent = '关闭';
  pill.append(close);

  let lastAnnounced = null;
  const announce = (value) => {
    if (value === lastAnnounced) return value; // 同一状态不重复播报
    lastAnnounced = value;
    return value;
  };

  const handleToggle = (event) => {
    event.stopPropagation();
    onToggle?.();
  };
  const handleClose = (event) => {
    event.stopPropagation();
    onClose?.();
  };
  pill.addEventListener('click', handleToggle);
  close.addEventListener('click', handleClose);

  return {
    element: pill,
    focus() {
      pill.focus();
    },
    update({ sessionState, uploaderCount, expanded }) {
      const value = announce(statusText(sessionState, uploaderCount));
      text.textContent = value;
      pill.setAttribute('aria-expanded', String(Boolean(expanded)));
    },
    destroy() {
      pill.removeEventListener('click', handleToggle);
      close.removeEventListener('click', handleClose);
    }
  };
}
