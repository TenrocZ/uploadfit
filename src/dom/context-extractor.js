import { AI_TEXT_LIMIT, CONTEXT_TEXT_LIMIT } from '../config.js';
import { createRandomId } from '../utils/ids.js';
import {
  isRuleRelevantText,
  normalizeText,
  sanitizeEvidenceText,
  selectRelevantText,
} from '../utils/text.js';
import { getAssociatedTexts } from './input-discovery.js';

const uploaderIds = new WeakMap();
const EXCLUDED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'FOOTER']);
const FORM_CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON']);
const ERROR_SELECTOR = '[role="alert"], [aria-live], [data-error], .error, .invalid-feedback';
const FILE_INPUT_SELECTOR = 'input[type="file"]';

function uniqueSafeTexts(values) {
  return [...new Set(values.map(sanitizeEvidenceText).filter(Boolean))];
}

function getUploaderId(input) {
  if (!uploaderIds.has(input)) uploaderIds.set(input, createRandomId('uploader'));
  return uploaderIds.get(input);
}

function isHiddenElement(element) {
  if (!element || element.nodeType !== 1) return true;
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;
  const styleAttribute = element.getAttribute('style') ?? '';
  if (/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(styleAttribute)) {
    return true;
  }
  try {
    const view = element.ownerDocument?.defaultView;
    const style = view?.getComputedStyle?.(element);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
  } catch {
    return true;
  }
  return false;
}

function isExcludedElement(element) {
  if (!element || element.nodeType !== 1) return true;
  if (EXCLUDED_TAGS.has(element.tagName)) return true;
  return isHiddenElement(element);
}

function isFileInput(element) {
  return element?.nodeType === 1
    && element.matches?.(FILE_INPUT_SELECTOR) === true;
}

function getFileInputs(element) {
  if (!element) return [];
  const inputs = [];
  if (isFileInput(element)) inputs.push(element);
  inputs.push(...(element.querySelectorAll?.(FILE_INPUT_SELECTOR) ?? []));
  return [...new Set(inputs)];
}

function containsTargetFileInput(element, input) {
  return getFileInputs(element).includes(input);
}

function containsOtherFileInput(element, input) {
  return getFileInputs(element).some((candidate) => candidate !== input);
}

function safeVisibleText(node, options = {}) {
  if (!node) return '';
  if (node.nodeType === 3) return sanitizeEvidenceText(node.nodeValue);
  if (node.nodeType !== 1 || isExcludedElement(node)) return '';
  if (FORM_CONTROL_TAGS.has(node.tagName)) return '';
  if (options.input
    && containsOtherFileInput(node, options.input)
    && !containsTargetFileInput(node, options.input)) return '';
  const text = Array.from(node.childNodes ?? [])
    .map((child) => safeVisibleText(child, options))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (options.skipUnrelated && !isRuleRelevantText(text)) return '';
  return text;
}

function addIfRelevant(values, value, { force = false } = {}) {
  const text = sanitizeEvidenceText(value);
  if (!text) return;
  if (force || isRuleRelevantText(text)) values.push(text);
}

function getAttributeTexts(input) {
  const values = [];
  const accept = sanitizeEvidenceText(input.getAttribute?.('accept') ?? '');
  if (accept) values.push(`accept: ${accept}`);
  values.push(`multiple: ${Boolean(input.multiple)}`);
  values.push(`required: ${Boolean(input.required || input.hasAttribute?.('required'))}`);

  const ariaLabel = input.getAttribute?.('aria-label');
  if (ariaLabel) values.push(`aria-label: ${sanitizeEvidenceText(ariaLabel)}`);
  const title = input.getAttribute?.('title');
  if (title) values.push(`title: ${sanitizeEvidenceText(title)}`);
  return uniqueSafeTexts(values);
}

function getDescribedByTexts(input) {
  const documentRef = input.ownerDocument;
  const ids = (input.getAttribute?.('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return ids
    .map((id) => documentRef?.getElementById?.(id))
    .filter((element) => element && !isExcludedElement(element))
    .map((element) => safeVisibleText(element, { input, skipUnrelated: false }))
    .filter(Boolean)
    .map(sanitizeEvidenceText)
    .filter(Boolean);
}

function getAncestorTexts(input) {
  const values = [];
  let ancestor = input.parentElement;
  let depth = 0;
  while (ancestor && depth < 4) {
    if (ancestor !== input.ownerDocument?.body && ancestor !== input.ownerDocument?.documentElement) {
      addIfRelevant(values, safeVisibleText(ancestor, { input, skipUnrelated: true }));
    }
    ancestor = ancestor.parentElement;
    depth += 1;
  }
  return values;
}

function getAdjacentTexts(input) {
  const values = [];
  const parent = input.parentElement;
  const nodes = [input.previousElementSibling, input.nextElementSibling];
  if (parent) nodes.push(parent.previousElementSibling, parent.nextElementSibling);
  for (const node of nodes) {
    addIfRelevant(values, safeVisibleText(node, { input, skipUnrelated: true }));
  }
  return values;
}

function getUploaderScope(node) {
  let ancestor = node?.nodeType === 1 ? node : node?.parentElement;
  while (ancestor && ancestor !== ancestor.ownerDocument?.body
    && ancestor !== ancestor.ownerDocument?.documentElement) {
    const inputs = getFileInputs(ancestor);
    if (inputs.length === 1) return inputs[0];
    ancestor = ancestor.parentElement;
  }
  return null;
}

function isExplicitlyDescribed(input, node) {
  const ids = (input.getAttribute?.('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  const nodeId = node.getAttribute?.('id');
  return Boolean(nodeId && ids.includes(nodeId));
}

function isErrorAssociatedWithInput(input, node) {
  if (isExplicitlyDescribed(input, node)) return true;
  const scopedInput = getUploaderScope(node);
  return scopedInput === null || scopedInput === input;
}

export function findAssociatedErrorNodes(input) {
  if (!input || input.nodeType !== 1) return [];
  const values = [];
  let ancestor = input.parentElement;
  let depth = 0;
  while (
    ancestor &&
    depth < 4 &&
    ancestor !== input.ownerDocument?.body &&
    ancestor !== input.ownerDocument?.documentElement
  ) {
    for (const node of ancestor.querySelectorAll?.(ERROR_SELECTOR) ?? []) {
      if (isErrorAssociatedWithInput(input, node)) values.push(node);
    }
    ancestor = ancestor.parentElement;
    depth += 1;
  }
  return [...new Set(values)];
}

function getAlertTexts(input) {
  return findAssociatedErrorNodes(input)
    .map((node) => safeVisibleText(node, { input, skipUnrelated: false }))
    .filter(Boolean);
}

function getSelectedText(selectedText) {
  const text = sanitizeEvidenceText(selectedText);
  return text || null;
}

function appendWithinContextBudget(values, state) {
  const unique = uniqueSafeTexts(values);
  const bounded = [];
  for (const value of unique) {
    const separatorLength = state.hasText ? 1 : 0;
    const available = CONTEXT_TEXT_LIMIT - state.used - separatorLength;
    if (available <= 0) {
      state.truncated = true;
      break;
    }
    if (value.length <= available) {
      bounded.push(value);
      state.used += separatorLength + value.length;
      state.hasText = true;
      continue;
    }
    bounded.push(value.slice(0, available));
    state.used += separatorLength + available;
    state.hasText = true;
    state.truncated = true;
    break;
  }
  if (bounded.length < unique.length) state.truncated = true;
  return bounded;
}

function createBoundedSources(nearbyTexts, alertTexts, selectedText) {
  const state = { used: 0, hasText: false, truncated: false };
  const boundedNearbyTexts = appendWithinContextBudget(nearbyTexts, state);
  const boundedAlertTexts = appendWithinContextBudget(alertTexts, state);
  const boundedSelectedValues = appendWithinContextBudget(
    selectedText ? [selectedText] : [],
    state
  );
  const allTexts = [
    ...boundedNearbyTexts,
    ...boundedAlertTexts,
    ...boundedSelectedValues
  ];
  const normalizedText = allTexts.map(normalizeText).join('\n');
  return {
    nearbyTexts: boundedNearbyTexts,
    alertTexts: boundedAlertTexts,
    selectedText: boundedSelectedValues[0] ?? null,
    normalizedText: normalizedText.slice(0, CONTEXT_TEXT_LIMIT),
    truncated: state.truncated || normalizedText.length > CONTEXT_TEXT_LIMIT
  };
}

/**
 * Extract a bounded, redacted ContextBundle around one upload input.
 * No page serialization or form-control values are read.
 */
export function extractRelevantContext(input, selectedText = null, options = {}) {
  if (!input || input.nodeType !== 1) {
    return {
      uploaderId: '',
      label: '',
      attributes: { accept: null, multiple: false, required: false },
      selectedText: null,
      nearbyTexts: [],
      alertTexts: [],
      normalizedText: '',
      truncated: false
    };
  }

  const associatedTexts = uniqueSafeTexts(getAssociatedTexts(input));
  const nearbyTexts = [
    ...getAttributeTexts(input),
    ...associatedTexts,
    ...getDescribedByTexts(input),
    ...getAncestorTexts(input),
    ...getAdjacentTexts(input)
  ];
  const alertTexts = getAlertTexts(input);
  const selected = getSelectedText(selectedText);
  const bounded = createBoundedSources(nearbyTexts, alertTexts, selected);

  return {
    uploaderId: options.uploaderId ?? getUploaderId(input),
    label: sanitizeEvidenceText(associatedTexts[0] ?? '').slice(0, CONTEXT_TEXT_LIMIT),
    attributes: {
      accept: sanitizeEvidenceText(input.getAttribute?.('accept') ?? '') || null,
      multiple: Boolean(input.multiple),
      required: Boolean(input.required || input.hasAttribute?.('required'))
    },
    selectedText: bounded.selectedText,
    nearbyTexts: bounded.nearbyTexts,
    alertTexts: bounded.alertTexts,
    normalizedText: bounded.normalizedText,
    truncated: bounded.truncated
  };
}

/** Select only rule-relevant sentences for a bounded future AI call. */
export function selectAiRelevantText(bundle) {
  return selectRelevantText(bundle?.normalizedText ?? '', AI_TEXT_LIMIT);
}
