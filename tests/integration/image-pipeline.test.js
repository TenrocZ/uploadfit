import { expect, test } from '@playwright/test';

async function openApi(page) {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.test.js' });
}

test('I01/I02/I18: inspects, passes through compliant JPEG and converts PNG to real JPEG', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const makeRules = (overrides = {}) => ({
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
    });
    async function makeImage(width, height, type, name) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      const imageData = context.createImageData(width, height);
      for (let index = 0; index < imageData.data.length; index += 4) {
        const pixel = index / 4;
        imageData.data[index] = (pixel * 17) % 256;
        imageData.data[index + 1] = (pixel * 31) % 256;
        imageData.data[index + 2] = (pixel * 47) % 256;
        imageData.data[index + 3] = 255;
      }
      context.putImageData(imageData, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
      return new File([blob], name, { type });
    }

    const jpeg = await makeImage(390, 567, 'image/jpeg', 'fixture.jpg');
    const jpegMetadata = await api.inspectImage(jpeg);
    const jpegRules = makeRules({ minBytes: 1, maxBytes: 500_000 });
    const jpegValidation = api.validateFile(jpegMetadata, jpegRules);
    const jpegPlan = api.createProcessingPlan(jpegMetadata, jpegRules);
    const passthrough = await api.processImage(jpeg, jpegPlan, undefined, { useWorker: false });

    const png = await makeImage(780, 1134, 'image/png', 'fixture.png');
    const pngRules = makeRules({ minBytes: 1 });
    const pngMetadata = await api.inspectImage(png);
    const pngPlan = api.createProcessingPlan(pngMetadata, pngRules);
    const converted = await api.processImage(png, pngPlan, undefined, { useWorker: false });
    const webp = await makeImage(390, 567, 'image/webp', 'fixture.webp');
    const webpMetadata = await api.inspectImage(webp);
    const webpRules = makeRules({ formats: ['image/webp'], extensions: ['webp'], maxBytes: 500_000 });
    const webpPlan = api.createProcessingPlan(webpMetadata, webpRules);
    const webpResult = await api.processImage(webp, webpPlan, undefined, { useWorker: false });

    return {
      jpeg: {
        mime: jpegMetadata.mime,
        width: jpegMetadata.width,
        height: jpegMetadata.height,
        valid: jpegValidation.valid,
        operations: jpegPlan.operations,
        passthrough: passthrough.passthrough,
        sameFile: passthrough.file === jpeg
      },
      converted: {
        mime: converted.file.type,
        size: converted.file.size,
        name: converted.file.name,
        width: converted.metadata.width,
        height: converted.metadata.height,
        valid: converted.validation.valid,
        operations: converted.operations
      },
      webp: {
        mime: webpMetadata.mime,
        width: webpResult.metadata.width,
        height: webpResult.metadata.height,
        passthrough: webpResult.passthrough,
        valid: webpResult.validation.valid
      }
    };
  });

  expect(result.jpeg).toMatchObject({
    mime: 'image/jpeg',
    width: 390,
    height: 567,
    valid: true,
    operations: [],
    passthrough: true,
    sameFile: true
  });
  expect(result.converted).toMatchObject({
    mime: 'image/jpeg',
    width: 390,
    height: 567,
    valid: true
  });
  expect(result.converted.name).toBe('fixture_uploadfit.jpg');
  expect(result.converted.size).toBeGreaterThan(0);
  expect(result.converted.size).toBeLessThanOrEqual(120_000);
  expect(result.webp).toEqual({
    mime: 'image/webp', width: 390, height: 567, passthrough: true, valid: true
  });
});

test('I06/I07/I08/I15: blocks lossy confirmations until explicit resolution', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const baseRules = (overrides = {}) => ({
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
      sources: [], conflicts: [], advisories: [], safetyFlags: [], actionable: true,
      ...overrides
    });
    async function noisyImage(width, height, type, name, alpha = false) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      const imageData = context.createImageData(width, height);
      for (let index = 0; index < imageData.data.length; index += 4) {
        const pixel = index / 4;
        imageData.data[index] = (pixel * 13) % 256;
        imageData.data[index + 1] = (pixel * 29) % 256;
        imageData.data[index + 2] = (pixel * 43) % 256;
        imageData.data[index + 3] = alpha ? ((pixel % 3) ? 255 : 0) : 255;
      }
      context.putImageData(imageData, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
      return new File([blob], name, { type });
    }
    const cropFile = await noisyImage(1000, 1000, 'image/jpeg', 'crop.jpg');
    const cropRules = baseRules();
    const cropMetadata = await api.inspectImage(cropFile);
    const cropPlan = api.createProcessingPlan(cropMetadata, cropRules);
    let cropBlocked;
    try {
      await api.processImage(cropFile, cropPlan, undefined, { useWorker: false });
      cropBlocked = null;
    } catch (error) {
      cropBlocked = error.code;
    }
    const cropResolved = api.resolveProcessingConfirmation(cropPlan, {
      id: 'confirmation-crop', type: 'CROP', accepted: true, payload: cropPlan.proposedCrop
    });
    const cropped = await api.processImage(cropFile, cropResolved, undefined, { useWorker: false });

    const transparent = await noisyImage(390, 567, 'image/png', 'transparent.png', true);
    const flattenRules = baseRules({ formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'] });
    const flattenMetadata = await api.inspectImage(transparent);
    const flattenPlan = api.createProcessingPlan(flattenMetadata, flattenRules);
    const flattenBlocked = flattenPlan.executable;
    const flattenResolved = api.resolveProcessingConfirmation(flattenPlan, {
      id: 'confirmation-flatten_background',
      type: 'FLATTEN_BACKGROUND',
      accepted: true,
      payload: { color: 'white' }
    });
    const flattened = await api.processImage(transparent, flattenResolved, undefined, { useWorker: false });
    const flattenedSource = await createImageBitmap(flattened.file);
    const pixelCanvas = document.createElement('canvas');
    pixelCanvas.width = 1;
    pixelCanvas.height = 1;
    const pixelContext = pixelCanvas.getContext('2d');
    pixelContext.drawImage(flattenedSource, 0, 0, 1, 1);
    const corner = Array.from(pixelContext.getImageData(0, 0, 1, 1).data);
    flattenedSource.close();

    const small = await noisyImage(100, 100, 'image/jpeg', 'small.jpg');
    const upscaleRules = baseRules({
      width: { exact: 390, min: null, max: null },
      height: { exact: 390, min: null, max: null },
      aspectRatio: { value: 1, tolerance: 0.015 }
    });
    const upscaleMetadata = await api.inspectImage(small);
    const upscalePlan = api.createProcessingPlan(upscaleMetadata, upscaleRules);
    const upscaleBlocked = upscalePlan.executable;
    const upscaleResolved = api.resolveProcessingConfirmation(upscalePlan, {
      id: 'confirmation-upscale',
      type: 'UPSCALE',
      accepted: true,
      payload: { allow: true }
    });
    const upscaled = await api.processImage(small, upscaleResolved, undefined, { useWorker: false });

    return {
      crop: { blocked: cropBlocked, executableBefore: cropPlan.executable, width: cropped.metadata.width, height: cropped.metadata.height },
      flatten: { executableBefore: flattenBlocked, mime: flattened.file.type, corner },
      upscale: { executableBefore: upscaleBlocked, width: upscaled.metadata.width, height: upscaled.metadata.height }
    };
  });

  expect(result.crop).toEqual({ blocked: 'USER_CONFIRMATION_REQUIRED', executableBefore: false, width: 390, height: 567 });
  expect(result.flatten.executableBefore).toBe(false);
  expect(result.flatten.mime).toBe('image/jpeg');
  expect(result.flatten.corner[0]).toBeGreaterThanOrEqual(200);
  expect(result.flatten.corner[1]).toBeGreaterThanOrEqual(200);
  expect(result.flatten.corner[2]).toBeGreaterThanOrEqual(200);
  expect(result.upscale).toEqual({ executableBefore: false, width: 390, height: 390 });
});

test('I11/I12/I13/I14/I17: rejects unsafe inputs, handles EXIF orientation and keeps output checks strict', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const rules = (overrides = {}) => ({
      formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'], minBytes: 1, maxBytes: 120_000,
      width: { exact: 50, min: null, max: null }, height: { exact: 100, min: null, max: null },
      aspectRatio: { value: 0.5, tolerance: 0.015 }, dpi: null, count: { max: 1 }, background: null,
      semanticRequirements: [], confidence: 0.96, sources: [], conflicts: [], advisories: [],
      safetyFlags: [], actionable: true, ...overrides
    });
    async function jpeg(width, height, name) {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#33aaff'; context.fillRect(0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      return new File([blob], name, { type: 'image/jpeg' });
    }
    async function orientation6File() {
      const source = await jpeg(100, 50, 'orientation-source.jpg');
      const input = new Uint8Array(await source.arrayBuffer());
      const app1 = new Uint8Array([
        0xff, 0xe1, 0x00, 0x22,
        0x45, 0x78, 0x69, 0x66, 0, 0,
        0x49, 0x49, 0x2a, 0, 0x08, 0, 0, 0,
        0x01, 0,
        0x12, 0x01, 0x03, 0x00,
        0x01, 0x00, 0x00, 0x00,
        0x06, 0x00, 0x00, 0x00,
        0, 0, 0, 0
      ]);
      const output = new Uint8Array(input.length + app1.length);
      output.set(input.slice(0, 2), 0);
      output.set(app1, 2);
      output.set(input.slice(2), 2 + app1.length);
      return new File([output], 'orientation6.jpg', { type: 'image/jpeg' });
    }
    function largeDimensionPng(width, height) {
      const bytes = new Uint8Array(33);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      const view = new DataView(bytes.buffer);
      view.setUint32(8, 13);
      bytes.set([0x49, 0x48, 0x44, 0x52], 12);
      view.setUint32(16, width);
      view.setUint32(20, height);
      bytes[24] = 8;
      bytes[25] = 6;
      return new File([bytes], 'large.png', { type: 'image/png' });
    }
    const orientationFile = await orientation6File();
    const orientationMetadata = await api.inspectImage(orientationFile);
    const orientationPlan = api.createProcessingPlan(orientationMetadata, rules());
    const oriented = await api.processImage(orientationFile, orientationPlan, undefined, { useWorker: false });

    const corrupt = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0])], 'corrupt.png', { type: 'image/png' });
    const corruptMetadata = await api.inspectImage(corrupt);
    const mismatch = new File([new Uint8Array(await (await jpeg(50, 100, 'mismatch-source.jpg')).arrayBuffer())], 'mismatch.png', { type: 'image/png' });
    const mismatchMetadata = await api.inspectImage(mismatch);
    const mismatchValidation = api.validateFile(mismatchMetadata, rules());
    const huge = new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'huge.jpg', { type: 'image/jpeg' });
    const hugeMetadata = await api.inspectImage(huge);
    const pixelMetadata = await api.inspectImage(largeDimensionPng(20_001, 1));

    const exactTinyFile = await jpeg(50, 100, 'tiny.jpg');
    const tinyPlan = api.createProcessingPlan(await api.inspectImage(exactTinyFile), rules({ maxBytes: 100 }));
    let tinyError;
    try {
      await api.processImage(exactTinyFile, tinyPlan, undefined, { useWorker: false });
    } catch (error) {
      tinyError = error.code;
    }
    return {
      orientation: {
        detected: orientationMetadata.orientation,
        inputWidth: orientationMetadata.width,
        inputHeight: orientationMetadata.height,
        outputWidth: oriented.metadata.width,
        outputHeight: oriented.metadata.height,
        outputMime: oriented.file.type
      },
      corrupt: corruptMetadata.errorCode,
      mismatch: {
        signature: mismatchMetadata.signatureMime,
        declared: mismatchMetadata.declaredMime,
        codes: mismatchValidation.violations.map((item) => item.code)
      },
      limits: { huge: hugeMetadata.errorCode, pixels: pixelMetadata.errorCode },
      tinyError
    };
  });

  expect(result.orientation).toEqual({
    detected: 6,
    inputWidth: 50,
    inputHeight: 100,
    outputWidth: 50,
    outputHeight: 100,
    outputMime: 'image/jpeg'
  });
  expect(result.corrupt).toBe('DECODE_FAILED');
  expect(result.mismatch.signature).toBe('image/jpeg');
  expect(result.mismatch.declared).toBe('image/png');
  expect(result.mismatch.codes).toEqual(expect.arrayContaining(['MIME_SIGNATURE_MISMATCH', 'EXTENSION_MISMATCH']));
  expect(result.limits).toEqual({ huge: 'FILE_TOO_LARGE_TO_PROCESS', pixels: 'PIXEL_LIMIT_EXCEEDED' });
  expect(result.tinyError).toBe('PROCESSING_FAILED');
});

test('I03/I04: processes a 4000x3000 local photo with proportional resize and bounded time', async ({ page }) => {
  await openApi(page);
  const result = await page.evaluate(async () => {
    const api = globalThis.__uploadfit_debug_bundle__;
    const canvas = document.createElement('canvas');
    canvas.width = 4000;
    canvas.height = 3000;
    const context = canvas.getContext('2d');
    const imageData = context.createImageData(4000, 3000);
    for (let y = 0; y < 3000; y += 1) {
      for (let x = 0; x < 4000; x += 1) {
        const offset = (y * 4000 + x) * 4;
        imageData.data[offset] = (x * 11 + y * 3) % 256;
        imageData.data[offset + 1] = (x * 5 + y * 13) % 256;
        imageData.data[offset + 2] = (x * 17 + y * 7) % 256;
        imageData.data[offset + 3] = 255;
      }
    }
    context.putImageData(imageData, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const file = new File([blob], 'large-photo.jpg', { type: 'image/jpeg' });
    const rules = {
      formats: ['image/jpeg'], extensions: ['jpg', 'jpeg'], minBytes: 1, maxBytes: 500_000,
      width: { exact: null, min: null, max: 2000 }, height: { exact: null, min: null, max: 2000 },
      aspectRatio: null, dpi: null, count: { max: 1 }, background: null,
      semanticRequirements: [], confidence: 0.96, sources: [], conflicts: [], advisories: [],
      safetyFlags: [], actionable: true
    };
    const metadata = await api.inspectImage(file);
    const plan = api.createProcessingPlan(metadata, rules);
    const started = performance.now();
    const output = await api.processImage(file, plan, undefined, { useWorker: true });
    const elapsed = performance.now() - started;
    return {
      inputBytes: file.size,
      plan: { executable: plan.executable, operations: plan.operations },
      output: {
        bytes: output.file.size,
        width: output.metadata.width,
        height: output.metadata.height,
        valid: output.validation.valid,
        durationMs: output.durationMs,
        elapsedMs: Math.round(elapsed),
        workerUsed: output.workerUsed
      }
    };
  });

  expect(result.inputBytes).toBeLessThanOrEqual(10 * 1024 * 1024);
  expect(result.plan).toEqual({ executable: true, operations: ['RESIZE', 'ENCODE', 'COMPRESS'] });
  expect(result.output.valid).toBe(true);
  expect(result.output.width).toBeLessThanOrEqual(2000);
  expect(result.output.height).toBeLessThanOrEqual(1500);
  expect(Math.abs(result.output.width / result.output.height - 4 / 3)).toBeLessThan(0.02);
  expect(result.output.bytes).toBeGreaterThan(0);
  expect(result.output.bytes).toBeLessThanOrEqual(500_000);
  expect(result.output.durationMs).toBeLessThanOrEqual(5000);
  expect(result.output.elapsedMs).toBeLessThanOrEqual(5000);
});
