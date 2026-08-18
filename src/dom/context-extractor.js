import { AI_TEXT_LIMIT, CONTEXT_TEXT_LIMIT } from '../config.js';
import { createRandomId } from '../utils/ids.js';
import {
  isRuleRelevantText,
  joinWithinLimit,
  sanitizeText,
  selectRelevantText,
  uniqueTexts
} from '../utils/text.js';
import { getAssociatedTexts } from './input-discovery.js';

const uploaderIds = new WeakMap();
const EXCLUDED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'FOOTER']);
const FORM_CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON']);
const ERROR_SELECTOR = '[role="alert"], [aria-live], [data-error], .error, .invalid-feedback';

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

function safeVisibleText(node, options = {}) {
  if (!node) return '';
  if (node.nodeType === 3) return sanitizeText(node.nodeValue);
  if (node.nodeType !== 1 || isExcludedElement(node)) return '';
  if (FORM_CONTROL_TAGS.has(node.tagName)) return '';
  if (options.skipUnrelated && !isRuleRelevantText(node.textContent ?? '')) return '';
  return Array.from(node.childNodes ?? [])
    .map((child) => safeVisibleText(child, options))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addIfRelevant(values, value, { force = false } = {}) {
  const text = sanitizeText(value);
  if (!text) return;
  if (force || isRuleRelevantText(text)) values.push(text);
}

function getAttributeTexts(input) {
  const values = [];
  const accept = sanitizeText(input.getAttribute?.('accept') ?? '');
  if (accept) values.push(`accept: ${accept}`);
  values.push(`multiple: ${Boolean(input.multiple)}`);
  values.push(`required: ${Boolean(input.required || input.hasAttribute?.('required'))}`);

  const ariaLabel = input.getAttribute?.('aria-label');
  if (ariaLabel) values.push(`aria-label: ${sanitizeText(ariaLabel)}`);
  const title = input.getAttribute?.('title');
  if (title) values.push(`title: ${sanitizeText(title)}`);
  return values;
}

function getDescribedByTexts(input) {
  const documentRef = input.ownerDocument;
  const ids = (input.getAttribute?.('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return ids
    .map((id) => documentRef?.getElementById?.(id))
    .filter((element) => element && !isExcludedElement(element))
    .map((element) => safeVisibleText(element, { skipUnrelated: false }))
    .filter(Boolean);
}

function getAncestorTexts(input) {
  const values = [];
  let ancestor = input.parentElement;
  let depth = 0;
  while (ancestor && depth < 4) {
    if (ancestor !== input.ownerDocument?.body && ancestor !== input.ownerDocument?.documentElement) {
      addIfRelevant(values, safeVisibleText(ancestor, { skipUnrelated: true }));
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
    addIfRelevant(values, safeVisibleText(node, { skipUnrelated: true }));
  }
  return values;
}

function getAlertTexts(input) {
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
      addIfRelevant(values, safeVisibleText(node, { skipUnrelated: false }), { force: true });
    }
    ancestor = ancestor.parentElement;
    depth += 1;
  }
  return values;
}

function getSelectedText(selectedText) {
  const text = sanitizeText(selectedText);
  return text || null;
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

  const associatedTexts = uniqueTexts(getAssociatedTexts(input));
  const nearbyTexts = [
    ...getAttributeTexts(input),
    ...associatedTexts,
    ...getDescribedByTexts(input),
    ...getAncestorTexts(input),
    ...getAdjacentTexts(input)
  ];
  const alertTexts = getAlertTexts(input);
  const selected = getSelectedText(selectedText);
  const bounded = joinWithinLimit([...nearbyTexts, ...alertTexts, selected], CONTEXT_TEXT_LIMIT);

  return {
    uploaderId: options.uploaderId ?? getUploaderId(input),
    label: associatedTexts[0] ?? '',
    attributes: {
      accept: sanitizeText(input.getAttribute?.('accept') ?? '') || null,
      multiple: Boolean(input.multiple),
      required: Boolean(input.required || input.hasAttribute?.('required'))
    },
    selectedText: selected,
    nearbyTexts: uniqueTexts(nearbyTexts),
    alertTexts: uniqueTexts(alertTexts),
    normalizedText: bounded.text,
    truncated: bounded.truncated
  };
}

/** Select only rule-relevant sentences for a bounded future AI call. */
export function selectAiRelevantText(bundle) {
  return selectRelevantText(bundle?.normalizedText ?? '', AI_TEXT_LIMIT);
}
