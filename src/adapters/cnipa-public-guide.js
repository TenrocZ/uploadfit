import {
  extractRelevantContext,
  findAssociatedErrorNodes
} from '../dom/context-extractor.js';

export const CNIPA_HOST = 'ggfw-dlsks.cnipa.gov.cn';

const CONTENT_SELECTORS = ['.content', 'article', '.detail', '.main-content', '.el-main', 'main'];
const TARGET_SECTION_PATTERN = /(?:（|\()\s*2\s*(?:）|\))\s*电子件要求\s*[：:]/i;
const TARGET_FALLBACK_PATTERN = /电子件要求\s*[：:]/i;
const NEXT_SECTION_PATTERN = /(?:（|\()\s*[3-9]\s*(?:）|\))|登录(?:考试)?系统|报名(?:考试)?系统|注册(?:页面|账号)/i;
const SAFE_NEARBY_SEMANTICS = /蓝底|蓝色背景|不得严重拉伸|不得拉伸|不能拉伸|不要拉伸/gi;
const MIN_CONTAINER_CHARS = 20;

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

function normalizePageText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function textOf(node) {
  return normalizePageText(node?.innerText ?? node?.textContent ?? '');
}

function targetBlocks(container) {
  const nodes = [container.node, ...container.node.querySelectorAll?.(
    'p,li,tr,td,section,article,div'
  ) ?? []];
  return nodes
    .map((node) => ({ node, text: textOf(node) }))
    .filter(({ text }) => TARGET_SECTION_PATTERN.test(text) || TARGET_FALLBACK_PATTERN.test(text))
    .sort((left, right) => left.text.length - right.text.length);
}

function extractTargetSection(text) {
  const marker = TARGET_SECTION_PATTERN.exec(text) ?? TARGET_FALLBACK_PATTERN.exec(text);
  if (!marker) return null;
  const start = marker.index;
  const remainder = text.slice(start + marker[0].length);
  const next = NEXT_SECTION_PATTERN.exec(remainder);
  const end = next ? next.index : remainder.length;
  const target = text.slice(start, start + marker[0].length + end).trim();
  if (!target) return null;

  const nearby = text.slice(Math.max(0, start - 240), Math.min(text.length, start + marker[0].length + end + 240));
  const semantics = [...nearby.matchAll(SAFE_NEARBY_SEMANTICS)]
    .map((match) => match[0])
    .filter((value, index, values) => values.indexOf(value) === index && !target.includes(value));
  return [target, ...semantics].join('；');
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
  const blocks = targetBlocks(container);
  for (const block of blocks) {
    const context = extractTargetSection(block.text);
    if (context) return context;
  }
  const fallback = extractTargetSection(container.text);
  if (fallback) return fallback;
  return null;
}

export const cnipaPublicGuideAdapter = Object.freeze({
  id: 'cnipa-public-guide',
  matches: (url) => {
    if (typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
      return parsed.hostname.toLowerCase() === CNIPA_HOST
        && pathname === '/home_item_Text_details';
    } catch {
      return false;
    }
  },
  // 说明页没有原上传框：发现器刻意返回空，不伪造上传入口。
  discoverUploaders: () => [],
  extractContext: extractRelevantContext,
  findErrorNodes: findAssociatedErrorNodes,
  isAutoUpload: () => false,
  beforeInjection: () => undefined,
  afterInjection: () => undefined,
  getPageRuleContext: getCnipaPageRuleContext
});
