import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const rootDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const fixtureDir = path.join(rootDir, 'tests', 'fixtures', 'generated');

async function openApi(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });
}

function rules(overrides = {}) {
  return {
    formats: ['image/jpeg'],
    extensions: ['jpg', 'jpeg'],
    minBytes: 1,
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

async function loadFixture(name) {
  const bytes = await readFile(path.join(fixtureDir, name));
  return { name, bytes: Array.from(bytes) };
}

test('Q-S2-001: recomputes authority and blocks deleted, forged, tampered, or mismatched confirmation plans', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async (baseRules) => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const context = canvas.getContext('2d');
    context.fillStyle = '#286090';
    context.fillRect(0, 0, 100, 100);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    const file = new File([blob], 'upscale.jpg', { type: 'image/jpeg' });
    const plan = api.createProcessingPlan(await api.inspectImage(file), baseRules);
    const deleted = { ...plan, confirmations: [], executable: true };
    const fakeAccepted = {
      ...plan,
      confirmations: plan.confirmations.map((item) => ({
        ...item, resolved: true, accepted: true, payload: { allow: true, width: 1, height: 1 }
      })),
      upscaleAccepted: true,
      executable: true
    };
    const resolved = api.resolveProcessingConfirmation(plan, {
      id: 'confirmation-upscale', type: 'UPSCALE', accepted: true, payload: { allow: true }
    });
    const tampered = {
      ...resolved,
      confirmations: resolved.confirmations.map((item) => ({
        ...item, payload: { allow: true, width: 1, height: 1 }
      }))
    };
    const targetMismatch = { ...resolved, targetWidth: 100 };
    async function errorCode(candidate) {
      try {
        await api.processImage(file, candidate, undefined, { useWorker: false });
        return null;
      } catch (error) {
        return error.code;
      }
    }
    const valid = await api.processImage(file, resolved, undefined, { useWorker: false });
    return {
      deleted: await errorCode(deleted),
      fakeAccepted: await errorCode(fakeAccepted),
      tampered: await errorCode(tampered),
      targetMismatch: await errorCode(targetMismatch),
      valid: {
        width: valid.metadata.width,
        height: valid.metadata.height,
        bytes: valid.file.size,
        valid: valid.validation.valid
      }
    };
  }, rules({
    width: { exact: 390, min: null, max: null },
    height: { exact: 390, min: null, max: null },
    aspectRatio: { value: 1, tolerance: 0.015 }
  }));
  expect(result).toMatchObject({
    deleted: 'USER_CONFIRMATION_REQUIRED',
    fakeAccepted: 'USER_CONFIRMATION_REQUIRED',
    tampered: 'USER_CONFIRMATION_REQUIRED',
    targetMismatch: 'PROCESSING_FAILED',
    valid: { width: 390, height: 390, valid: true }
  });
  expect(result.valid.bytes).toBeGreaterThan(0);
});

test('Q-S2-003/Q-S2-004: Worker and main use the same bounded quality search and safe output range', async ({ page }) => {
  await openApi(page);
  const fixture = await loadFixture('jpeg-390x567-medium.jpg');
  const result = await page.evaluate(async ({ bytes, name, baseRules }) => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const file = new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });
    const plan = api.createProcessingPlan(await api.inspectImage(file), baseRules);
    const workerEvents = [];
    const mainEvents = [];
    const worker = await api.processImage(file, plan, (event) => workerEvents.push(event), { useWorker: true });
    const main = await api.processImage(file, plan, (event) => mainEvents.push(event), { useWorker: false });
    const validQuality = (events) => events
      .filter((event) => Number.isFinite(event.quality)
        && event.bytes >= plan.targetMinBytes
        && event.bytes <= plan.targetMaxBytes)
      .reduce((highest, event) => Math.max(highest, event.quality), 0);
    return {
      range: { min: plan.targetMinBytes, max: plan.targetMaxBytes },
      worker: {
        mime: worker.file.type, width: worker.metadata.width, height: worker.metadata.height,
        bytes: worker.file.size, valid: worker.validation.valid, workerUsed: worker.workerUsed,
        highestValidQuality: validQuality(workerEvents)
      },
      main: {
        mime: main.file.type, width: main.metadata.width, height: main.metadata.height,
        bytes: main.file.size, valid: main.validation.valid, workerUsed: main.workerUsed,
        highestValidQuality: validQuality(mainEvents)
      }
    };
  }, { ...fixture, baseRules: rules({ maxBytes: 120_000 }) });
  console.log(`S2-EVIDENCE Q-S2-003/004 ${JSON.stringify(result)}`);
  expect(result.worker.workerUsed).toBe(true);
  expect(result.main.workerUsed).toBe(false);
  expect(result.worker.highestValidQuality).toBeGreaterThan(0.45);
  expect(Math.abs(result.worker.highestValidQuality - result.main.highestValidQuality)).toBeLessThanOrEqual(0.05);
  for (const output of [result.worker, result.main]) {
    expect(output).toMatchObject({ mime: 'image/jpeg', width: 390, height: 567, valid: true });
    expect(output.bytes).toBeGreaterThanOrEqual(result.range.min);
    expect(output.bytes).toBeLessThanOrEqual(result.range.max);
  }
});

test('Q-S2-009: integration consumes the generated fixture files from disk, including corrupt and orientation cases', async ({ page }) => {
  test.setTimeout(120_000);
  await openApi(page);
  const manifest = JSON.parse(await readFile(path.join(rootDir, 'tests', 'fixtures', 'manifest.json'), 'utf8'));
  const fixtures = await Promise.all(manifest.samples.map(async (entry) => {
    const bytes = await readFile(path.join(fixtureDir, entry.name));
    expect(bytes.length).toBe(entry.actualBytes);
    expect(createHash('sha256').update(bytes).digest('hex').toUpperCase()).toBe(entry.sha256);
    return entry;
  }));
  const result = await page.evaluate(async (entries) => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const inspected = [];
    for (const entry of entries) {
      const response = await fetch(`/tests/fixtures/generated/${encodeURIComponent(entry.name)}`);
      if (!response.ok) throw new Error(`FIXTURE_FETCH_FAILED:${entry.name}`);
      const file = new File([await response.arrayBuffer()], entry.name, { type: entry.mime });
      const metadata = await api.inspectImage(file);
      inspected.push({
        name: entry.name,
        bytes: file.size,
        signatureMime: metadata.signatureMime,
        mime: metadata.mime,
        width: metadata.width,
        height: metadata.height,
        hasAlpha: metadata.hasAlpha,
        decodable: metadata.decodable,
        errorCode: metadata.errorCode
      });
    }
    return inspected;
  }, fixtures);
  expect(result).toHaveLength(manifest.samples.length);
  for (const entry of manifest.samples) {
    const actual = result.find((item) => item.name === entry.name);
    expect(actual.bytes).toBe(entry.actualBytes);
    expect(actual.signatureMime).toBe(entry.mime);
    if (entry.decodable === false) expect(actual).toMatchObject({ decodable: false, errorCode: 'DECODE_FAILED' });
    else expect(actual).toMatchObject({ decodable: true, errorCode: null, width: entry.width, height: entry.height });
  }
  expect(result.find((item) => item.name === 'transparent.png').hasAlpha).toBe(true);
  expect(result.find((item) => item.name === 'jpeg-orientation-6.jpg')).toMatchObject({ width: 50, height: 100 });
});

test('Q-S2-010: HTMLImageElement fallback succeeds and revokes every decode object URL', async ({ page }) => {
  await openApi(page);
  const fixture = await loadFixture('jpeg-390x567-small.jpg');
  const result = await page.evaluate(async ({ bytes, name, baseRules }) => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const bitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
    const originalBitmap = globalThis.createImageBitmap;
    const originalRevoke = URL.revokeObjectURL;
    let revokeCount = 0;
    try {
      globalThis.createImageBitmap = undefined;
      URL.revokeObjectURL = (url) => {
        revokeCount += 1;
        return originalRevoke.call(URL, url);
      };
      const file = new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });
      const plan = api.createProcessingPlan(await api.inspectImage(file), { ...baseRules, maxBytes: 19_000 });
      const output = await api.processImage(file, plan, undefined, { useWorker: false });
      return { mime: output.file.type, valid: output.validation.valid, revokeCount };
    } finally {
      if (bitmapDescriptor) Object.defineProperty(globalThis, 'createImageBitmap', bitmapDescriptor);
      else globalThis.createImageBitmap = originalBitmap;
      URL.revokeObjectURL = originalRevoke;
    }
  }, { ...fixture, baseRules: rules() });
  expect(result).toMatchObject({ mime: 'image/jpeg', valid: true });
  expect(result.revokeCount).toBeGreaterThanOrEqual(3);
});

test('Q-S2-011: Worker constructor/error/timeout fall back once with cleanup, while abort does not fall back', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async (baseRules) => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2457aa';
    context.fillRect(0, 0, 120, 80);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'worker-controls.png', { type: 'image/png' });
    const plan = api.createProcessingPlan(await api.inspectImage(file), baseRules);
    const workerDescriptor = Object.getOwnPropertyDescriptor(window, 'Worker');
    const originalWorker = window.Worker;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const run = async (mode) => {
      let terminated = 0;
      let revoked = 0;
      URL.createObjectURL = (value) => originalCreate.call(URL, value);
      URL.revokeObjectURL = (url) => { revoked += 1; return originalRevoke.call(URL, url); };
      if (mode === 'constructor') {
        window.Worker = class BlockedWorker { constructor() { throw new Error('CSP_BLOCKED'); } };
      } else {
        window.Worker = class ControlledWorker {
          constructor() { this.mode = mode; }
          postMessage() {
            if (this.mode === 'error') setTimeout(() => this.onerror?.(new Error('WORKER_ERROR')), 0);
          }
          terminate() { terminated += 1; }
        };
      }
      try {
        if (mode === 'abort') {
          const controller = new AbortController();
          setTimeout(() => controller.abort(), 10);
          try {
            await api.processImage(file, plan, undefined, { useWorker: true, workerTimeoutMs: 1000, signal: controller.signal });
            return { code: null, warnings: [], terminated, revoked };
          } catch (error) {
            return { code: error.code, reason: error.details?.reason, warnings: error.details?.warnings ?? [], terminated, revoked };
          }
        }
        const output = await api.processImage(file, plan, undefined, {
          useWorker: true, workerTimeoutMs: mode === 'timeout' ? 20 : undefined
        });
        return { code: null, warnings: output.warnings.map((item) => item.code), workerUsed: output.workerUsed, terminated, revoked };
      } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
      }
    };
    try {
      return {
        constructor: await run('constructor'),
        error: await run('error'),
        timeout: await run('timeout'),
        abort: await run('abort')
      };
    } finally {
      if (workerDescriptor) Object.defineProperty(window, 'Worker', workerDescriptor);
      else window.Worker = originalWorker;
    }
  }, rules({
    formats: ['image/jpeg'],
    extensions: ['jpg', 'jpeg'],
    width: { exact: 120, min: null, max: null },
    height: { exact: 80, min: null, max: null },
    aspectRatio: { value: 1.5, tolerance: 0.015 }
  }));
  expect(result.constructor).toMatchObject({ code: null, warnings: ['WORKER_FALLBACK_MAIN_THREAD'], workerUsed: false });
  expect(result.error).toMatchObject({ code: null, warnings: ['WORKER_FALLBACK_MAIN_THREAD'], workerUsed: false, terminated: 1, revoked: 1 });
  expect(result.timeout).toMatchObject({ code: null, warnings: ['WORKER_FALLBACK_MAIN_THREAD'], workerUsed: false, terminated: 1, revoked: 1 });
  expect(result.abort).toMatchObject({ code: 'USER_CANCELLED', reason: 'PROCESS_ABORTED', terminated: 1, revoked: 1 });
  expect(result.abort.warnings).toEqual([]);
  console.log(`S2-EVIDENCE Q-S2-011 ${JSON.stringify(result)}`);
});

test('Q-S2-012: generated 4000x3000 input stays within 5 seconds and 500ms heartbeat gap', async ({ page }) => {
  test.setTimeout(120_000);
  await openApi(page);
  const fixture = { name: 'jpeg-4000x3000.jpg' };
  const result = await page.evaluate(async ({ name, baseRules }) => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const response = await fetch(`/tests/fixtures/generated/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error('FIXTURE_FETCH_FAILED:jpeg-4000x3000.jpg');
    const file = new File([await response.arrayBuffer()], name, { type: 'image/jpeg' });
    const plan = api.createProcessingPlan(await api.inspectImage(file), {
      ...baseRules, maxBytes: 500_000,
      width: { exact: null, min: null, max: 2000 },
      height: { exact: null, min: null, max: 2000 },
      aspectRatio: null
    });
    const gaps = [];
    let lastBeat = performance.now();
    const heartbeat = setInterval(() => {
      const now = performance.now();
      gaps.push(now - lastBeat);
      lastBeat = now;
    }, 25);
    const started = performance.now();
    let output;
    try {
      output = await api.processImage(file, plan, undefined, { useWorker: true });
    } finally {
      clearInterval(heartbeat);
    }
    const totalMs = performance.now() - started;
    return {
      inputBytes: file.size,
      inputWidth: 4000,
      inputHeight: 3000,
      totalMs,
      maxHeartbeatGapMs: Math.max(0, ...gaps),
      outputBytes: output.file.size,
      outputWidth: output.metadata.width,
      outputHeight: output.metadata.height,
      valid: output.validation.valid,
      workerUsed: output.workerUsed
    };
  }, { ...fixture, baseRules: rules() });
  console.log(`S2-EVIDENCE Q-S2-012 ${JSON.stringify(result)}`);
  expect(result.inputBytes).toBeLessThanOrEqual(10 * 1024 * 1024);
  expect(result.totalMs).toBeLessThanOrEqual(5000);
  expect(result.maxHeartbeatGapMs).toBeLessThanOrEqual(500);
  expect(result.outputBytes).toBeLessThanOrEqual(500_000);
  expect(result.outputWidth).toBeLessThanOrEqual(2000);
  expect(result.outputHeight).toBeLessThanOrEqual(2000);
  expect(result.valid).toBe(true);
  expect(result.workerUsed).toBe(true);
});

test('Q-S2-013: 80MP boundary rejects 10000x8001 but does not pixel-reject exact 10000x8000', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    function header(width, height) {
      const bytes = new Uint8Array(33);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      const view = new DataView(bytes.buffer);
      view.setUint32(8, 13);
      bytes.set([0x49, 0x48, 0x44, 0x52], 12);
      view.setUint32(16, width);
      view.setUint32(20, height);
      bytes[24] = 8;
      bytes[25] = 6;
      return new File([bytes], `${width}x${height}.png`, { type: 'image/png' });
    }
    const over = await api.inspectImage(header(10_000, 8_001));
    const exact = await api.inspectImage(header(10_000, 8_000));
    return { over: over.errorCode, exact: exact.errorCode };
  });
  expect(result.over).toBe('PIXEL_LIMIT_EXCEEDED');
  expect(result.exact).not.toBe('PIXEL_LIMIT_EXCEEDED');
  expect(result.exact).toBe('DECODE_FAILED');
});
