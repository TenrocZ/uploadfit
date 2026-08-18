const SENSITIVE_VALUE_PATTERN = /(?:password|passwd|pwd|密码|口令|token|cookie|session|authorization|bearer|secret|api[_-]?key|captcha|验证码|校验码|短信码|密钥)\s*[:=：]\s*[^\s,;，；]+/gi;
const URL_PATTERN = /\bhttps?:\/\/[^\s]+/gi;
const RELEVANT_CONTEXT_PATTERN = /(?:上传|选择|拖拽|图片|图像|照片|证件照|头像|封面|扫描件|格式|类型|文件|大小|宽|高|像素|尺寸|比例|dpi|清晰|背景|免冠|拉伸|建议|推荐|必须|仅|只|不得|不能|至少|最多|不超过|不低于|失败|不合法|繁忙|网络|超时|权限|登录|审核|官方工具|jpg|jpeg|png|webp|image|photo|portrait|avatar|cover|scan|\d|KB|MB|M\b|px)/i;

export function normalizeText(value) {
  if (typeof value !== 'string') return '';
  const normalized = typeof value.normalize === 'function'
    ? value.normalize('NFKC')
    : value;
  return normalized
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeText(value) {
  return normalizeText(value)
    .replace(URL_PATTERN, '')
    .replace(SENSITIVE_VALUE_PATTERN, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
}

export function uniqueTexts(values) {
  return [...new Set(values.map(sanitizeText).filter(Boolean))];
}

export function isRuleRelevantText(value) {
  return RELEVANT_CONTEXT_PATTERN.test(sanitizeText(value));
}

export function splitSentences(value) {
  return sanitizeText(value)
    .split(/[。！？!?；;\n]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function joinWithinLimit(values, limit) {
  const maxLength = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : 0;
  const chunks = uniqueTexts(values);
  let text = '';
  let truncated = false;

  for (const chunk of chunks) {
    const candidate = text ? `${text}\n${chunk}` : chunk;
    if (candidate.length <= maxLength) {
      text = candidate;
      continue;
    }
    const remaining = Math.max(0, maxLength - text.length - (text ? 1 : 0));
    if (remaining > 0) text += `${text ? '\n' : ''}${chunk.slice(0, remaining)}`;
    truncated = true;
    break;
  }

  return { text, truncated };
}

export function selectRelevantText(value, limit) {
  const sentences = splitSentences(value).filter(isRuleRelevantText);
  return joinWithinLimit(sentences, limit).text;
}
