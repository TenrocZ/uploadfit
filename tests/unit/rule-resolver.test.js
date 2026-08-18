import { describe, expect, it } from 'vitest';
import { createRuleCandidate } from '../../src/rules/schema.js';
import { resolveRules } from '../../src/rules/resolver.js';

const bytes = (value, sourceType = 'nearby-text') => createRuleCandidate({
  sourceType,
  evidence: [`max ${value}`],
  confidence: 0.9,
  rules: { maxBytes: value }
});

describe('rule resolver', () => {
  it('lets higher priority override lower priority but records a resolvable conflict', () => {
    const result = resolveRules([
      bytes(200000, 'nearby-text'),
      bytes(100000, 'html-attribute')
    ]);
    expect(result.maxBytes).toBe(100000);
    expect(result.actionable).toBe(true);
    expect(result.conflicts).toContainEqual(expect.objectContaining({
      field: 'maxBytes',
      reason: 'HIGHER_PRIORITY_WINS',
      unresolvable: false
    }));
  });

  it('blocks two different values at the same priority', () => {
    const result = resolveRules([bytes(100000), bytes(200000)]);
    expect(result.maxBytes).toBe(null);
    expect(result.actionable).toBe(false);
    expect(result.conflicts).toContainEqual(expect.objectContaining({
      field: 'maxBytes',
      reason: 'SAME_PRIORITY_CONFLICT',
      unresolvable: true
    }));
  });

  it('does not execute advisory-only candidates', () => {
    const result = resolveRules([createRuleCandidate({
      sourceType: 'nearby-text',
      evidence: ['建议小于2MB'],
      confidence: 0.75,
      advisoryOnly: true,
      rules: { maxBytes: 2000000 }
    })]);
    expect(result.maxBytes).toBe(null);
    expect(result.advisories).toHaveLength(1);
    expect(result.actionable).toBe(false);
  });

  it('marks exact dimensions that violate ranges as unresolvable', () => {
    const result = resolveRules([
      createRuleCandidate({
        sourceType: 'nearby-text',
        evidence: ['宽度至少500'],
        confidence: 0.9,
        rules: { width: { exact: null, min: 500, max: null } }
      }),
      createRuleCandidate({
        sourceType: 'rejection',
        evidence: ['宽度300'],
        confidence: 0.9,
        rules: { width: { exact: 300, min: null, max: null } }
      })
    ]);
    expect(result.actionable).toBe(false);
    expect(result.conflicts).toContainEqual(expect.objectContaining({ reason: 'EXACT_VIOLATES_RANGE' }));
  });

  it('is independent of input candidate order', () => {
    const first = resolveRules([bytes(100000), bytes(200000, 'html-attribute')]);
    const second = resolveRules([bytes(200000, 'html-attribute'), bytes(100000)]);
    expect(second).toEqual(first);
  });

  it('keeps an exact dimension and drops compatible lower-priority bounds', () => {
    const result = resolveRules([
      createRuleCandidate({
        sourceType: 'nearby-text',
        evidence: ['宽度至少500且不超过800'],
        confidence: 0.9,
        rules: { width: { exact: null, min: 500, max: 800 } }
      }),
      createRuleCandidate({
        sourceType: 'rejection',
        evidence: ['宽度600'],
        confidence: 0.95,
        rules: { width: { exact: 600, min: null, max: null } }
      })
    ]);
    expect(result.width).toEqual({ exact: 600, min: null, max: null });
    expect(result.actionable).toBe(true);
  });

  it('does not treat equal aspect-ratio objects as a conflict', () => {
    const ratio = { value: 0.75, tolerance: 0.015 };
    const result = resolveRules([
      createRuleCandidate({
        sourceType: 'nearby-text',
        evidence: ['比例3:4'],
        confidence: 0.9,
        rules: { aspectRatio: ratio }
      }),
      createRuleCandidate({
        sourceType: 'selected-text',
        evidence: ['宽高比6:8'],
        confidence: 0.8,
        rules: { aspectRatio: { ...ratio } }
      })
    ]);
    expect(result.aspectRatio).toEqual(ratio);
    expect(result.conflicts).toEqual([]);
    expect(result.actionable).toBe(true);
  });

  it('lets a rejection source override accept text while preserving evidence', () => {
    const result = resolveRules([
      createRuleCandidate({
        sourceType: 'html-attribute',
        evidence: ['accept: image/png'],
        confidence: 0.95,
        rules: { formats: ['image/png'], extensions: ['png'] }
      }),
      createRuleCandidate({
        sourceType: 'rejection',
        evidence: ['拒收 PNG，请使用 JPG'],
        confidence: 0.95,
        rules: { formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'] }
      })
    ]);
    expect(result.formats).toEqual(['image/jpeg']);
    expect(result.conflicts).toContainEqual(expect.objectContaining({
      field: 'formats',
      reason: 'HIGHER_PRIORITY_WINS',
      unresolvable: false
    }));
    expect(result.sources.map((source) => source.type)).toEqual(['rejection', 'html-attribute']);
  });

  it('blocks network or official-tool semantics even when an executable value exists', () => {
    const result = resolveRules([createRuleCandidate({
      sourceType: 'rejection',
      evidence: ['系统繁忙，最大100KB'],
      confidence: 0.9,
      rules: { maxBytes: 100000 },
      safetyFlags: ['NETWORK_OR_TIMEOUT']
    })]);
    expect(result.maxBytes).toBe(100000);
    expect(result.safetyFlags).toEqual(['NETWORK_OR_TIMEOUT']);
    expect(result.actionable).toBe(false);
    expect(result.conflicts).toContainEqual(expect.objectContaining({
      field: 'safety',
      reason: 'STOP_SEMANTIC',
      unresolvable: true
    }));
  });

  it('blocks an aspect ratio that contradicts exact dimensions', () => {
    const result = resolveRules([createRuleCandidate({
      sourceType: 'nearby-text',
      evidence: ['300×300，比例4:3'],
      confidence: 0.9,
      rules: {
        width: { exact: 300, min: null, max: null },
        height: { exact: 300, min: null, max: null },
        aspectRatio: { value: 4 / 3, tolerance: 0.015 }
      }
    })]);
    expect(result.actionable).toBe(false);
    expect(result.conflicts).toContainEqual(expect.objectContaining({
      field: 'aspectRatio',
      reason: 'EXACT_DIMENSION_MISMATCH',
      unresolvable: true
    }));
  });

  it('surfaces a reversed candidate range instead of silently dropping it', () => {
    const result = resolveRules([createRuleCandidate({
      sourceType: 'nearby-text',
      evidence: ['200KB—100KB'],
      confidence: 0.9,
      rules: { minBytes: 200000, maxBytes: 100000 }
    })]);
    expect(result.actionable).toBe(false);
    expect(result.conflicts).toContainEqual(expect.objectContaining({
      field: 'candidate',
      reason: 'VALIDATION_FAILED',
      unresolvable: true
    }));
  });
});
