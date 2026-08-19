import {
  extractRelevantContext,
  findAssociatedErrorNodes
} from '../dom/context-extractor.js';

export const CNIPA_HOST = 'ggfw-dlsks.cnipa.gov.cn';

const PHOTO_KEYWORD_PATTERN = /证件照|照片|电子件|免冠|彩照/;
const CONTENT_SELECTORS = ['.content', 'article', '.detail', '.main-content', '.el-main', 'main'];
const MIN_CONTAINER_CHARS = 20;
const WINDOW_BEFORE = 160;
const WINDOW_AFTER = 640;

function firstSubstantialContainer(documentRef) {
  for (const selector of CONTENT_SELECTORS) {
    let node = null;
    try {
      node = documentRef.querySelector?.(selector) ?? null;
    } catch {
      node = null;
    }
    const text = node?.innerText ?? node?.textContent ?? '';
    if (typeof text === 'string' && text.trim().length >= MIN_CONTAINER_CHARS) {
      return { node, text: text.trim() };
    }
  }
  return null;
}

/**
 * Real public guide page (国家知识产权局专利代理师考试系统公告).
 * The page is a Vue SPA: content is read from the rendered article container.
 * When the structure changes or no photo requirement is found, return null so
 * the UI safely stops and asks the user to select the requirement text.
 */
export function getCnipaPageRuleContext(documentRef) {
  if (!documentRef?.querySelector) return null;
  const container = firstSubstantialContainer(documentRef);
  if (!container) return null;
  const text = container.text.replace(/\s+/g, ' ').trim();
  const match = PHOTO_KEYWORD_PATTERN.exec(text);
  if (!match) return null;
  const start = Math.max(0, match.index - WINDOW_BEFORE);
  const end = Math.min(text.length, match.index + WINDOW_AFTER);
  return text.slice(start, end);
}

export const cnipaPublicGuideAdapter = Object.freeze({
  id: 'cnipa-public-guide',
  matches: (url) => typeof url === 'string' && url.includes(CNIPA_HOST),
  // 说明页没有原上传框：发现器刻意返回空，不伪造上传入口。
  discoverUploaders: () => [],
  extractContext: extractRelevantContext,
  findErrorNodes: findAssociatedErrorNodes,
  isAutoUpload: () => false,
  beforeInjection: () => undefined,
  afterInjection: () => undefined,
  getPageRuleContext: getCnipaPageRuleContext
});
