export const SAFETY_ERROR_PRIORITY = Object.freeze([
  'OFFICIAL_TOOL_REQUIRED',
  'AUDIO_ORIGINAL_REQUIRED',
  'AUDIO_LOSSLESS_REQUIRED',
  'AUDIO_OUTPUT_FORMAT_NOT_ALLOWED',
  'PERMISSION_OR_LOGIN',
  'REVIEW_REJECTED',
  'SYSTEM_BUSY',
  'NETWORK_OR_TIMEOUT'
]);

export const ALLOWED_SAFETY_FLAGS = Object.freeze([
  'SYSTEM_BUSY',
  'NETWORK_OR_TIMEOUT',
  'PERMISSION_OR_LOGIN',
  'REVIEW_REJECTED',
  'OFFICIAL_TOOL_REQUIRED',
  'AUDIO_ORIGINAL_REQUIRED',
  'AUDIO_LOSSLESS_REQUIRED',
  'AUDIO_OUTPUT_FORMAT_NOT_ALLOWED'
]);

export const OFFICIAL_TOOL_PATTERN = /(?:(?:(?:必须|需要|请|仅可|只能|应当).{0,8}(?:使用|用|通过)?\s*)?官方(?:照片|音频)?(?:审核)?工具(?:.{0,8}(?:制作|处理|审核|检测))?|官方(?:照片|音频)?(?:审核)?工具.{0,8}(?:必须|需要))/;

const SAFETY_PATTERNS = Object.freeze([
  ['SYSTEM_BUSY', /(?:系统繁忙|服务异常)/],
  ['NETWORK_OR_TIMEOUT', /(?:(?:网络|连接)\s*(?:异常|错误|故障|不可用|不稳定|中断|失败|波动|无法连接|超时)|(?:请求|上传|下载|处理)\s*超时)/],
  ['PERMISSION_OR_LOGIN', /(?:权限\s*(?:不足|受限|错误|缺失|不够)|无权|没有权限|无权限|未登录|尚未登录|请(?:先)?登录|需要登录|必须登录|登录后)/],
  ['REVIEW_REJECTED', /(?:审核\s*(?:不通过|未通过|失败|拒绝)|图片\s*(?:模糊|不清晰)|清晰度\s*(?:不足|不符合)|身份不一致|内容不符合)/],
  ['OFFICIAL_TOOL_REQUIRED', OFFICIAL_TOOL_PATTERN],
  ['AUDIO_ORIGINAL_REQUIRED', /(?:请上传|必须提供|需要提供).{0,8}(?:原始录音|原文件|证据原件)|(?:原始录音|证据原件).{0,8}(?:必须|只能|不接受其他)/],
  ['AUDIO_LOSSLESS_REQUIRED', /(?:无损(?:音频|录音|WAV)?|lossless)/i],
  ['AUDIO_OUTPUT_FORMAT_NOT_ALLOWED', /(?:MP3|audio\/mpeg|\.mp3).{0,8}(?:不支持|不允许|禁止|不能使用|不接受)|(?:不支持|不允许|禁止|不能使用|不接受).{0,8}(?:MP3|audio\/mpeg|\.mp3)/i]
]);

export function extractSafetyFlags(text) {
  const value = typeof text === 'string' ? text : '';
  return SAFETY_PATTERNS
    .filter(([, pattern]) => pattern.test(value))
    .map(([flag]) => flag);
}

export function safetyErrorCode(safetyFlags = []) {
  return SAFETY_ERROR_PRIORITY.find((code) => safetyFlags.includes(code))
    ?? 'RULE_CONFLICT';
}
