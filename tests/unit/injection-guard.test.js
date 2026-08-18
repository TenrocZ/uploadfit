import { describe, expect, it } from 'vitest';
import {
  armInjectionGuard,
  clearInjectionGuard,
  consumeInjectionGuard,
  hasPendingInjectionGuard
} from '../../src/injection/injection-guard.js';

describe('injection guard', () => {
  it('consumes the armed change token once', () => {
    const input = {};
    const event = { type: 'change', target: input };

    armInjectionGuard(input);
    expect(hasPendingInjectionGuard(input)).toBe(true);
    expect(consumeInjectionGuard(input, event)).toBe(true);
    expect(consumeInjectionGuard(input, event)).toBe(false);
    expect(hasPendingInjectionGuard(input)).toBe(false);
  });

  it('does not consume a token for the wrong event or input', () => {
    const input = {};
    const otherInput = {};
    armInjectionGuard(input);

    expect(consumeInjectionGuard(input, { type: 'input', target: input })).toBe(false);
    expect(consumeInjectionGuard(otherInput, { type: 'change', target: otherInput })).toBe(false);
    expect(consumeInjectionGuard(input, { type: 'change', target: otherInput })).toBe(false);
    expect(consumeInjectionGuard(input, { type: 'change', target: input })).toBe(true);
    clearInjectionGuard(input);
  });

  it('keeps two inputs independent', () => {
    const firstInput = {};
    const secondInput = {};
    armInjectionGuard(firstInput);
    armInjectionGuard(secondInput);

    expect(consumeInjectionGuard(firstInput, { type: 'change', target: firstInput })).toBe(true);
    expect(consumeInjectionGuard(secondInput, { type: 'change', target: secondInput })).toBe(true);
  });
});

