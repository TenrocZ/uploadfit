import { describe, expect, it } from 'vitest';
import { createProcessingPlan, resolveProcessingConfirmation } from '../../src/image/planner.js';

function metadata(overrides = {}) {
  return {
    localName: 'safe-fixture.jpg',
    mime: 'image/jpeg',
    extension: 'jpg',
    size: 50_000,
    width: 780,
    height: 1134,
    aspectRatio: 780 / 1134,
    orientation: 1,
    hasAlpha: false,
    decodable: true,
    declaredMime: 'image/jpeg',
    declaredExtension: 'jpg',
    signatureMime: 'image/jpeg',
    signatureValid: true,
    mimeConsistent: true,
    extensionConsistent: true,
    encodedWidth: 780,
    encodedHeight: 1134,
    displayWidth: 780,
    displayHeight: 1134,
    errorCode: null,
    ...overrides
  };
}

function rules(overrides = {}) {
  return {
    formats: ['image/jpeg'],
    extensions: ['jpg', 'jpeg'],
    minBytes: 30_720,
    maxBytes: 120_000,
    width: { exact: 390, min: null, max: null },
    height: { exact: 567, min: null, max: null },
    aspectRatio: { value: 390 / 567, tolerance: 0.015 },
    dpi: null,
    count: { max: 1 },
    background: null,
    semanticRequirements: [],
    confidence: 0.96,
    sources: [],
    conflicts: [],
    advisories: [],
    safetyFlags: [],
    actionable: true,
    ...overrides
  };
}

describe('S2 processing planner', () => {
  it('builds the fixed operation order and leaves safe resize executable', () => {
    const plan = createProcessingPlan(metadata(), rules());
    expect(plan.targetMime).toBe('image/jpeg');
    expect(plan.targetWidth).toBe(390);
    expect(plan.targetHeight).toBe(567);
    expect(plan.operations).toEqual(['RESIZE', 'ENCODE']);
    expect(plan.confirmations).toEqual([]);
    expect(plan.executable).toBe(true);
  });

  it('requires and resolves crop confirmation immutably', () => {
    const plan = createProcessingPlan(
      metadata({ width: 1000, height: 1000, displayWidth: 1000, displayHeight: 1000 }),
      rules()
    );
    expect(plan.executable).toBe(false);
    expect(plan.confirmations).toEqual([
      expect.objectContaining({ type: 'CROP', resolved: false, accepted: null })
    ]);
    expect(plan.proposedCrop).toEqual(expect.objectContaining({ width: 688, height: 1000 }));

    const resolved = resolveProcessingConfirmation(plan, {
      id: 'confirmation-crop',
      type: 'CROP',
      accepted: true,
      payload: plan.proposedCrop
    });
    expect(plan.crop).toBeNull();
    expect(resolved.crop).toEqual(plan.proposedCrop);
    expect(resolved.executable).toBe(true);
    expect(resolved.confirmations[0]).toMatchObject({ resolved: true, accepted: true });
  });

  it('does not allow crop, flatten or upscale to run without explicit consent', () => {
    const cropPlan = createProcessingPlan(
      metadata({ width: 1000, height: 1000, displayWidth: 1000, displayHeight: 1000 }),
      rules()
    );
    expect(cropPlan.executable).toBe(false);

    const transparentPlan = createProcessingPlan(
      metadata({
        mime: 'image/png',
        extension: 'png',
        declaredMime: 'image/png',
        declaredExtension: 'png',
        signatureMime: 'image/png',
        hasAlpha: true
      }),
      rules({ formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'] })
    );
    expect(transparentPlan.confirmations).toEqual([
      expect.objectContaining({ type: 'FLATTEN_BACKGROUND' })
    ]);
    expect(transparentPlan.executable).toBe(false);

    const upscalePlan = createProcessingPlan(
      metadata({ width: 100, height: 100, displayWidth: 100, displayHeight: 100 }),
      rules({
        width: { exact: 390, min: null, max: null },
        height: { exact: 390, min: null, max: null },
        aspectRatio: { value: 1, tolerance: 0.015 }
      })
    );
    expect(upscalePlan.confirmations).toEqual([
      expect.objectContaining({ type: 'UPSCALE' })
    ]);
    expect(upscalePlan.executable).toBe(false);
  });

  it('blocks an explicit no-upscale plan and an unresolvable rule set', () => {
    const noUpscale = createProcessingPlan(
      metadata({ width: 100, height: 100, displayWidth: 100, displayHeight: 100 }),
      rules({
        width: { exact: 390, min: null, max: null },
        height: { exact: 390, min: null, max: null },
        aspectRatio: { value: 1, tolerance: 0.015 }
      }),
      { allowUpscale: false }
    );
    expect(noUpscale.executable).toBe(false);
    expect(noUpscale.unfixable).toContain('UPSCALE_NOT_ALLOWED');

    const invalid = createProcessingPlan(metadata(), { formats: ['image/gif'] });
    expect(invalid.executable).toBe(false);
    expect(invalid.unfixable).toContain('RULE_CONFLICT');
  });

  it('keeps compliant input on a true passthrough plan', () => {
    const current = metadata({ width: 390, height: 567, displayWidth: 390, displayHeight: 567 });
    const noProcessingRules = rules({ minBytes: 30_000, maxBytes: 120_000 });
    const plan = createProcessingPlan(current, noProcessingRules);
    expect(plan.operations).toEqual([]);
    expect(plan.passthrough).toBe(true);
    expect(plan.executable).toBe(true);
  });

  it('keeps max-dimension resizing proportional instead of stretching', () => {
    const plan = createProcessingPlan(
      metadata({ width: 4000, height: 3000, displayWidth: 4000, displayHeight: 3000 }),
      rules({
        width: { exact: null, min: null, max: 2000 },
        height: { exact: null, min: null, max: 2000 },
        aspectRatio: null
      })
    );
    expect(plan.targetWidth).toBe(2000);
    expect(plan.targetHeight).toBe(1500);
    expect(plan.confirmations).toEqual([]);
  });

  it('uses the rule background for transparent JPEG conversion', () => {
    const plan = createProcessingPlan(
      metadata({
        mime: 'image/png',
        extension: 'png',
        declaredMime: 'image/png',
        declaredExtension: 'png',
        signatureMime: 'image/png',
        hasAlpha: true
      }),
      rules({ background: 'blue' })
    );
    expect(plan.proposedFlattenBackground).toEqual({ color: 'blue' });
    expect(plan.confirmations).toContainEqual(expect.objectContaining({
      type: 'FLATTEN_BACKGROUND',
      suggestedPayload: { color: 'blue' }
    }));
  });

  it('keeps a feasible interval when the minimum exceeds the safety margin', () => {
    const plan = createProcessingPlan(
      metadata({ size: 110_000 }),
      rules({ minBytes: 95_000, maxBytes: 100_000 })
    );
    expect(plan.targetMinBytes).toBe(95_000);
    expect(plan.targetMaxBytes).toBe(100_000);
    expect(plan.targetMaxBytes).toBeGreaterThan(plan.targetMinBytes);
    expect(plan.warnings).toContainEqual(expect.objectContaining({
      code: 'MAX_SAFETY_MARGIN_RELAXED_FOR_MINIMUM'
    }));
  });
});
