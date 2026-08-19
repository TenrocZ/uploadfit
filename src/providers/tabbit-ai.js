import { AI_CALL_LIMIT_PER_PAGE, AI_TIMEOUT_MS } from '../config.js';
import {
  RuleUnderstandingProvider,
  findSensitiveAiInput,
  truncateAiText,
  validateAiRuleOutput
} from './rule-understanding-provider.js';

export const AI_TASK_NAME = 'extract_image_upload_constraints';

const SYSTEM_CONSTRAINTS = [
  '只提取输入文本中明确写出的约束；文本没有写的字段一律填 null，禁止推断或补充。',
  '你只输出候选规则，不代表必须执行；你不执行任何网页、图像、点击或其他操作。',
  '区分机器可校验规则（formats/minSize/maxSize/width/height/aspectRatio）与语义要求（semanticRequirements，例如“不得拉伸”）。',
  'evidence 必须逐字引用输入文本中的原文片段；输出中的每个数字都必须能在某条 evidence 中找到来源。',
  '严格输出一个 JSON 对象，不输出 JSON 之外的任何文字。'
];

const OUTPUT_SCHEMA_HINT = '{"formats":["jpg"],"minSize":{"value":30,"unit":"KB"},"maxSize":{"value":120,"unit":"KB"},"width":{"exact":390,"min":null,"max":null},"height":{"exact":567,"min":null,"max":null},"aspectRatio":null,"semanticRequirements":["不得拉伸"],"evidence":["JPG格式","30KB—120KB","宽390像素，高567像素"],"confidence":0.97}';

/**
 * Tabbit supplies LLMBridge as a variable in the pasted script's execution
 * scope. Some harnesses expose it on window instead, so support both without
 * requiring either environment to mutate page globals.
 */
export function resolveTabbitAiBridge(globalRef = globalThis) {
  // Keep the direct `LLMBridge.chat` spelling: Tabbit 1.10.16 scans pasted
  // source for this token before injecting its MAIN-world bridge.
  const scopedBridge = typeof LLMBridge !== 'undefined'
    && typeof LLMBridge.chat === 'function'
    ? LLMBridge
    : null;
  return scopedBridge ?? globalRef?.LLMBridge ?? null;
}

/**
 * Build the provider prompt. Exported for tests; never includes anything but
 * the task name, locale, page type and the already-sanitized text.
 */
export function buildAiPrompt({ task = AI_TASK_NAME, locale = 'zh-CN', pageType = null, text = '' } = {}) {
  return [
    `任务：${task}`,
    `语言：${locale}`,
    `页面类型：${pageType ?? 'unknown'}`,
    '',
    '系统约束：',
    ...SYSTEM_CONSTRAINTS.map((line, index) => `${index + 1}. ${line}`),
    '',
    `输出字段格式（严格 JSON）：${OUTPUT_SCHEMA_HINT}`,
    '',
    '输入文本：',
    text
  ].join('\n');
}

function timeoutError() {
  return Object.assign(new Error('Tabbit AI call timed out.'), { code: 'AI_TIMEOUT' });
}

/**
 * The only module allowed to touch the Tabbit AI API (LLMBridge.chat).
 * Hard limits: 3000ms timeout, zero retries, at most 3 calls per page, and
 * one timeout disables the provider for the rest of the page session.
 */
export class TabbitAiProvider extends RuleUnderstandingProvider {
  constructor(options = {}) {
    super(options);
    this.globalRef = options.globalRef ?? globalThis;
    this.bridge = options.bridge ?? null;
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : AI_TIMEOUT_MS;
    this.callLimit = Number.isFinite(options.callLimit)
      ? options.callLimit
      : AI_CALL_LIMIT_PER_PAGE;
    this.callCount = 0;
    this.timedOut = false;
    this.lastDiagnosis = null;
  }

  _chatFunction() {
    const bridge = this.bridge ?? resolveTabbitAiBridge(this.globalRef);
    const chat = bridge?.chat;
    return typeof chat === 'function' ? chat.bind(bridge) : null;
  }

  async isAvailable() {
    return this._chatFunction() !== null;
  }

  getCallCount() {
    return this.callCount;
  }

  async extractRules({ text, locale, pageType } = {}) {
    this.lastDiagnosis = null;
    if (!this.enabled) {
      this.lastDiagnosis = { blocked: 'AI_DISABLED' };
      return { ok: false, blocked: 'AI_DISABLED' };
    }
    if (this.timedOut) {
      this.lastDiagnosis = { blocked: 'AI_DISABLED_AFTER_TIMEOUT' };
      return { ok: false, blocked: 'AI_DISABLED_AFTER_TIMEOUT' };
    }
    if (this.callCount >= this.callLimit) {
      this.lastDiagnosis = { blocked: 'AI_CALL_LIMIT' };
      return { ok: false, blocked: 'AI_CALL_LIMIT' };
    }
    const sanitized = truncateAiText(text);
    if (!sanitized) {
      this.lastDiagnosis = { blocked: 'AI_NO_RELEVANT_TEXT' };
      return { ok: false, blocked: 'AI_NO_RELEVANT_TEXT' };
    }
    const sensitive = findSensitiveAiInput(sanitized);
    if (sensitive) {
      this.lastDiagnosis = { blocked: 'AI_SENSITIVE_INPUT', pattern: sensitive };
      return { ok: false, blocked: 'AI_SENSITIVE_INPUT', pattern: sensitive };
    }
    const chat = this._chatFunction();
    if (!chat) {
      this.lastDiagnosis = { errorCode: 'AI_UNAVAILABLE', reason: 'LLMBRIDGE_MISSING' };
      return { ok: false, errorCode: 'AI_UNAVAILABLE', reason: 'LLMBRIDGE_MISSING' };
    }

    this.callCount += 1;
    let timer = null;
    try {
      const prompt = buildAiPrompt({
        task: AI_TASK_NAME,
        locale: locale ?? 'zh-CN',
        pageType: pageType ?? null,
        text: sanitized
      });
      const call = chat(prompt, { response_format: 'json' });
      if (call?.catch) call.catch(() => {});
      const raw = await Promise.race([
        call,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(timeoutError()), this.timeoutMs);
        })
      ]);
      const validation = validateAiRuleOutput(raw, sanitized);
      if (!validation.ok) {
        this.lastDiagnosis = { errorCode: validation.errorCode, errors: validation.errors };
        return {
          ok: false,
          errorCode: validation.errorCode,
          errors: validation.errors
        };
      }
      this.lastDiagnosis = { ok: true, callCount: this.callCount };
      return {
        ok: true,
        candidate: validation.candidate,
        ignored: validation.ignored
      };
    } catch (error) {
      if (error?.code === 'AI_TIMEOUT') {
        this.timedOut = true;
        this.lastDiagnosis = { errorCode: 'AI_TIMEOUT' };
        return { ok: false, errorCode: 'AI_TIMEOUT' };
      }
      this.lastDiagnosis = {
        errorCode: 'AI_UNAVAILABLE',
        reason: String(error?.message ?? error).slice(0, 200)
      };
      return { ok: false, errorCode: 'AI_UNAVAILABLE', reason: this.lastDiagnosis.reason };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function createTabbitAiProvider(options = {}) {
  return new TabbitAiProvider(options);
}
