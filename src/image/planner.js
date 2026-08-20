import {
  ASPECT_RATIO_TOLERANCE,
  ENCODE_QUALITY_MAX,
  ENCODE_QUALITY_MIN,
  ENCODE_SEARCH_STEPS,
  RESIZE_RETRY_LIMIT,
  TARGET_MAX_RATIO
} from '../config.js';
import { validateRuleSet } from '../rules/validators.js';
import { clamp } from '../utils/bytes.js';
import { normalizeMime } from '../utils/mime.js';
import { ImageProcessingError } from './errors.js';
import { validateFile } from './metadata.js';

const CONFIRMATION_TYPES = new Set(['RULE_CONFIDENCE', 'CROP', 'FLATTEN_BACKGROUND', 'UPSCALE']);
const OPERATION_ORDER = Object.freeze({
  ORIENT: 10,
  CONVERT: 20,
  CROP: 30,
  RESIZE: 40,
  UPSCALE: 45,
  FLATTEN_BACKGROUND: 50,
  ENCODE: 60,
  COMPRESS: 70
});
const ALLOWED_BACKGROUND_COLORS = new Set(['white', 'blue', 'red', 'green', 'black']);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clone(value) {
  if (Array.isArray(value)) return value.map((item) => clone(item));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

function unique(values) {
  return [...new Set(values)];
}

function createConfirmation(type, suggestedPayload = null) {
  return {
    id: `confirmation-${type.toLowerCase()}`,
    type,
    required: true,
    resolved: false,
    accepted: null,
    payload: null,
    ...(suggestedPayload ? { suggestedPayload: clone(suggestedPayload) } : {})
  };
}

function addConfirmation(confirmations, type, suggestedPayload = null) {
  if (!CONFIRMATION_TYPES.has(type)) return;
  if (!confirmations.some((item) => item.type === type)) {
    confirmations.push(createConfirmation(type, suggestedPayload));
  }
}

function addOperation(operations, operation) {
  if (!operations.includes(operation)) operations.push(operation);
}

function sortOperations(operations) {
  return [...operations].sort((first, second) => OPERATION_ORDER[first] - OPERATION_ORDER[second]);
}

function dimensionValue(rule, current) {
  if (!isRecord(rule)) return current;
  if (Number.isFinite(rule.exact)) return rule.exact;
  if (Number.isFinite(rule.max) && current > rule.max) return rule.max;
  if (Number.isFinite(rule.min) && current < rule.min) return rule.min;
  return current;
}

function cropToAspect(width, height, aspect) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(aspect) || aspect <= 0) {
    return null;
  }
  const sourceAspect = width / height;
  if (Math.abs(sourceAspect - aspect) / aspect <= ASPECT_RATIO_TOLERANCE) return null;
  if (sourceAspect > aspect) {
    const cropWidth = Math.max(1, Math.min(width, Math.round(height * aspect)));
    return {
      x: Math.floor((width - cropWidth) / 2),
      y: 0,
      width: cropWidth,
      height
    };
  }
  const cropHeight = Math.max(1, Math.min(height, Math.round(width / aspect)));
  return {
    x: 0,
    y: Math.floor((height - cropHeight) / 2),
    width,
    height: cropHeight
  };
}

function chooseTargetMime(metadata, rules) {
  const current = normalizeMime(metadata.signatureMime ?? metadata.mime);
  const formats = Array.isArray(rules.formats) ? rules.formats : [];
  if (!formats.length) return current;
  if (current && formats.includes(current) && !(current === 'image/png'
    && Number.isFinite(rules.maxBytes) && metadata.size > rules.maxBytes
    && !metadata.hasAlpha && formats.includes('image/jpeg'))) {
    return current;
  }
  if (metadata.hasAlpha && formats.includes('image/png')) return 'image/png';
  if (!metadata.hasAlpha && formats.includes('image/jpeg')) return 'image/jpeg';
  if (current && formats.includes(current)) return current;
  return formats[0] ?? current;
}

function computeTargetDimensions(metadata, rules) {
  const sourceWidth = metadata.displayWidth ?? metadata.width;
  const sourceHeight = metadata.displayHeight ?? metadata.height;
  const targetAspect = Number.isFinite(rules.aspectRatio?.value)
    ? rules.aspectRatio.value
    : Number.isFinite(rules.width?.exact) && Number.isFinite(rules.height?.exact)
      ? rules.width.exact / rules.height.exact
      : null;
  const sourceAspect = sourceWidth / sourceHeight;
  let crop = null;
  if (targetAspect && Math.abs(sourceAspect - targetAspect) / targetAspect > (
    Number.isFinite(rules.aspectRatio?.tolerance)
      ? rules.aspectRatio.tolerance
      : ASPECT_RATIO_TOLERANCE
  )) {
    crop = cropToAspect(sourceWidth, sourceHeight, targetAspect);
  }

  const baseWidth = crop && !Number.isFinite(rules.width?.exact)
    ? crop.width
    : sourceWidth;
  const baseHeight = crop && !Number.isFinite(rules.height?.exact)
    ? crop.height
    : sourceHeight;
  const exactWidth = rules.width?.exact;
  const exactHeight = rules.height?.exact;
  let targetWidth = exactWidth ?? null;
  let targetHeight = exactHeight ?? null;
  if (Number.isFinite(exactWidth) && Number.isFinite(exactHeight)) {
    targetWidth = exactWidth;
    targetHeight = exactHeight;
  } else if (Number.isFinite(exactWidth)) {
    targetWidth = exactWidth;
    targetHeight = Math.max(1, Math.round(baseHeight * targetWidth / baseWidth));
  } else if (Number.isFinite(exactHeight)) {
    targetHeight = exactHeight;
    targetWidth = Math.max(1, Math.round(baseWidth * targetHeight / baseHeight));
  } else {
    const minimumScale = Math.max(
      1,
      Number.isFinite(rules.width?.min) ? rules.width.min / baseWidth : 1,
      Number.isFinite(rules.height?.min) ? rules.height.min / baseHeight : 1
    );
    const maximumScale = Math.min(
      1,
      Number.isFinite(rules.width?.max) ? rules.width.max / baseWidth : 1,
      Number.isFinite(rules.height?.max) ? rules.height.max / baseHeight : 1
    );
    targetWidth = Math.max(1, Math.round(baseWidth * (minimumScale > 1 ? minimumScale : maximumScale)));
    targetHeight = Math.max(1, Math.round(baseHeight * (minimumScale > 1 ? minimumScale : maximumScale)));
  }

  return {
    sourceWidth,
    sourceHeight,
    targetWidth: Math.max(1, Math.round(targetWidth)),
    targetHeight: Math.max(1, Math.round(targetHeight)),
    targetAspect,
    crop
  };
}

function constraintsConflict(targetWidth, targetHeight, rules) {
  if (Number.isFinite(rules.width?.exact) && targetWidth !== rules.width.exact) return true;
  if (Number.isFinite(rules.height?.exact) && targetHeight !== rules.height.exact) return true;
  if (Number.isFinite(rules.width?.min) && targetWidth < rules.width.min) return true;
  if (Number.isFinite(rules.height?.min) && targetHeight < rules.height.min) return true;
  if (Number.isFinite(rules.width?.max) && targetWidth > rules.width.max) return true;
  if (Number.isFinite(rules.height?.max) && targetHeight > rules.height.max) return true;
  return false;
}

function isUpscale(targetWidth, targetHeight, sourceWidth, sourceHeight) {
  return targetWidth > sourceWidth || targetHeight > sourceHeight;
}

function planForInvalidRules(metadata, rules, errors) {
  return {
    targetMime: normalizeMime(metadata?.signatureMime ?? metadata?.mime),
    targetWidth: metadata?.width ?? null,
    targetHeight: metadata?.height ?? null,
    crop: null,
    flattenBackground: null,
    qualityRange: [ENCODE_QUALITY_MIN, ENCODE_QUALITY_MAX],
    targetMinBytes: null,
    targetMaxBytes: null,
    operations: [],
    confirmations: [],
    warnings: [{ code: 'RULE_CONFLICT', details: errors }],
    unfixable: ['RULE_CONFLICT'],
    executable: false,
    passthrough: false,
    rules: clone(rules)
  };
}

/**
 * Pure plan construction. The plan holds only structured metadata/rules and no File or pixels.
 */
export function createProcessingPlan(metadata, rules, options = {}) {
  const ruleValidation = validateRuleSet(rules);
  if (!ruleValidation.valid) return planForInvalidRules(metadata, rules, ruleValidation.errors);
  if (!isRecord(metadata) || metadata.errorCode || !metadata.decodable) {
    return {
      targetMime: normalizeMime(metadata?.signatureMime ?? metadata?.mime),
      targetWidth: metadata?.width ?? null,
      targetHeight: metadata?.height ?? null,
      crop: null,
      flattenBackground: null,
      qualityRange: [ENCODE_QUALITY_MIN, ENCODE_QUALITY_MAX],
      targetMinBytes: null,
      targetMaxBytes: null,
      operations: [],
      confirmations: [],
      warnings: [{ code: metadata?.errorCode ?? 'DECODE_FAILED' }],
      unfixable: [metadata?.errorCode ?? 'DECODE_FAILED'],
      executable: false,
      passthrough: false,
      rules: clone(rules)
    };
  }

  const validation = validateFile(metadata, rules, options);
  const targetMime = chooseTargetMime(metadata, rules);
  const dimensions = computeTargetDimensions(metadata, rules);
  const operations = [];
  const confirmations = [];
  const warnings = [...validation.warnings];
  const unfixable = [...validation.unfixable];
  const sourceMime = normalizeMime(metadata.signatureMime ?? metadata.mime);
  const mimeNeedsConversion = targetMime !== sourceMime
    || metadata.mimeConsistent === false
    || metadata.extensionConsistent === false;

  if (metadata.orientation !== 1) addOperation(operations, 'ORIENT');
  if (mimeNeedsConversion) addOperation(operations, 'CONVERT');

  if (dimensions.crop) {
    addOperation(operations, 'CROP');
    addConfirmation(confirmations, 'CROP', dimensions.crop);
  }

  const shouldUpscale = isUpscale(
    dimensions.targetWidth,
    dimensions.targetHeight,
    dimensions.sourceWidth,
    dimensions.sourceHeight
  );
  if (shouldUpscale) {
    addOperation(operations, 'UPSCALE');
    addConfirmation(confirmations, 'UPSCALE', {
      width: dimensions.targetWidth,
      height: dimensions.targetHeight
    });
    if (options.allowUpscale === false) unfixable.push('UPSCALE_NOT_ALLOWED');
  }

  const dimensionsChanged = dimensions.targetWidth !== dimensions.sourceWidth
    || dimensions.targetHeight !== dimensions.sourceHeight
    || Boolean(dimensions.crop);
  if (dimensionsChanged) addOperation(operations, 'RESIZE');

  const flattenRequired = targetMime === 'image/jpeg' && metadata.hasAlpha;
  const flattenColor = ALLOWED_BACKGROUND_COLORS.has(rules.background)
    && rules.background !== 'transparent'
    ? rules.background
    : 'white';
  if (flattenRequired) {
    addOperation(operations, 'FLATTEN_BACKGROUND');
    addConfirmation(confirmations, 'FLATTEN_BACKGROUND', { color: flattenColor });
  }

  const targetMinBytes = Number.isFinite(rules.minBytes) ? rules.minBytes : null;
  const hardMaxBytes = Number.isFinite(rules.maxBytes) ? rules.maxBytes : null;
  const safeMaxBytes = hardMaxBytes === null
    ? null
    : Math.floor(hardMaxBytes * TARGET_MAX_RATIO);
  const targetMaxBytes = safeMaxBytes === null
    ? null
    : targetMinBytes !== null && safeMaxBytes < targetMinBytes
      ? hardMaxBytes
      : safeMaxBytes;
  if (safeMaxBytes !== null && targetMinBytes !== null && safeMaxBytes < targetMinBytes) {
    warnings.push({ code: 'MAX_SAFETY_MARGIN_RELAXED_FOR_MINIMUM', safeMaxBytes, targetMinBytes });
  }
  const byteViolation = validation.violations.some((item) => (
    item.code === 'FILE_TOO_LARGE' || item.code === 'FILE_TOO_SMALL'
  ));
  const byteWorkNeeded = !validation.valid && Boolean(
    byteViolation || validation.safeAutoFixes.includes('COMPRESS')
  );
  if (operations.length > 0 || byteWorkNeeded) addOperation(operations, 'ENCODE');
  if (byteWorkNeeded) addOperation(operations, 'COMPRESS');

  if (constraintsConflict(dimensions.targetWidth, dimensions.targetHeight, rules)) {
    unfixable.push('DIMENSION_CONSTRAINT_CONFLICT');
  }
  if (rules.actionable === false) unfixable.push('RULE_CONFLICT');
  if (!targetMime) unfixable.push('UNSUPPORTED_FORMAT');

  const hasExactAxis = Number.isFinite(rules.width?.exact) || Number.isFinite(rules.height?.exact);
  const allowSizeResize = options.allowSizeResize !== false && !hasExactAxis;
  const minOutputWidth = Number.isFinite(rules.width?.min)
    ? rules.width.min
    : Number.isFinite(rules.width?.exact) ? rules.width.exact : 1;
  const minOutputHeight = Number.isFinite(rules.height?.min)
    ? rules.height.min
    : Number.isFinite(rules.height?.exact) ? rules.height.exact : 1;

  const uniqueUnfixable = unique(unfixable);
  const hasUnresolvedConfirmation = confirmations.some((item) => item.required && !item.resolved);
  const executable = uniqueUnfixable.length === 0 && !hasUnresolvedConfirmation;
  const passthrough = executable && operations.length === 0 && validation.valid;

  return {
    targetMime,
    targetWidth: dimensions.targetWidth,
    targetHeight: dimensions.targetHeight,
    crop: null,
    proposedCrop: dimensions.crop,
    flattenBackground: null,
    proposedFlattenBackground: flattenRequired ? { color: flattenColor } : null,
    qualityRange: [
      clamp(options.qualityMin ?? ENCODE_QUALITY_MIN, ENCODE_QUALITY_MIN, ENCODE_QUALITY_MAX),
      clamp(options.qualityMax ?? ENCODE_QUALITY_MAX, ENCODE_QUALITY_MIN, ENCODE_QUALITY_MAX)
    ],
    searchSteps: ENCODE_SEARCH_STEPS,
    resizeRetryLimit: RESIZE_RETRY_LIMIT,
    targetMinBytes,
    targetMaxBytes,
    hardMaxBytes,
    minOutputWidth,
    minOutputHeight,
    allowSizeResize,
    operations: sortOperations(operations),
    confirmations,
    warnings,
    unfixable: uniqueUnfixable,
    executable,
    passthrough,
    validation,
    rules: clone(rules)
  };
}

function assertConfirmationShape(confirmation) {
  if (!isRecord(confirmation)
    || typeof confirmation.id !== 'string'
    || !CONFIRMATION_TYPES.has(confirmation.type)
    || typeof confirmation.accepted !== 'boolean') {
    throw new ImageProcessingError('USER_CONFIRMATION_REQUIRED', 'Invalid confirmation payload.');
  }
}

function cropPayload(payload) {
  const candidate = isRecord(payload?.crop) ? payload.crop : payload;
  if (!isRecord(candidate)) return null;
  const values = ['x', 'y', 'width', 'height'].map((key) => candidate[key]);
  if (!values.every((value) => Number.isFinite(value) && value >= 0)) return null;
  if (candidate.width <= 0 || candidate.height <= 0) return null;
  return {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    width: Math.round(candidate.width),
    height: Math.round(candidate.height)
  };
}

function cropMatchesProposal(candidate, proposal) {
  if (!candidate || !proposal) return false;
  // ADR-002：裁剪框尺寸必须与规则推导的建议矩形一致，用户只能平移位置。
  return candidate.width === proposal.width
    && candidate.height === proposal.height
    && Number.isFinite(candidate.x) && candidate.x >= 0
    && Number.isFinite(candidate.y) && candidate.y >= 0;
}

function confirmationResolved(plan) {
  return plan.confirmations.every((item) => !item.required || (
    item.resolved && item.accepted === true
  ));
}

/**
 * Return a new plan after validating one explicit confirmation. No implicit consent is possible.
 */
export function resolveProcessingConfirmation(plan, confirmation) {
  if (!isRecord(plan) || !Array.isArray(plan.confirmations)) {
    throw new ImageProcessingError('USER_CONFIRMATION_REQUIRED', 'Invalid processing plan.');
  }
  assertConfirmationShape(confirmation);
  const index = plan.confirmations.findIndex((item) => item.id === confirmation.id);
  if (index < 0 || plan.confirmations[index].type !== confirmation.type
    || plan.confirmations[index].resolved) {
    throw new ImageProcessingError('USER_CONFIRMATION_REQUIRED', 'Confirmation does not match this plan.');
  }

  const next = clone(plan);
  const item = next.confirmations[index];
  item.resolved = true;
  item.accepted = confirmation.accepted;
  item.payload = confirmation.accepted ? clone(confirmation.payload) : null;
  if (!confirmation.accepted) {
    next.warnings = [...(next.warnings ?? []), { code: 'USER_CANCELLED', type: confirmation.type }];
    next.executable = false;
    next.passthrough = false;
    return next;
  }

  if (confirmation.type === 'CROP') {
    const crop = cropPayload(confirmation.payload);
    if (!crop || !cropMatchesProposal(crop, next.proposedCrop)) {
      throw new ImageProcessingError('USER_CONFIRMATION_REQUIRED', 'Crop payload is not the proposed crop.');
    }
    next.crop = crop;
  }
  if (confirmation.type === 'FLATTEN_BACKGROUND') {
    const color = confirmation.payload?.color;
    if (typeof color !== 'string' || !ALLOWED_BACKGROUND_COLORS.has(color)) {
      throw new ImageProcessingError('USER_CONFIRMATION_REQUIRED', 'Flatten background color is invalid.');
    }
    next.flattenBackground = { color };
  }
  if (confirmation.type === 'UPSCALE') {
    if (confirmation.payload?.allow !== true) {
      throw new ImageProcessingError('USER_CONFIRMATION_REQUIRED', 'Upscale confirmation must explicitly allow it.');
    }
    next.upscaleAccepted = true;
  }
  if (confirmation.type === 'RULE_CONFIDENCE' && confirmation.payload?.allow !== true) {
    throw new ImageProcessingError('USER_CONFIRMATION_REQUIRED', 'Rule confirmation must explicitly allow it.');
  }

  next.executable = confirmationResolved(next)
    && (!Array.isArray(next.unfixable) || next.unfixable.length === 0);
  next.passthrough = false;
  return next;
}

export { cropToAspect };
