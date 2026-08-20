import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const LARGE_FIXTURE = path.join(process.cwd(), 'tests', 'fixtures', 'generated', 'jpeg-4000x3000.jpg');

async function openApi(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
  await page.evaluate(() => globalThis.__uploadfit_debug_bundle__.cleanupSession());
}

test('S5 G6: three Worker and three main-thread performance samples stay bounded', async ({ page }) => {
  test.setTimeout(120_000);
  await openApi(page);
  const bytes = [...await fs.readFile(LARGE_FIXTURE)];
  const result = await page.evaluate(async (inputBytes) => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const rules = {
      formats: ['image/jpeg'],
      extensions: ['jpg', 'jpeg'],
      minBytes: 1,
      maxBytes: 500_000,
      width: { exact: null, min: null, max: 2000 },
      height: { exact: null, min: null, max: 2000 },
      aspectRatio: null,
      dpi: null,
      count: { max: 1 },
      background: null,
      semanticRequirements: [],
      confidence: 0.96,
      sources: [],
      conflicts: [],
      advisories: [],
      safetyFlags: [],
      actionable: true
    };
    const samples = [];
    for (const useWorker of [true, false]) {
      for (let index = 0; index < 3; index += 1) {
        const file = new File([new Uint8Array(inputBytes)], 'performance-fixture.jpg', { type: 'image/jpeg' });
        const metadata = await api.inspectImage(file);
        const plan = api.createProcessingPlan(metadata, rules);
        let lastBeat = performance.now();
        let maxHeartbeatGapMs = 0;
        const started = performance.now();
        const output = await api.processImage(file, plan, () => {
          const now = performance.now();
          maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastBeat);
          lastBeat = now;
        }, { useWorker });
        samples.push({
          useWorker,
          index: index + 1,
          totalMs: performance.now() - started,
          maxHeartbeatGapMs,
          outputBytes: output.file.size,
          outputWidth: output.metadata.width,
          outputHeight: output.metadata.height,
          valid: output.validation.valid
        });
      }
    }
    return samples;
  }, bytes);

  expect(result).toHaveLength(6);
  for (const sample of result) {
    expect(sample.totalMs).toBeLessThanOrEqual(5_000);
    expect(sample.maxHeartbeatGapMs).toBeLessThanOrEqual(500);
    expect(sample.valid).toBe(true);
    expect(sample.outputWidth).toBeLessThanOrEqual(2000);
    expect(sample.outputHeight).toBeLessThanOrEqual(2000);
    expect(sample.outputBytes).toBeLessThanOrEqual(500_000);
  }
  console.log(`S5 PERFORMANCE ${JSON.stringify(result)}`);
});
