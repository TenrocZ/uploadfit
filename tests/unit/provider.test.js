import { describe, expect, test, vi } from 'vitest';
import { TabbitAiProvider, buildAiPrompt } from '../../src/providers/tabbit-ai.js';

const VALID_TEXT = '电子件要求：JPG格式，文件大小介于30KB到120KB之间，宽390像素，高567像素。不得拉伸。';

const VALID_RESPONSE = JSON.stringify({
  formats: ['jpg'],
  minSize: { value: 30, unit: 'KB' },
  maxSize: { value: 120, unit: 'KB' },
  width: { exact: 390, min: null, max: null },
  height: { exact: 567, min: null, max: null },
  aspectRatio: null,
  semanticRequirements: ['不得拉伸'],
  evidence: ['JPG格式', '文件大小介于30KB到120KB之间', '宽390像素', '高567像素'],
  confidence: 0.97
});

function providerWith(implementation, options = {}) {
  const calls = [];
  const bridge = {
    chat: (...args) => {
      calls.push(args);
      return implementation(args);
    }
  };
  const provider = new TabbitAiProvider({ bridge, ...options });
  return { provider, calls };
}

test('A01/A11: a real LLMBridge response becomes an ai candidate', async () => {
  const { provider, calls } = providerWith(() => Promise.resolve(VALID_RESPONSE));
  const result = await provider.extractRules({ text: VALID_TEXT, locale: 'zh-CN' });
  expect(result.ok).toBe(true);
  expect(result.candidate.sourceType).toBe('ai');
  expect(result.candidate.rules.width.exact).toBe(390);
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toContain(VALID_TEXT);
  expect(calls[0][1]).toEqual({ response_format: 'json' });
  expect(provider.getCallCount()).toBe(1);
});

test('A06: 3s timeout cancels the result, zero retries, provider disabled after', async () => {
  vi.useFakeTimers();
  try {
    let resolveChat;
    const bridge = {
      chat: () => new Promise((resolve) => {
        resolveChat = resolve;
      })
    };
    const provider = new TabbitAiProvider({ bridge, timeoutMs: 3000 });
    const pending = provider.extractRules({ text: VALID_TEXT });
    const assertion = pending.then((result) => {
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('AI_TIMEOUT');
      expect(provider.getCallCount()).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    // 超时后本页禁用：不再调用平台 API。
    const second = await provider.extractRules({ text: VALID_TEXT });
    expect(second.ok).toBe(false);
    expect(second.blocked).toBe('AI_DISABLED_AFTER_TIMEOUT');
    expect(provider.getCallCount()).toBe(1);
    // 迟到的结果被忽略，不会触发校验或副作用。
    resolveChat?.(VALID_RESPONSE);
  } finally {
    vi.useRealTimers();
  }
});

test('A07: the 4th call on one page never reaches the platform API', async () => {
  const { provider, calls } = providerWith(() => Promise.resolve(VALID_RESPONSE));
  await provider.extractRules({ text: VALID_TEXT });
  await provider.extractRules({ text: VALID_TEXT });
  await provider.extractRules({ text: VALID_TEXT });
  const fourth = await provider.extractRules({ text: VALID_TEXT });
  expect(fourth.ok).toBe(false);
  expect(fourth.blocked).toBe('AI_CALL_LIMIT');
  expect(provider.getCallCount()).toBe(3);
  expect(calls).toHaveLength(3);
});

test('A09: sensitive input is blocked before any platform call', async () => {
  const { provider, calls } = providerWith(() => Promise.resolve(VALID_RESPONSE));
  const result = await provider.extractRules({ text: '密码：abc123 JPG格式 最大100KB' });
  expect(result.ok).toBe(false);
  expect(result.blocked).toBe('AI_SENSITIVE_INPUT');
  expect(result.pattern).toBe('CREDENTIAL_ASSIGNMENT');
  expect(calls).toHaveLength(0);
  expect(provider.getCallCount()).toBe(0);
});

test('A02: invalid JSON output falls back with AI_INVALID_OUTPUT', async () => {
  const { provider } = providerWith(() => Promise.resolve('这不是JSON，规则是JPG'));
  const result = await provider.extractRules({ text: VALID_TEXT });
  expect(result.ok).toBe(false);
  expect(result.errorCode).toBe('AI_INVALID_OUTPUT');
});

test('A10: missing LLMBridge is a clean local mode (AI_UNAVAILABLE)', async () => {
  const provider = new TabbitAiProvider({ bridge: null, globalRef: {} });
  await expect(provider.isAvailable()).resolves.toBe(false);
  const result = await provider.extractRules({ text: VALID_TEXT });
  expect(result.ok).toBe(false);
  expect(result.errorCode).toBe('AI_UNAVAILABLE');
  expect(result.reason).toBe('LLMBRIDGE_MISSING');
  expect(provider.getCallCount()).toBe(0);
});

test('A10: a rejected chat promise degrades to AI_UNAVAILABLE without retry', async () => {
  const { provider, calls } = providerWith(() => Promise.reject(new Error('bridge error')));
  const result = await provider.extractRules({ text: VALID_TEXT });
  expect(result.ok).toBe(false);
  expect(result.errorCode).toBe('AI_UNAVAILABLE');
  expect(provider.getCallCount()).toBe(1);
  expect(calls).toHaveLength(1);
});

test('empty or irrelevant text never triggers a call', async () => {
  const { provider, calls } = providerWith(() => Promise.resolve(VALID_RESPONSE));
  const empty = await provider.extractRules({ text: '   ' });
  expect(empty.blocked).toBe('AI_NO_RELEVANT_TEXT');
  expect(calls).toHaveLength(0);
});

test('input text is truncated to the 2000-char AI limit', async () => {
  const { provider, calls } = providerWith(() => Promise.resolve(VALID_RESPONSE));
  await provider.extractRules({ text: VALID_TEXT.repeat(60) });
  const prompt = calls[0][0];
  // prompt = 任务头 + 约束 + schema 提示 + 输入文本；输入文本本身不得超过 2000。
  const inputIndex = prompt.indexOf('输入文本：\n');
  expect(inputIndex).toBeGreaterThan(0);
  expect(prompt.length - inputIndex - '输入文本：\n'.length).toBeLessThanOrEqual(2000);
  expect(prompt).toContain(VALID_TEXT);
});

test('disabled provider never calls the platform', async () => {
  const { provider, calls } = providerWith(() => Promise.resolve(VALID_RESPONSE), { enabled: false });
  const result = await provider.extractRules({ text: VALID_TEXT });
  expect(result.blocked).toBe('AI_DISABLED');
  expect(calls).toHaveLength(0);
});

test('the prompt never contains URLs or script content', () => {
  const prompt = buildAiPrompt({ text: VALID_TEXT });
  expect(prompt).not.toMatch(/https?:\/\//);
  expect(prompt).not.toContain('<script');
});
