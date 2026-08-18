import { ASPECT_RATIO_TOLERANCE, CONTEXT_TEXT_LIMIT } from '../config.js';
import { createRuleCandidate } from './schema.js';
import { sanitizeEvidenceText } from '../utils/text.js';
import {
  normalizeAspectRatio,
  normalizeDimension,
  normalizeFormats,
  normalizeRuleText,
  toBytes
} from './normalizer.js';

const BYTE_PATTERN = /(\d+(?:[.,]\d+)?)\s*(mb|m\b|kb|k\b|b)\b/gi;
const DIMENSION_PAIR_PATTERN = /(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)(?:\s*(?:像素|px))?/gi;
const AXIS_PATTERN = /(宽(?:度)?|高(?:度)?)\s*(?:(不低于|至少|不超过|最多|最低|最高|>=|<=|≥|≤)\s*)?(\d+(?:[.,]\d+)?)(?:\s*(?:至|到|-)\s*(\d+(?:[.,]\d+)?))?(?:\s*(?:像素|px))?/gi;
const FORMAT_PATTERN = /(?:image\/(?:jpeg|png|webp)|\.?\b(?:jpg|jpeg|png|webp)\b)/gi;
const RATIO_PATTERN = /(?:宽高比|比例)\s*(?:为|是|=|:)?\s*(\d+(?:[.,]\d+)?)\s*[:\/]\s*(\d+(?:[.,]\d+)?)/i;
const DIMENSION_QUALIFIER = /(?:不低于|至少|最低|>=|≥)/;
const MAX_DIMENSION_QUALIFIER = /(?:不超过|最多|最高|<=|≤)/;
const ADVISORY_PATTERN = /建议|推荐|最好|尽量/;
const FORMAT_ALLOW_CONTEXT = /支持|允许|仅|只|格式|请使用|上传|图片|图像|照片|证件照|头像|封面|扫描件|建议|推荐|最好|尽量/;
const FORMAT_NEGATIVE_CONTEXT = /(?:不支持|不允许|禁止|不能(?:使用|用)?|拒绝|不接受|不接收|排除)\s*$/;
const FORMAT_EXAMPLE_CONTEXT = /示例|样例|文件名|文件路径|路径|下载|链接|网址|\burl\b|\b(?:avatar|photo|image|file)[-_\w]*\.(?:jpg|jpeg|png|webp)\b/i;
const STOP_SEMANTICS = [
  ['SYSTEM_BUSY', /系统繁忙/],
  ['NETWORK_OR_TIMEOUT', /网络|超时/],
  ['PERMISSION_OR_LOGIN', /权限|登录/],
  ['REVIEW_REJECTED', /审核不通过/],
  ['OFFICIAL_TOOL_REQUIRED', /官方工具/]
];

function emptyRules() {
  return {
    formats: [],
    extensions: [],
    minBytes: null,
    maxBytes: null,
    width: { exact: null, min: null, max: null },
    height: { exact: null, min: null, max: null },
    aspectRatio: null,
    dpi: null,
    count: { max: null },
    background: null,
    semanticRequirements: []
  };
}

function hasRules(rules) {
  return rules.formats.length > 0
    || rules.extensions.length > 0
    || rules.minBytes !== null
    || rules.maxBytes !== null
    || Object.values(rules.width).some((value) => value !== null)
    || Object.values(rules.height).some((value) => value !== null)
    || rules.aspectRatio !== null
    || rules.dpi !== null
    || rules.count.max !== null
    || rules.background !== null
    || rules.semanticRequirements.length > 0;
}

function extractSafetyFlags(text) {
  return STOP_SEMANTICS
    .filter(([, pattern]) => pattern.test(text))
    .map(([flag]) => flag);
}

function assignDimension(rule, qualifier, first, second) {
  const firstValue = normalizeDimension(first);
  const secondValue = second === undefined ? null : normalizeDimension(second);
  if (!firstValue) return;
  if (secondValue) {
    rule.min = firstValue;
    rule.max = secondValue;
  } else if (qualifier && DIMENSION_QUALIFIER.test(qualifier)) {
    rule.min = firstValue;
  } else if (qualifier && MAX_DIMENSION_QUALIFIER.test(qualifier)) {
    rule.max = firstValue;
  } else {
    rule.exact = firstValue;
  }
}

function parseFormats(text, rules) {
  const matches = [...text.matchAll(FORMAT_PATTERN)];
  if (!matches.length || FORMAT_EXAMPLE_CONTEXT.test(text)) return;
  const tokens = matches
    .filter((match) => {
      const prefix = text.slice(Math.max(0, match.index - 16), match.index);
      return !FORMAT_NEGATIVE_CONTEXT.test(prefix);
    })
    .map((match) => match[0]);
  if (!tokens.length) return;
  const residual = text
    .replace(FORMAT_PATTERN, '')
    .replace(/[\s,，、/或和及&|:：()（）.[\]-]+/g, '')
    .trim();
  if (residual && !FORMAT_ALLOW_CONTEXT.test(text)) return;
  const formats = normalizeFormats(tokens);
  rules.formats.push(...formats.formats.filter((value) => !rules.formats.includes(value)));
  rules.extensions.push(...formats.extensions.filter((value) => !rules.extensions.includes(value)));
}

function parseBytes(text, rules) {
  const matches = [...text.matchAll(BYTE_PATTERN)];
  if (matches.length >= 2 && /(?:-|至|到)/.test(text.slice(matches[0].index + matches[0][0].length, matches[1].index))) {
    rules.minBytes = toBytes(matches[0][1], matches[0][2], 'min');
    rules.maxBytes = toBytes(matches[1][1], matches[1][2], 'max');
    return;
  }

  for (const match of matches) {
    const prefix = text.slice(Math.max(0, match.index - 18), match.index);
    const isMin = /至少|不低于|大于|最低|最小|>=|≥/.test(prefix);
    const isMax = /最多|不超过|不得|小于|低于|最高|最大|max|<=|≤/.test(prefix);
    if (isMin) rules.minBytes = toBytes(match[1], match[2], 'min');
    if (isMax) rules.maxBytes = toBytes(match[1], match[2], 'max');
  }
}

function parseDimensions(text, rules) {
  for (const match of text.matchAll(DIMENSION_PAIR_PATTERN)) {
    const prefix = text.slice(Math.max(0, match.index - 16), match.index);
    const qualifier = prefix.match(/(?:不低于|至少|不超过|最多|最低|最高|>=|<=|≥|≤)\s*$/)?.[0] ?? '';
    assignDimension(rules.width, qualifier, match[1]);
    assignDimension(rules.height, qualifier, match[2]);
  }

  for (const match of text.matchAll(AXIS_PATTERN)) {
    const rule = match[1].startsWith('宽') ? rules.width : rules.height;
    assignDimension(rule, match[2], match[3], match[4]);
  }
}

function parseRatio(text, rules) {
  const match = text.match(RATIO_PATTERN);
  if (match) rules.aspectRatio = normalizeAspectRatio(match[1], match[2]);
}

function parseCount(text, rules) {
  if (/(?:单文件|一张|一份|仅可上传一张|只可上传一张)/.test(text)) {
    rules.count.max = 1;
    return;
  }
  const match = text.match(/最多\s*(\d+(?:[.,]\d+)?)\s*(?:张|个|份|file)?/i);
  if (match) rules.count.max = Math.max(1, Math.round(Number.parseFloat(match[1])));
}

function parseSemantics(text, rules) {
  if (/蓝底|蓝色背景/.test(text)) {
    rules.background = 'blue';
    rules.semanticRequirements.push('蓝色背景');
  }
  if (/免冠/.test(text)) rules.semanticRequirements.push('免冠');
  if (/近期/.test(text)) rules.semanticRequirements.push('近期照片');
  if (/清晰/.test(text)) rules.semanticRequirements.push('清晰');
  if (/不得拉伸|不能拉伸|不要拉伸/.test(text)) rules.semanticRequirements.push('不得拉伸');
  if (/文件名.*(?:含|包含).*(?:姓名|身份证)/.test(text)) {
    rules.semanticRequirements.push('文件名需包含姓名和身份证号');
  }
  if (/官方工具/.test(text)) rules.semanticRequirements.push('必须使用官方工具');
  rules.semanticRequirements = [...new Set(rules.semanticRequirements)];
}

function parseDpi(text, rules) {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*dpi/i);
  if (match) rules.dpi = Number.parseFloat(match[1].replace(',', '.'));
}

function parseClause(clause, sourceType, sentenceSafetyFlags) {
  const evidence = sanitizeEvidenceText(clause);
  const text = normalizeRuleText(evidence);
  if (!text) return null;
  const rules = emptyRules();
  parseFormats(text, rules);
  parseBytes(text, rules);
  parseDimensions(text, rules);
  parseRatio(text, rules);
  parseCount(text, rules);
  parseDpi(text, rules);
  parseSemantics(text, rules);
  if (!hasRules(rules) && sentenceSafetyFlags.length === 0) return null;

  const advisoryOnly = ADVISORY_PATTERN.test(text);
  return createRuleCandidate({
    sourceType,
    evidence: [evidence],
    confidence: advisoryOnly ? 0.75 : 0.90,
    rules,
    advisoryOnly,
    safetyFlags: sentenceSafetyFlags
  });
}

function parseText(text, sourceType) {
  const safeText = sanitizeEvidenceText(text);
  if (!safeText) return [];
  const candidates = [];
  for (const sentence of safeText.split(/[。！？!?]+/).filter(Boolean)) {
    const safetyFlags = extractSafetyFlags(normalizeRuleText(sentence));
    for (const clause of sentence.split(/[，,；;]/).filter(Boolean)) {
      const candidate = parseClause(clause, sourceType, safetyFlags);
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function appendBoundedSource(values, state) {
  const bounded = [];
  for (const value of [...new Set(values.map(sanitizeEvidenceText).filter(Boolean))]) {
    const separatorLength = state.hasText ? 1 : 0;
    const available = CONTEXT_TEXT_LIMIT - state.used - separatorLength;
    if (available <= 0) break;
    const chunk = value.slice(0, available);
    bounded.push(chunk);
    state.used += separatorLength + chunk.length;
    state.hasText = true;
    if (chunk.length < value.length) break;
  }
  return bounded;
}

function getBoundedSourceTexts(context) {
  const state = { used: 0, hasText: false };
  const hasStructuredText = (Array.isArray(context.nearbyTexts) && context.nearbyTexts.length > 0)
    || (Array.isArray(context.alertTexts) && context.alertTexts.length > 0)
    || Boolean(context.selectedText);
  const nearby = hasStructuredText
    ? appendBoundedSource(context.nearbyTexts ?? [], state)
    : appendBoundedSource([context.normalizedText ?? ''], state);
  const alert = appendBoundedSource(context.alertTexts ?? [], state);
  const selected = appendBoundedSource(
    context.selectedText ? [context.selectedText] : [],
    state
  );
  return { nearby, alert, selected };
}

function parseAcceptAttribute(accept) {
  if (typeof accept !== 'string') return null;
  const tokens = accept.split(',').map((token) => token.trim()).filter(Boolean);
  const formats = normalizeFormats(tokens);
  if (!formats.formats.length) return null;
  const safeAccept = sanitizeEvidenceText(accept);
  return createRuleCandidate({
    sourceType: 'html-attribute',
    evidence: [`accept: ${safeAccept}`],
    confidence: 0.95,
    rules: {
      ...emptyRules(),
      formats: formats.formats,
      extensions: formats.extensions
    }
  });
}

/** Parse only trusted, already bounded ContextBundle text. */
export function parseRulesDeterministically(context = {}) {
  const candidates = [];
  const acceptCandidate = parseAcceptAttribute(context.attributes?.accept);
  if (acceptCandidate) candidates.push(acceptCandidate);

  const bounded = getBoundedSourceTexts(context);
  candidates.push(...parseText(bounded.nearby.join(' '), 'nearby-text'));
  candidates.push(...parseText(bounded.alert.join(' '), 'rejection'));
  candidates.push(...parseText(bounded.selected.join(' '), 'selected-text'));
  return candidates;
}
