import {
  extractRelevantContext,
  findAssociatedErrorNodes
} from '../dom/context-extractor.js';
import { discoverUploaders } from '../dom/input-discovery.js';

export const genericAdapter = Object.freeze({
  id: 'generic',
  matches: () => true,
  discoverUploaders,
  extractContext: extractRelevantContext,
  findErrorNodes: findAssociatedErrorNodes,
  isAutoUpload: () => false,
  beforeInjection: () => undefined,
  afterInjection: () => undefined
});
