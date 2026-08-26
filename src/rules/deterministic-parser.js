import { ASPECT_RATIO_TOLERANCE, AUDIO_MAX_RULE_BYTES, CONTEXT_TEXT_LIMIT } from '../config.js';
import { createRuleCandidate } from './schema.js';
import { sanitizeEvidenceText } from '../utils/text.js';
import {
  normalizeAspectRatio,
  normalizeDimension,
  normalizeFormats,
  normalizeRuleText,
  toBytes
} from './normalizer.js';
import {
  extractSafetyFlags,
  OFFICIAL_TOOL_PATTERN
} from './safety-semantics.js';

const BYTE_PATTERN = /(\d+(?:[.,]\d+)?)\s*(mib|mb|m\b|kib|kb|k\b|字节|bytes?|b)(?=\s|$|[^a-z0-9])/gi;
const BYTE_RANGE_PATTERN = /(\d+(?:[.,]\d+)?)\s*(?:(mib|mb|m\b|kib|kb|k\b|字节|bytes?|b)\s*)?(?:-|至|到)\s*(\d+(?:[.,]\d+)?)\s*(mib|mb|m\b|kib|kb|k\b|字节|bytes?|b)(?=\s|$|[^a-z0-9])/i;
const FILE_TOKEN_DELIMITER = /[\s"'“”‘’()[\]{}（）,，;；:：。!！？]/;
const FILE_TOKEN_EXTENSION = /\.(?:jpg|jpeg|png|webp|mp3|m4a|aac|wav|webm)(?:[?#][^\s]*)?\.?$/i;
const DIMENSION_PAIR_PATTERN = /(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)(?:\s*(像素|px|厘米|公分|毫米|英寸|寸|cm|mm|inch|in))?/gi;
const AXIS_PATTERN = /(宽(?:度)?|高(?:度)?)\s*(?:[:：]\s*)?(?:(不低于|至少|不超过|最多|最低|最高|>=|<=|≥|≤)\s*)?(\d+(?:[.,]\d+)?)(?:\s*(?:至|到|-)\s*(\d+(?:[.,]\d+)?))?(?:\s*(?:像素|px))?/gi;
const FORMAT_PATTERN = /(?:image\/(?:jpeg|png|webp)|audio\/(?:mpeg|mp3|mp4|aac|wav|x-wav|webm)|\.?\b(?:jpg|jpeg|png|webp|mp3|m4a|aac|wav|webm)\b)/gi;
const RATIO_PATTERN = /(?:宽高比|比例)\s*(?:为|是|=|:)?\s*(\d+(?:[.,]\d+)?)\s*[:\/]\s*(\d+(?:[.,]\d+)?)/i;
const DIMENSION_QUALIFIER = /(?:不低于|至少|最低|>=|≥)/;
const MAX_DIMENSION_QUALIFIER = /(?:不超过|最多|最高|<=|≤)/;
const ADVISORY_PATTERN = /建议|推荐|最好|尽量/;
const FORMAT_ALLOW_CONTEXT = /支持|允许|仅|只|格式|请使用|上传|图片|图像|照片|证件照|头像|封面|扫描件|音频|录音|转写|mp3|m4a|aac|wav|建议|推荐|最好|尽量/;
const AUDIO_FORMAT_CONTEXT = /音频|录音|转写|声音|mp3|m4a|aac|wav|audio/i;
const VIDEO_ONLY_CONTEXT = /视频|video|电影|画面/i;
const FORMAT_NEGATIVE_PREFIX_CONTEXT = /(?:不支持|不允许|禁止(?:使用)?|禁用|不能(?:使用|用)?|拒绝|不接受|不接收|排除)\s*$/;
const FORMAT_NEGATIVE_SUFFIX_CONTEXT = /^\s*(?:等)?[\s,，、]*(?:(?:图片|图像)?格式)?\s*(?:不支持|不允许|禁止(?:使用)?|禁用|不能(?:使用|用)?|拒绝|不接受|不接收|排除)/;
const FORMAT_EXAMPLE_CONTEXT = /示例|样例|文件名|文件路径|路径|下载|链接|网址|\burl\b|\b(?:avatar|photo|image|file|record|audio)[-_\w]*\.(?:jpg|jpeg|png|webp|mp3|m4a|aac|wav)\b/i;
const FORMAT_LIST_NEGATED_SUFFIX = /(?:等)?\s*(?:图片|图像)?格式\s*(?:不支持|不允许|禁止(?:使用)?|禁用|不能(?:使用|用)?|拒绝|不接受|不接收|排除)/;
const BYTE_MIN_QUALIFIER = /(?:至少|不低于|大于|最低|最小|>=|≥|at\s+least|minimum|\bmin\b)/i;
const BYTE_MAX_QUALIFIER = /(?:最多|不超过|不能超过|不得|小于|低于|最高|最大|上限|限制|max(?:imum)?|up\s+to|under|no\s+more\s+than|must\s+not\s+exceed|exceeds?|too\s+large|limit|<=|≤)/i;
const PHYSICAL_DIMENSION_UNIT = /^(?:厘米|公分|毫米|英寸|寸|cm|mm|inch|in)$/i;
const PIXEL_DIMENSION_UNIT = /^(?:像素|px)$/i;
const DIMENSION_PAIR_CONTEXT = /(?:图片|图像|照片|证件照|头像)?\s*(?:尺寸|像素尺寸|宽高)|(?:不低于|至少|最低|不超过|最多|最高|>=|<=|≥|≤)\s*$/;
const DURATION_PATTERN = /(\d+(?:[.,]\d+)?)\s*(milliseconds?|msecs?|ms|seconds?|secs?|sec|s|minutes?|mins?|min|hours?|hrs?|hr|h|毫秒|秒|分钟|分|小时|时)(?=\s|$|[^a-z0-9])/gi;
const DURATION_RULE_CONTEXT = /(?:时长|长度|录音|音频|时间|上限|限制|duration|length|audio|recording|time\s+limit)/i;
const DURATION_MAX_QUALIFIER = /(?:不超过|最多|最高|<=|≤|小于|max(?:imum)?|up\s+to|under|no\s+more\s+than|must\s+not\s+exceed|not\s+exceed|exceeds?|limit)/i;
const SAMPLE_RATE_PATTERN = /(\d+(?:[.,]\d+)?)\s*(khz|赫兹|hz)/gi;
const CHANNEL_PATTERN = /(?:单声道|单通道|mono|1\s*声道|1\s*通道|双声道|双通道|stereo|2\s*声道|2\s*通道)/gi;
const BIT_DEPTH_PATTERN = /(\d+)\s*位(?:深度)?/gi;

function emptyRules() {
  return {
    mediaKind: null,
    formats: [],
    extensions: [],
    minBytes: null,
    maxBytes: null,
    duration: { exactMs: null, minMs: null, maxMs: null },
    audio: { sampleRates: [], channels: [], bitDepths: [] },
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
    || Object.values(rules.duration).some((value) => value !== null)
    || Object.values(rules.audio).some((value) => value.length > 0)
    || Object.values(rules.width).some((value) => value !== null)
    || Object.values(rules.height).some((value) => value !== null)
    || rules.aspectRatio !== null
    || rules.dpi !== null
    || rules.count.max !== null
    || rules.background !== null
    || rules.semanticRequirements.length > 0;
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
  const negatedSuffix = text.match(FORMAT_LIST_NEGATED_SUFFIX);
  if (negatedSuffix && !/(?:支持|允许|请使用)/.test(text.slice(
    (negatedSuffix.index ?? 0) + negatedSuffix[0].length
  ))) return;
  const tokens = matches
    .filter((match) => {
      const prefix = text.slice(Math.max(0, match.index - 16), match.index);
      const suffixStart = match.index + match[0].length;
      const suffix = text.slice(suffixStart, suffixStart + 16);
      return !FORMAT_NEGATIVE_PREFIX_CONTEXT.test(prefix)
        && !FORMAT_NEGATIVE_SUFFIX_CONTEXT.test(suffix);
    })
    .map((match) => match[0]);
  if (!tokens.length) return;
  const normalizedTokens = normalizeFormats(tokens);
  if (normalizedTokens.mediaKind === 'audio'
    && (!AUDIO_FORMAT_CONTEXT.test(text)
      || (VIDEO_ONLY_CONTEXT.test(text) && !AUDIO_FORMAT_CONTEXT.test(text)))) return;
  const residual = text
    .replace(FORMAT_PATTERN, '')
    .replace(/[\s,，、/或和及&|:：()（）.[\]-]+/g, '')
    .trim();
  if (residual && !FORMAT_ALLOW_CONTEXT.test(text)) return;
  const formats = normalizedTokens;
  rules.mediaKind = formats.mediaKind === 'audio' ? 'audio' : formats.mediaKind === 'image' ? 'image' : null;
  rules.formats.push(...formats.formats.filter((value) => !rules.formats.includes(value)));
  rules.extensions.push(...formats.extensions.filter((value) => !rules.extensions.includes(value)));
}

function matchInsideFilenameToken(text, index, length) {
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(length) || length <= 0) return false;
  let start = index;
  let end = index + length;
  while (start > 0 && !FILE_TOKEN_DELIMITER.test(text[start - 1])) start -= 1;
  while (end < text.length && !FILE_TOKEN_DELIMITER.test(text[end])) end += 1;
  const token = text.slice(start, end);
  return token.length <= 180 && FILE_TOKEN_EXTENSION.test(token);
}

function parseBytes(text, rules, audioContext = false) {
  const byteLimit = audioContext || AUDIO_FORMAT_CONTEXT.test(text) ? AUDIO_MAX_RULE_BYTES : undefined;
  const shorthandRange = text.match(BYTE_RANGE_PATTERN);
  if (shorthandRange && !matchInsideFilenameToken(
    text,
    shorthandRange.index ?? -1,
    shorthandRange[0].length
  )) {
    const firstUnit = shorthandRange[2] ?? shorthandRange[4];
    const secondUnit = shorthandRange[4] ?? shorthandRange[2];
    rules.minBytes = toBytes(shorthandRange[1], firstUnit, 'min', byteLimit);
    rules.maxBytes = toBytes(shorthandRange[3], secondUnit, 'max', byteLimit);
    return;
  }

  const matches = [...text.matchAll(BYTE_PATTERN)].filter((match) => !matchInsideFilenameToken(
    text,
    match.index ?? -1,
    match[0].length
  ));
  if (matches.length >= 2 && /(?:-|至|到)/.test(text.slice(matches[0].index + matches[0][0].length, matches[1].index))) {
    rules.minBytes = toBytes(matches[0][1], matches[0][2], 'min', byteLimit);
    rules.maxBytes = toBytes(matches[1][1], matches[1][2], 'max', byteLimit);
    return;
  }

  for (const match of matches) {
    const prefix = text.slice(Math.max(0, match.index - 48), match.index);
    const suffixStart = match.index + match[0].length;
    const suffix = text.slice(suffixStart, suffixStart + 32);
    const isMin = BYTE_MIN_QUALIFIER.test(prefix) || BYTE_MIN_QUALIFIER.test(suffix);
    const isMax = BYTE_MAX_QUALIFIER.test(prefix) || BYTE_MAX_QUALIFIER.test(suffix);
    if (isMin) rules.minBytes = toBytes(match[1], match[2], 'min', byteLimit);
    if (isMax) rules.maxBytes = toBytes(match[1], match[2], 'max', byteLimit);
  }
}

function parseDuration(text, rules, audioContext = false) {
  for (const match of text.matchAll(DURATION_PATTERN)) {
    const prefix = text.slice(Math.max(0, match.index - 64), match.index);
    const suffixStart = match.index + match[0].length;
    const suffix = text.slice(suffixStart, suffixStart + 24);
    const maxQualified = DURATION_MAX_QUALIFIER.test(prefix) || DURATION_MAX_QUALIFIER.test(suffix);
    if (!DURATION_RULE_CONTEXT.test(`${prefix}${suffix}`) && !maxQualified) continue;
    const value = Number.parseFloat(match[1].replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = match[2].toLowerCase();
    const multiplier = /毫秒|^m(?:illi)?s(?:ec(?:ond)?s?)?$/.test(unit)
      ? 1
      : /秒|^s$|^sec(?:ond)?s?$/.test(unit)
        ? 1000
        : /分钟|^分$|^min(?:ute)?s?$/.test(unit)
          ? 60_000
          : 3_600_000;
    const duration = Math.round(value * multiplier);
    if (!Number.isSafeInteger(duration) || duration <= 0) continue;
    if (maxQualified) {
      rules.duration.maxMs = duration;
    }
    else rules.duration.exactMs = duration;
  }
}

function parseAudioConstraints(text, rules) {
  for (const match of text.matchAll(SAMPLE_RATE_PATTERN)) {
    const value = Number.parseFloat(match[1].replace(',', '.'));
    const rate = /khz/i.test(match[2]) ? Math.round(value * 1000) : Math.round(value);
    if (Number.isInteger(rate) && rate > 0 && rate <= 384000 && !rules.audio.sampleRates.includes(rate)) {
      rules.audio.sampleRates.push(rate);
    }
  }
  for (const match of text.matchAll(CHANNEL_PATTERN)) {
    const token = match[0].toLowerCase();
    const channels = /双|stereo|2/.test(token) ? 2 : 1;
    if (!rules.audio.channels.includes(channels)) rules.audio.channels.push(channels);
  }
  for (const match of text.matchAll(BIT_DEPTH_PATTERN)) {
    const depth = Number.parseInt(match[1], 10);
    if (depth > 0 && depth <= 64 && !rules.audio.bitDepths.includes(depth)) {
      rules.audio.bitDepths.push(depth);
    }
  }
}

function parseDimensions(text, rules) {
  for (const match of text.matchAll(DIMENSION_PAIR_PATTERN)) {
    const prefix = text.slice(Math.max(0, match.index - 16), match.index);
    const suffixStart = match.index + match[0].length;
    const suffix = text.slice(suffixStart, suffixStart + 12);
    const unit = match[3] ?? '';
    if (PHYSICAL_DIMENSION_UNIT.test(unit)) continue;
    const hasPixelMeaning = PIXEL_DIMENSION_UNIT.test(unit)
      || DIMENSION_PAIR_CONTEXT.test(prefix)
      || /^\s*(?:像素|px)\b/i.test(suffix);
    if (!hasPixelMeaning || /(?:显示|屏幕|预览).{0,8}(?:最佳|推荐|建议)/.test(`${prefix}${suffix}`)) {
      continue;
    }
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
  if (OFFICIAL_TOOL_PATTERN.test(text)) rules.semanticRequirements.push('必须使用官方工具');
  if (/原始录音|证据原件|原文件/.test(text)) rules.semanticRequirements.push('原始录音');
  if (/无损(?:音频|录音|WAV)?|lossless/i.test(text)) rules.semanticRequirements.push('无损音频');
  rules.semanticRequirements = [...new Set(rules.semanticRequirements)];
}

function parseDpi(text, rules) {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*dpi/i);
  if (match) rules.dpi = Number.parseFloat(match[1].replace(',', '.'));
}

function parseClause(clause, sourceType, sentenceSafetyFlags, audioContext = false) {
  const evidence = sanitizeEvidenceText(clause);
  const text = normalizeRuleText(evidence);
  if (!text) return null;
  const rules = emptyRules();
  parseFormats(text, rules);
  parseBytes(text, rules, audioContext);
  if (audioContext && !rules.mediaKind) rules.mediaKind = 'audio';
  parseDuration(text, rules, audioContext);
  parseAudioConstraints(text, rules);
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

function parseText(text, sourceType, inheritedAudioContext = false) {
  const safeText = sanitizeEvidenceText(text);
  if (!safeText) return [];
  const candidates = [];
  for (const sentence of safeText.split(/[。！？!?]+/).filter(Boolean)) {
    const safetyFlags = extractSafetyFlags(normalizeRuleText(sentence));
    const audioContext = inheritedAudioContext || AUDIO_FORMAT_CONTEXT.test(sentence);
    for (const clause of sentence.split(/[，,；;]/).filter(Boolean)) {
      const candidate = parseClause(clause, sourceType, safetyFlags, audioContext);
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
  const audioWildcard = tokens.some((token) => /^audio\/\*$/i.test(token));
  const imageWildcard = tokens.some((token) => /^image\/\*$/i.test(token));
  if (!formats.formats.length && !audioWildcard) return null;
  const safeAccept = sanitizeEvidenceText(accept);
  return createRuleCandidate({
    sourceType: 'html-attribute',
    evidence: [`accept: ${safeAccept}`],
    confidence: 0.95,
    rules: {
      ...emptyRules(),
      mediaKind: (audioWildcard && !imageWildcard) || formats.mediaKind === 'audio'
        ? 'audio'
        : formats.mediaKind === 'image' ? 'image' : null,
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
  const audioContext = acceptCandidate?.rules?.mediaKind === 'audio';

  const bounded = getBoundedSourceTexts(context);
  for (const text of bounded.nearby) candidates.push(...parseText(text, 'nearby-text', audioContext));
  for (const text of bounded.alert) candidates.push(...parseText(text, 'rejection', audioContext));
  for (const text of bounded.selected) candidates.push(...parseText(text, 'selected-text', audioContext));
  return candidates;
}
