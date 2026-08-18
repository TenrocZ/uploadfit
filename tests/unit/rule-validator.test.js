import { describe, expect, it } from 'vitest';
import { createEmptyRuleSet, createRuleCandidate } from '../../src/rules/schema.js';
import { resolveRules } from '../../src/rules/resolver.js';
import { validateRuleCandidate, validateRuleSet } from '../../src/rules/validators.js';

function candidate(rules, overrides = {}) {
  return createRuleCandidate({
    sourceType: 'nearby-text',
    evidence: ['规则证据'],
    confidence: 0.9,
    rules,
    ...overrides
  });
}

describe('runtime rule validation', () => {
  it('rejects invalid count numbers and keeps the final result non-actionable', () => {
    for (const value of [-5, 0, Infinity, NaN, '1']) {
      const invalid = candidate({ count: { max: value } });
      expect(validateRuleCandidate(invalid).valid).toBe(false);
      const result = resolveRules([invalid]);
      expect(result.actionable).toBe(false);
      expect(result.conflicts).toContainEqual(expect.objectContaining({
        reason: 'VALIDATION_FAILED',
        unresolvable: true
      }));
    }
  });

  it('rejects unknown MIME, inconsistent extensions, and non-array formats', () => {
    const invalidCandidates = [
      candidate({ formats: ['image/gif'] }),
      candidate({ formats: ['image/png'], extensions: ['jpg'] }),
      candidate({ formats: 'image/png' })
    ];
    for (const invalid of invalidCandidates) {
      expect(validateRuleCandidate(invalid).valid).toBe(false);
      expect(resolveRules([invalid]).actionable).toBe(false);
    }
  });

  it('Q-S1-029 requires a complete canonical extension mapping for every format', () => {
    const invalidCandidates = [
      candidate({ formats: ['image/png'], extensions: [] }),
      candidate({ formats: ['image/jpeg'], extensions: ['jpg'] }),
      candidate({ formats: ['image/webp'] }),
      candidate({ extensions: ['png'] })
    ];
    for (const invalid of invalidCandidates) {
      expect(validateRuleCandidate(invalid).valid).toBe(false);
      expect(resolveRules([invalid]).actionable).toBe(false);
    }

    const malformedRuleSet = createEmptyRuleSet();
    malformedRuleSet.formats = ['image/png'];
    malformedRuleSet.extensions = [];
    expect(validateRuleSet(malformedRuleSet).valid).toBe(false);
  });

  it('Q-S1-030 rejects unknown keys inside nested rule objects', () => {
    const invalidCandidates = [
      candidate({ width: { exact: 390, min: null, max: null, unexpected: true } }),
      candidate({ height: { exact: 567, min: null, max: null, unexpected: true } }),
      candidate({ aspectRatio: { value: 1, tolerance: 0.01, unexpected: true } }),
      candidate({ count: { max: 1, unexpected: true } })
    ];
    for (const invalid of invalidCandidates) {
      expect(validateRuleCandidate(invalid).valid).toBe(false);
      expect(resolveRules([invalid]).actionable).toBe(false);
    }

    const malformedRuleSet = createEmptyRuleSet();
    malformedRuleSet.aspectRatio = { value: 1, tolerance: 0.01, unexpected: true };
    expect(validateRuleSet(malformedRuleSet).valid).toBe(false);
  });

  it('rejects malformed tolerance, DPI, background, evidence, and safety flags', () => {
    const invalidCandidates = [
      candidate({ aspectRatio: { value: 1, tolerance: Infinity } }),
      candidate({ dpi: 99999 }),
      candidate({ background: 'purple' }),
      candidate({ maxBytes: 100000 }, { evidence: ['token:secret'] }),
      candidate({ maxBytes: 100000 }, { safetyFlags: ['UNKNOWN_FLAG'] })
    ];
    for (const invalid of invalidCandidates) {
      expect(validateRuleCandidate(invalid).valid).toBe(false);
      const result = resolveRules([invalid]);
      expect(result.actionable).toBe(false);
      expect(JSON.stringify(result)).not.toContain('secret');
    }
  });

  it('is independent of malformed candidate order and validates the final RuleSet independently', () => {
    const invalidA = candidate({ count: { max: -1 } }, { evidence: ['A'] });
    const invalidB = candidate({ formats: ['image/gif'] }, { evidence: ['B'] });
    expect(resolveRules([invalidA, invalidB])).toEqual(resolveRules([invalidB, invalidA]));

    const malformedRuleSet = {
      formats: ['image/png'],
      extensions: ['png'],
      minBytes: null,
      maxBytes: null,
      width: { exact: null, min: null, max: null },
      height: { exact: null, min: null, max: null },
      aspectRatio: null,
      dpi: null,
      count: { max: -1 },
      background: null,
      semanticRequirements: [],
      confidence: 0.9,
      sources: [],
      conflicts: [],
      advisories: [],
      safetyFlags: [],
      actionable: true
    };
    expect(validateRuleSet(malformedRuleSet).valid).toBe(false);
  });
});
