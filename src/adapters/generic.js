import { extractRelevantContext } from '../dom/context-extractor.js';
import { discoverUploaders } from '../dom/input-discovery.js';

const ERROR_SELECTOR = '[role="alert"], [aria-live], [data-error], .error, .invalid-feedback';

function findErrorNodes(input) {
  const nodes = [];
  let ancestor = input?.parentElement;
  let depth = 0;
  while (ancestor && depth < 4 && ancestor !== input.ownerDocument?.body) {
    nodes.push(...(ancestor.querySelectorAll?.(ERROR_SELECTOR) ?? []));
    ancestor = ancestor.parentElement;
    depth += 1;
  }
  return [...new Set(nodes)];
}

export const genericAdapter = Object.freeze({
  id: 'generic',
  matches: () => true,
  discoverUploaders,
  extractContext: extractRelevantContext,
  findErrorNodes,
  isAutoUpload: () => false,
  beforeInjection: () => undefined,
  afterInjection: () => undefined
});
