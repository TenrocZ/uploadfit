import { DOM_DEBOUNCE_MS, REJECTION_WINDOW_MS } from '../config.js';
import { classifyRejectionText } from './rejection-classifier.js';
import { findAssociatedErrorNodes } from './context-extractor.js';
import { sanitizeEvidenceText } from '../utils/text.js';

const ERROR_SELECTOR = '[role="alert"], [aria-live], [data-error], .error, .invalid-feedback, [class*="error"], [class*="invalid"]';
const NOOP = () => {};

function ownerDocument(input) {
  return input?.ownerDocument ?? null;
}

function viewFor(documentRef) {
  return documentRef?.defaultView ?? globalThis;
}

function isElement(node) {
  return node?.nodeType === 1;
}

function isErrorNode(node) {
  return isElement(node) && (
    node.matches?.(ERROR_SELECTOR)
    || Boolean(node.closest?.(ERROR_SELECTOR))
  );
}

function textOf(node) {
  return sanitizeEvidenceText(node?.textContent ?? '').slice(0, 600);
}

function describedNodes(input) {
  const documentRef = ownerDocument(input);
  return (input?.getAttribute?.('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => documentRef?.getElementById?.(id))
    .filter(Boolean);
}

function ancestorContainers(input) {
  const result = [];
  let node = input?.parentElement;
  let depth = 0;
  while (node && depth < 5) {
    result.push(node);
    node = node.parentElement;
    depth += 1;
  }
  return result;
}

function containsOtherInput(node, input) {
  return Boolean(
    node?.querySelectorAll
    && [...node.querySelectorAll('input[type="file"]')].some((candidate) => candidate !== input)
  );
}

function associationScore(node, input, errorNodes, described) {
  if (!isElement(node) || containsOtherInput(node, input)) return -1;
  const ancestors = ancestorContainers(input);
  const explicit = described.includes(node) || described.some((item) => item.contains?.(node));
  if (explicit) return 95;
  if (ancestors.some((ancestor) => ancestor === node || ancestor.contains?.(node))) return 100;
  if (errorNodes.some((item) => item === node || item.contains?.(node))) return 80;
  if (node.matches?.('[role="alert"], [aria-live]')) return 30;
  return 0;
}

function directlyAssociated(node, input) {
  const described = describedNodes(input);
  if (described.includes(node) || described.some((item) => item.contains?.(node))) {
    return true;
  }
  return ancestorContainers(input).some((ancestor) => (
    (ancestor === node || ancestor.contains?.(node))
    && !containsOtherInput(ancestor, input)
  ));
}

function currentCandidates(node) {
  const values = [];
  if (isErrorNode(node)) values.push(node.closest?.(ERROR_SELECTOR) ?? node);
  node?.querySelectorAll?.(ERROR_SELECTOR)?.forEach((item) => values.push(item));
  return [...new Set(values)].filter((item) => textOf(item));
}

function collectActiveTasks(task, getActiveTasks) {
  const values = typeof getActiveTasks === 'function' ? getActiveTasks() : [task];
  const active = Array.isArray(values) ? values.filter(Boolean) : [task];
  return active.length ? active : [task];
}

/**
 * Observe only DOM feedback related to one uploader for at most 30 seconds.
 * The returned stopper is safe to call repeatedly.
 */
export function observeRejection(task, uploaderContext, options = {}) {
  const input = uploaderContext?.input ?? task?.inputElement;
  const documentRef = ownerDocument(input);
  if (!input || !documentRef) return NOOP;

  const view = viewFor(documentRef);
  const Observer = view.MutationObserver ?? globalThis.MutationObserver;
  const onRejection = typeof options.onRejection === 'function'
    ? options.onRejection
    : NOOP;
  const onTimeout = typeof options.onTimeout === 'function' ? options.onTimeout : NOOP;
  const debounceMs = Number.isFinite(options.debounceMs)
    ? Math.max(0, options.debounceMs)
    : DOM_DEBOUNCE_MS;
  const windowMs = Number.isFinite(options.windowMs)
    ? Math.max(0, options.windowMs)
    : REJECTION_WINDOW_MS;
  const adapter = uploaderContext.adapter;
  let adapterErrorNodes = [];
  try {
    adapterErrorNodes = typeof adapter?.findErrorNodes === 'function'
      ? adapter.findErrorNodes(input) ?? []
      : [];
  } catch {
    adapterErrorNodes = [];
  }
  const errorNodes = [
    ...(adapterErrorNodes.length ? adapterErrorNodes : findAssociatedErrorNodes(input)),
    ...describedNodes(input)
  ];
  const described = describedNodes(input);
  const activeTasks = () => collectActiveTasks(task, options.getActiveTasks);
  const startedAt = Date.now();
  const seen = new Set();
  const observers = [];
  let timeoutId = null;
  let debounceId = null;
  let stopped = false;

  const stop = (reason = 'STOPPED') => {
    if (stopped) return false;
    stopped = true;
    if (timeoutId !== null) (view.clearTimeout ?? clearTimeout)(timeoutId);
    if (debounceId !== null) (view.clearTimeout ?? clearTimeout)(debounceId);
    for (const observer of observers) observer.disconnect?.();
    observers.length = 0;
    view.removeEventListener?.('pagehide', onPageHide);
    view.removeEventListener?.('beforeunload', onPageHide);
    return reason;
  };

  const emitCandidate = (node) => {
    if (stopped || !isElement(node)) return;
    for (const candidateNode of currentCandidates(node)) {
      const text = textOf(candidateNode);
      if (!text) continue;
      const key = String(candidateNode) + '::' + text;
      if (seen.has(key)) continue;
      seen.add(key);

      const classification = classifyRejectionText(text);
      if (classification.kind === 'irrelevant') continue;

      const tasks = activeTasks();
      const direct = directlyAssociated(candidateNode, input);
      const globalFeedback = candidateNode.matches?.('[role="alert"], [aria-live]');
      if (direct) {
        onRejection({
          kind: classification.kind,
          reason: classification.reason,
          text,
          candidates: classification.candidates,
          node: candidateNode,
          task,
          related: true,
          elapsedMs: Date.now() - startedAt,
          errorCode: null
        });
        if (classification.kind === 'ambiguous') stop('CLASSIFIED');
        else stop('REJECTION_DETECTED');
        return;
      }
      if (tasks.length > 1 && !direct && !globalFeedback) return;
      const scored = tasks
        .map((candidateTask) => ({
          task: candidateTask,
          score: associationScore(
            candidateNode,
            candidateTask.inputElement ?? input,
            errorNodes,
            describedNodes(candidateTask.inputElement ?? input)
          )
        }))
        .filter((item) => item.score >= 0)
        .sort((left, right) => right.score - left.score);
      const top = scored[0];
      const tied = scored.length > 1 && top && scored[1].score === top.score;
      const associatedTask = tied || !top || (top.score === 0 && tasks.length > 1)
        ? null
        : top.task;

      const detail = {
        kind: classification.kind,
        reason: classification.reason,
        text,
        candidates: classification.candidates,
        node: candidateNode,
        task: associatedTask,
        related: Boolean(associatedTask),
        elapsedMs: Date.now() - startedAt,
        errorCode: tied || (!associatedTask && tasks.length > 1)
          ? 'AMBIGUOUS_REJECTION_ASSOCIATION'
          : null
      };
      if (associatedTask && associatedTask !== task && !detail.errorCode) return;
      onRejection(detail);
      if (detail.errorCode || classification.kind === 'ambiguous') stop('CLASSIFIED');
      else stop('REJECTION_DETECTED');
      return;
    }
  };

  const flush = (nodes) => {
    debounceId = null;
    if (stopped) return;
    for (const node of nodes) emitCandidate(node);
  };

  const schedule = (nodes) => {
    if (stopped) return;
    const candidates = [...new Set(nodes.filter(isElement))];
    if (!candidates.length) return;
    if (debounceId !== null) (view.clearTimeout ?? clearTimeout)(debounceId);
    debounceId = (view.setTimeout ?? setTimeout)(() => flush(candidates), debounceMs);
  };

  const onMutation = (records) => {
    if (stopped) return;
    const nodes = [];
    for (const record of records ?? []) {
      if (record.type === 'characterData') {
        if (record.target?.parentElement) nodes.push(record.target.parentElement);
        continue;
      }
      if (record.type === 'childList') {
        if (record.target?.nodeType === 1) nodes.push(record.target);
        for (const node of record.addedNodes ?? []) {
          if (node.nodeType === 1) nodes.push(node);
          if (node.parentElement) nodes.push(node.parentElement);
        }
      }
    }
    schedule(nodes);
  };

  if (typeof Observer === 'function') {
    const root = documentRef.documentElement ?? documentRef.body ?? documentRef;
    try {
      const observer = new Observer(onMutation);
      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true
      });
      observers.push(observer);
    } catch {
      // An unavailable observer simply leaves the task waiting for timeout.
    }
  }

  const onPageHide = () => stop('PAGEHIDE');
  view.addEventListener?.('pagehide', onPageHide, { once: true });
  view.addEventListener?.('beforeunload', onPageHide, { once: true });
  timeoutId = (view.setTimeout ?? setTimeout)(() => {
    if (stopped) return;
    onTimeout({ task, elapsedMs: Date.now() - startedAt });
    stop('TIMEOUT');
  }, windowMs);

  stop.active = () => !stopped;
  stop.reason = () => (stopped ? 'STOPPED' : null);
  return stop;
}

export const classifyRejection = classifyRejectionText;
export { classifyRejectionText };
