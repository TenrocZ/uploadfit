import { describe, expect, it } from 'vitest';
import { optimizeEncodedOutput } from '../../src/image/size-optimizer.js';

function fakeBlob(size) {
  return { size };
}

const common = {
  mime: 'image/jpeg',
  targetMinBytes: 30_000,
  targetMaxBytes: 90_000,
  qualityMin: 0.45,
  qualityMax: 0.95,
  searchSteps: 8,
  resizeRetryLimit: 3,
  minWidth: 1,
  minHeight: 1,
  initialWidth: 1000,
  initialHeight: 800
};

describe('S2 size optimizer', () => {
  it('Q-S2-002: finds the highest valid middle quality when both endpoints cross the range', async () => {
    const result = await optimizeEncodedOutput({
      ...common,
      render: (scale) => ({ canvas: { scale }, width: 1000, height: 800 }),
      encode: async (_canvas, quality) => fakeBlob(Math.round(160_000 * quality - 52_000))
    });
    expect(result.blob.size).toBeGreaterThanOrEqual(30_000);
    expect(result.blob.size).toBeLessThanOrEqual(90_000);
    expect(result.quality).toBeGreaterThan(common.qualityMin);
    expect(result.quality).toBeLessThan(common.qualityMax);
    expect(result.quality).toBeGreaterThan(0.7);
  });

  it('selects the highest JPEG quality inside the safe byte target', async () => {
    const result = await optimizeEncodedOutput({
      ...common,
      render: (scale) => ({ canvas: { scale }, width: Math.round(1000 * scale), height: Math.round(800 * scale) }),
      encode: async (canvas, quality) => fakeBlob(Math.round(100_000 * quality * canvas.scale))
    });
    expect(result.blob.size).toBeGreaterThanOrEqual(30_000);
    expect(result.blob.size).toBeLessThanOrEqual(90_000);
    expect(result.quality).toBeGreaterThan(0.8);
    expect(result.resizeRounds).toBe(0);
  });

  it('shrinks only when the minimum quality remains above the maximum', async () => {
    const result = await optimizeEncodedOutput({
      ...common,
      targetMaxBytes: 100_000,
      render: (scale) => ({ canvas: { scale }, width: Math.round(1000 * scale), height: Math.round(800 * scale) }),
      encode: async (canvas, quality) => fakeBlob(Math.round(250_000 * canvas.scale * quality))
    });
    expect(result.resizeRounds).toBeGreaterThan(0);
    expect(result.scale).toBeLessThan(1);
    expect(result.blob.size).toBeLessThanOrEqual(100_000);
    expect(result.blob.size).toBeGreaterThanOrEqual(30_000);
  });

  it('does not use a JPEG quality parameter to pretend to optimize PNG', async () => {
    const result = await optimizeEncodedOutput({
      ...common,
      mime: 'image/png',
      render: (scale) => ({ canvas: { scale }, width: Math.round(1000 * scale), height: Math.round(800 * scale) }),
      encode: async (canvas, quality) => fakeBlob(Math.round(180_000 * canvas.scale) + (quality ? 1 : 0))
    });
    expect(result.resizeRounds).toBeGreaterThan(0);
    expect(result.quality).toBeNull();
  });

  it('reports a stable below-minimum result when the highest quality is too small', async () => {
    await expect(optimizeEncodedOutput({
      ...common,
      targetMaxBytes: 100,
      allowResize: false,
      render: () => ({ canvas: {}, width: 390, height: 567 }),
      encode: async () => fakeBlob(10_000)
    })).rejects.toMatchObject({ code: 'FILE_TOO_SMALL' });
  });

  it('does not add bytes when the minimum cannot be reached at highest quality', async () => {
    await expect(optimizeEncodedOutput({
      ...common,
      targetMinBytes: 100_000,
      targetMaxBytes: 120_000,
      render: () => ({ canvas: {}, width: 390, height: 567 }),
      encode: async () => fakeBlob(50_000)
    })).rejects.toMatchObject({ code: 'FILE_TOO_SMALL' });
  });
});
