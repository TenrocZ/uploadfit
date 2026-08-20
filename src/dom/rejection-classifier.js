import { parseRulesDeterministically } from '../rules/deterministic-parser.js';
import { extractSafetyFlags } from '../rules/safety-semantics.js';
import { sanitizeEvidenceText } from '../utils/text.js';

const MAX_REJECTION_TEXT = 600;

const REJECTION_SIGNAL = /(?:拒绝|支持|不符合|不支持|不允许|无法上传|上传失败|上传不成功|提交失败|验证失败|格式错误|尺寸错误|大小错误|必须|要求|限制|超过|低于|少于|不低于|不超过|需为|应为|请上传|请选择)/i;
const FILE_SEMANTIC = /(?:文件|图片|图像|照片|证件照|头像|封面|扫描件|格式|类型|大小|容量|像素|尺寸|宽|高|比例|分辨率|dpi|jpg|jpeg|png|webp|image|photo)/i;
const AMBIGUOUS_FAILURE = /(?:上传失败|上传不成功|文件不合法|未知错误|服务异常|系统繁忙|操作失败|网络|超时|权限|登录|审核|内容不符合|图片不清晰|清晰度|身份不一致|官方工具)/i;

function structuredRule(candidate) {
  if (!candidate || candidate.advisoryOnly) return false;
  const rules = candidate.rules ?? {};
  return Boolean(
    rules.formats?.length
    || rules.extensions?.length
    || Number.isFinite(rules.minBytes)
    || Number.isFinite(rules.maxBytes)
    || Object.values(rules.width ?? {}).some((value) => Number.isFinite(value))
    || Object.values(rules.height ?? {}).some((value) => Number.isFinite(value))
    || rules.aspectRatio
    || rules.count?.max
  );
}

function safeContext(text) {
  return {
    uploaderId: '',
    label: '',
    attributes: { accept: null, multiple: false, required: false },
    selectedText: null,
    nearbyTexts: [],
    alertTexts: [text],
    normalizedText: text,
    truncated: false
  };
}

/**
 * Classify only local, DOM-derived rejection text. It does not inspect
 * requests or page state outside the supplied text.
 */
export function classifyRejectionText(value, { parseRules = parseRulesDeterministically } = {}) {
  const text = sanitizeEvidenceText(value).slice(0, MAX_REJECTION_TEXT);
  if (!text) {
    return {
      kind: 'irrelevant',
      text: '',
      candidates: [],
      reason: 'EMPTY'
    };
  }

  const candidates = typeof parseRules === 'function'
    ? parseRules(safeContext(text)).filter(structuredRule)
    : [];
  const hasFileSemantics = FILE_SEMANTIC.test(text);
  const hasRejectionSignal = REJECTION_SIGNAL.test(text);
  const hasSafetyStop = extractSafetyFlags(text).length > 0;
  const isAmbiguousFailure = AMBIGUOUS_FAILURE.test(text);

  if (hasSafetyStop) {
    return {
      kind: 'ambiguous',
      text,
      candidates,
      reason: 'SAFETY_OR_SYSTEM_SEMANTIC'
    };
  }

  if (hasFileSemantics && hasRejectionSignal && candidates.length > 0) {
    return {
      kind: 'explicit',
      text,
      candidates,
      reason: 'STRUCTURED_FILE_RULE'
    };
  }

  if (isAmbiguousFailure || (hasFileSemantics && hasRejectionSignal)) {
    return {
      kind: 'ambiguous',
      text,
      candidates,
      reason: candidates.length ? 'RULE_NOT_SAFE_TO_AUTOMATE' : 'NO_STRUCTURED_RULE'
    };
  }

  return {
    kind: 'irrelevant',
    text,
    candidates,
    reason: 'NO_REJECTION_SIGNAL'
  };
}

export function isExplicitRejection(value, options = {}) {
  return classifyRejectionText(value, options).kind === 'explicit';
}

export { structuredRule };
