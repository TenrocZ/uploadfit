import { buildStyleSheet } from './styles.js';
import { createStatusPill } from './status-pill.js';
import { createTaskCardView, pendingConfirmationOf } from './task-card.js';
import { extensionFromMime } from '../utils/mime.js';

const HOST_ATTRIBUTE = 'data-uploadfit-ui-host';
const SUCCESS_COLLAPSE_MS = 3000;

function viewKey(snapshot) {
  const task = snapshot?.activeTask ?? null;
  const pending = task ? pendingConfirmationOf(task) : null;
  const result = task?.result ?? null;
  return JSON.stringify([
    snapshot?.sessionState ?? null,
    snapshot?.uploaderCount ?? 0,
    task ? [
      task.taskId,
      task.status,
      task.errorCode ?? null,
      task.retryCount ?? 0,
      task.source ?? null,
      task.current ? [task.current.mime, task.current.size, task.current.width, task.current.height] : null,
      task.plan ? [task.plan.targetWidth, task.plan.targetHeight, task.plan.proposedCrop] : null,
      result ? [result.metadata?.mime ?? null, result.metadata?.size ?? null] : null,
      (task.warnings ?? []).map((item) => item.code),
      pending ? [pending.id, pending.type] : null
    ] : null,
    snapshot?.pageCard ? [snapshot.pageCard.state, snapshot.pageCard.source] : null
  ]);
}

function cardKindOf(snapshot) {
  const task = snapshot?.activeTask;
  if (!task) return snapshot?.pageCard ? 'page' : null;
  if (task.status === 'NEEDS_CONFIRMATION') {
    const pending = pendingConfirmationOf(task);
    if (pending) return 'confirm';
  }
  return 'task';
}

/**
 * The single UploadFit UI host. Production uses a closed shadow root; tests may
 * request an open root through config.shadowMode. The host renders snapshots and
 * forwards user intent to the controller — it holds no business logic.
 */
export function createUploadFitUi({
  documentRef,
  globalRef,
  controller,
  config = {},
  logger = null,
  onClose = null,
  disposeControllerOnClose = false
} = {}) {
  if (!documentRef?.createElement || !controller?.subscribe) return null;

  // 防御性单例：重复启动先销毁旧 UI（含监听器与 object URL）再移除 host（U02）。
  documentRef.querySelectorAll?.(`[${HOST_ATTRIBUTE}]`).forEach((node) => {
    node?.__uploadfitUi?.dispose?.();
    node.remove();
  });

  const shadowMode = config.shadowMode === 'open' ? 'open' : 'closed';
  const host = documentRef.createElement('div');
  host.setAttribute(HOST_ATTRIBUTE, 'true');
  host.__uploadfitUi = null;

  let shadow = null;
  if (typeof host.attachShadow === 'function') {
    shadow = host.attachShadow({ mode: shadowMode });
  } else {
    shadow = documentRef.createElement('div');
  }
  const style = documentRef.createElement('style');
  style.textContent = buildStyleSheet();
  shadow.append(style);

  const root = documentRef.createElement('div');
  root.className = 'uf-root';
  shadow.append(root);

  const state = {
    expanded: false,
    lastKey: null,
    lastCardKind: null,
    collapseTimer: null,
    disposed: false,
    downloadUrls: new Map()
  };

  const pill = createStatusPill({
    documentRef,
    onToggle: () => {
      setExpanded(!state.expanded);
    },
    onClose: () => {
      logger?.debug?.('ui-close-requested');
      onClose?.();
      if (disposeControllerOnClose) controller.dispose?.();
      dispose();
    }
  });
  root.append(pill.element);

  const card = createTaskCardView({
    documentRef,
    callbacks: {
      onConfirm: ({ taskId, confirmation }) => {
        controller.confirmTask(taskId, confirmation);
      },
      onCancelTask: (taskId) => {
        controller.cancelTask(taskId);
      },
      onRestore: (taskId) => {
        controller.restoreTask(taskId);
      },
      onDownload: (taskId) => {
        triggerDownload(taskId);
      },
      onSelectManualFile: (file) => {
        void controller.createManualTask?.(file);
      },
      onPrepareFromSelection: () => {
        const selection = globalRef?.getSelection?.()?.toString?.() ?? '';
        void controller.prepareManualCard?.({ selectedText: selection });
      },
      onDismissCard: () => {
        setExpanded(false);
      },
      onRefresh: () => {
        render(controller.getSnapshot(), { force: true });
      },
      createPreviewUrl: (taskId) => controller.createTaskPreviewUrl?.(taskId) ?? null
    }
  });
  root.append(card.element);

  (documentRef.body ?? documentRef.documentElement)?.append(host);

  function setExpanded(value) {
    if (state.expanded === value) return;
    state.expanded = value;
    if (value) clearCollapseTimer();
    render(controller.getSnapshot(), { force: true });
    if (value) pill.focus();
  }

  function clearCollapseTimer() {
    if (state.collapseTimer) {
      clearTimeout(state.collapseTimer);
      state.collapseTimer = null;
    }
  }

  function outputInfo(taskId) {
    const output = controller.getTaskOutput?.(taskId);
    if (!output?.file) return null;
    const extension = extensionFromMime(output.file.type) ?? 'jpg';
    return {
      file: output.file,
      name: `uploadfit-${String(taskId).slice(-8)}.${extension}`
    };
  }

  function downloadUrl(taskId) {
    if (state.downloadUrls.has(taskId)) return state.downloadUrls.get(taskId);
    const info = outputInfo(taskId);
    if (!info) return null;
    const urlApi = globalRef?.URL ?? globalThis.URL;
    const url = urlApi?.createObjectURL?.(info.file) ?? null;
    if (url) state.downloadUrls.set(taskId, url);
    return url;
  }

  function triggerDownload(taskId) {
    const info = outputInfo(taskId);
    const url = downloadUrl(taskId);
    if (!info || !url) return;
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = info.name;
    shadow.append(anchor);
    anchor.click();
    anchor.remove();
  }

  function buildViewModel(snapshot) {
    const task = snapshot?.activeTask ?? null;
    const viewModel = {
      sessionState: snapshot?.sessionState ?? 'BOOTING',
      uploaderCount: snapshot?.uploaderCount ?? 0,
      expanded: state.expanded,
      task,
      pageCard: snapshot?.pageCard ?? null,
      hasOutput: Boolean(task && controller.getTaskOutput?.(task.taskId)),
      downloadUrl: null,
      downloadName: null,
      focusCard: false,
      suppressLive: task?.status === 'STOPPED'
        && task.errorCode
        && task.errorCode !== 'USER_CANCELLED'
    };
    if (viewModel.hasOutput && task?.source === 'manual-card' && task.status === 'SUCCESS') {
      const info = outputInfo(task.taskId);
      viewModel.downloadUrl = downloadUrl(task.taskId);
      viewModel.downloadName = info?.name ?? 'uploadfit-adapted.jpg';
    }
    return viewModel;
  }

  function render(snapshot, options = {}) {
    if (state.disposed) return;
    const key = viewKey(snapshot);
    const kind = cardKindOf(snapshot);
    if (key === state.lastKey && !options.force) return;

    const viewModel = buildViewModel(snapshot);
    if (kind === 'confirm' && state.lastCardKind !== 'confirm') {
      viewModel.focusCard = true;
    }
    state.lastKey = key;
    const previousKind = state.lastCardKind;
    state.lastCardKind = kind;
    pill.update(viewModel);
    card.update(viewModel);
    if (previousKind === 'confirm' && kind !== 'confirm') {
      pill.focus();
    }

    const status = viewModel.task?.status;
    if (status === 'SUCCESS' && state.expanded && !state.collapseTimer) {
      // 成功 3 秒后收回卡片，但不清理任务数据（恢复/下载能力保留）。
      state.collapseTimer = setTimeout(() => {
        state.collapseTimer = null;
        if (state.disposed) return;
        state.expanded = false;
        render(controller.getSnapshot(), { force: true });
      }, SUCCESS_COLLAPSE_MS);
    }
  }

  let unsubscribe = null;
  try {
    unsubscribe = controller.subscribe(render);
  } catch {
    unsubscribe = null;
  }

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    clearCollapseTimer();
    if (typeof unsubscribe === 'function') {
      unsubscribe();
      unsubscribe = null;
    }
    card.destroy();
    pill.destroy();
    const urlApi = globalRef?.URL ?? globalThis.URL;
    for (const url of state.downloadUrls.values()) {
      urlApi?.revokeObjectURL?.(url);
    }
    state.downloadUrls.clear();
    host.remove();
  }

  host.__uploadfitUi = {
    dispose
  };

  return {
    host,
    dispose,
    isExpanded: () => state.expanded,
    expand: () => setExpanded(true),
    collapse: () => setExpanded(false),
    triggerDownload,
    // 测试构建（显式 open 模式）可拿到 shadow 内容做断言；closed 模式为 null。
    shadowRoot: shadowMode === 'open' ? shadow : null,
    getShadowMode: () => shadowMode
  };
}
